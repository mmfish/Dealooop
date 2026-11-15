// Running a negotiation between two agents through core/negotiation.ts, plus a
// rule-based negotiator used in tests and as the fallback when Claude is
// unavailable. The runner asks the side whose turn it is for a move, lets the
// core judge it, and asks again with the core's reason when a move is refused.

import {openNegotiation, settleNegotiation, step, canPropose, type CreatorMandate, type FounderMandate, type Mandates, type Move, type Negotiation, type Side, type Terms, type Turn} from '../core/negotiation.ts';
import type {Book} from '../core/campaign.ts';
import type {CreatorProfile} from './market.ts';
import type {CampaignStore} from '../db/campaign-store.ts';

export interface NegotiationView {
  side: Side;
  round: number;
  canPropose: boolean;
  onTable: Terms | null;
  proposedBy: Side | null;
  history: Turn[];
  campaign: {productName: string; productPitch: string; publicPriceCents: number; maxCacCents: number; remainingBudgetCents: number; hoursLeft: number; goalCount: number};
  creator: CreatorProfile & {verifiedTotal: number};
  /** The deciding side's own owner's limits. Never the other side's. */
  mandate: CreatorMandate | FounderMandate;
  /** Why the previous attempt at this move was refused, if it was. */
  feedback?: string;
}

export interface Negotiator {
  readonly name: string;
  move(view: NegotiationView): Promise<Move>;
}

export interface NegotiationEvent {
  side: Side;
  attempt: number;
  move: Move;
  refused?: string;
  fellBack?: boolean;
}

export interface NegotiationOutcome {
  negotiation: Negotiation;
  book: Book;
  events: NegotiationEvent[];
}

export interface RunNegotiationInput {
  book: Book;
  id: string;
  creator: CreatorProfile & {verifiedTotal: number};
  product: {productName: string; productPitch: string};
  mandates: Mandates;
  creatorAgent: Negotiator;
  founderAgent: Negotiator;
  now: number;
  /** How many times a side may try a move before the runner rejects on its behalf. */
  attempts?: number;
}

export async function runNegotiation(input: RunNegotiationInput): Promise<NegotiationOutcome> {
  const {book, mandates, now} = input;
  let n = openNegotiation(book, {id: input.id, creatorId: input.creator.id, creatorVerifiedTotal: input.creator.verifiedTotal});
  const events: NegotiationEvent[] = [];
  const committed = book.conversions.filter(c => c.status === 'pending' || c.status === 'verified').length * book.campaign.currentPriceCents;
  const campaign = {
    ...input.product, publicPriceCents: book.campaign.currentPriceCents, maxCacCents: book.campaign.maxCacCents,
    remainingBudgetCents: Math.max(0, book.campaign.budgetCents - committed), hoursLeft: Math.max(0, (book.campaign.deadline - now) / 3_600_000),
    goalCount: book.campaign.goalCount,
  };
  // Four moves at most (C1); the loop bound is a backstop.
  for (let guard = 0; n.status === 'open' && guard < 8; guard++) {
    const side = n.turn;
    const agent = side === 'creator' ? input.creatorAgent : input.founderAgent;
    const mandate = side === 'creator' ? mandates.creator : mandates.founder;
    let feedback: string | undefined;
    let done = false;
    for (let attempt = 1; attempt <= (input.attempts ?? 2) && !done; attempt++) {
      const view: NegotiationView = {side, round: n.round, canPropose: canPropose(n, side), onTable: n.onTable, proposedBy: n.proposedBy, history: n.history, campaign, creator: input.creator, mandate, feedback};
      const move = await agent.move(view);
      const result = step(book, n, side, move, mandates, now);
      if (result.ok) {
        events.push({side, attempt, move});
        n = result.negotiation;
        done = true;
      } else {
        events.push({side, attempt, move, refused: result.reason});
        feedback = result.reason;
      }
    }
    if (!done) {
      const move: Move = {action: 'reject', message: 'We could not find terms within my owner’s limits, so I am ending this negotiation.'};
      const result = step(book, n, side, move, mandates, now);
      events.push({side, attempt: 0, move, fellBack: true, refused: result.ok ? undefined : result.reason});
      if (result.ok) n = result.negotiation;
      else break;
    }
  }
  return {negotiation: n, book: settleNegotiation(book, n, now), events};
}

// ---------------------------------------------------------------------------
// Rule-based negotiator: transparent concessions, no model calls.
// ---------------------------------------------------------------------------

const dollars = (c: number) => '$' + (c / 100).toFixed(2);

export class RuleNegotiator implements Negotiator {
  readonly name = 'rules';

  async move(v: NegotiationView): Promise<Move> {
    const theirs = v.onTable && v.proposedBy !== v.side ? v.onTable : null;
    if (v.side === 'creator') {
      const floor = (v.mandate as CreatorMandate).minPriceCents;
      if (!v.history.length) {
        const ask = Math.min(v.campaign.maxCacCents, Math.max(floor + 100, Math.round(floor * 1.25), v.campaign.publicPriceCents + 100));
        return {action: 'propose', terms: {priceCents: ask, volumeCap: 60}, message: `My audience converts well; I'd like ${dollars(ask)} per sign-up for my next 60.`};
      }
      if (theirs && theirs.priceCents >= floor) return {action: 'accept', message: `${dollars(theirs.priceCents)} for ${theirs.volumeCap} sign-ups works for me.`};
      if (theirs && v.canPropose) {
        const mine = v.history.filter(t => t.side === 'creator' && t.terms).at(-1)!.terms!;
        const price = Math.max(floor, Math.round((mine.priceCents + theirs.priceCents) / 2));
        return {action: 'propose', terms: {priceCents: price, volumeCap: theirs.volumeCap}, message: `Meet me in the middle: ${dollars(price)} for ${theirs.volumeCap}.`};
      }
      return {action: 'reject', message: 'That does not work for me, thanks.'};
    }
    const m = v.mandate as FounderMandate;
    if (theirs && theirs.priceCents <= m.maxPriceCents && theirs.volumeCap <= m.maxVolume) {
      return {action: 'accept', message: `Agreed: ${dollars(theirs.priceCents)} for ${theirs.volumeCap} sign-ups.`};
    }
    if (theirs && v.canPropose) {
      const price = Math.min(m.maxPriceCents, Math.round((v.campaign.publicPriceCents + theirs.priceCents) / 2));
      const volume = Math.min(m.maxVolume, theirs.volumeCap);
      return {action: 'propose', terms: {priceCents: price, volumeCap: volume}, message: `I can offer ${dollars(price)} for ${volume} sign-ups.`};
    }
    return {action: 'reject', message: 'We will stay on the public price for now.'};
  }
}

// ---------------------------------------------------------------------------
// The same loop on a stored campaign (DEMO-FLOW beat 6 fallback): every move
// goes through CampaignStore.negotiationMove, exactly as the MCP tools do, so
// the campaign page shows the outcome. Each side's limit is passed per move.
// ---------------------------------------------------------------------------

export interface StoredNegotiationInput {
  store: CampaignStore;
  campaignId: string;
  creatorId: string;
  mandates: Mandates;
  creatorAgent: Negotiator;
  founderAgent: Negotiator;
  now: () => number;
  attempts?: number;
  onEvent?: (e: NegotiationEvent) => void;
}

export async function runStoredNegotiation(input: StoredNegotiationInput): Promise<{negotiation: Negotiation; events: NegotiationEvent[]}> {
  const {store, mandates} = input;
  const stored = await store.openNegotiation(input.campaignId, input.creatorId, input.now());
  let n = stored.negotiation;
  const profile = (await store.creator(input.creatorId))!;
  const events: NegotiationEvent[] = [];
  const push = (e: NegotiationEvent) => { events.push(e); input.onEvent?.(e); };
  for (let guard = 0; n.status === 'open' && guard < 8; guard++) {
    const side = n.turn;
    const agent = side === 'creator' ? input.creatorAgent : input.founderAgent;
    const mandate = side === 'creator' ? mandates.creator : mandates.founder;
    const s = await store.require(input.campaignId);
    const c = s.book.campaign;
    const committed = s.book.conversions.filter(x => x.status === 'pending' || x.status === 'verified').length * c.currentPriceCents;
    const campaign = {
      productName: s.meta.title, productPitch: s.meta.brief, publicPriceCents: c.currentPriceCents, maxCacCents: c.maxCacCents,
      remainingBudgetCents: Math.max(0, c.budgetCents - committed), hoursLeft: Math.max(0, (c.deadline - input.now()) / 3_600_000), goalCount: c.goalCount,
    };
    const creator = {id: profile.userId, handle: profile.handle, niche: profile.niche, platform: profile.platform, followers: profile.followers, verifiedTotal: n.creatorVerifiedTotal};
    let feedback: string | undefined;
    let done = false;
    for (let attempt = 1; attempt <= (input.attempts ?? 2) && !done; attempt++) {
      const move = await agent.move({side, round: n.round, canPropose: canPropose(n, side), onTable: n.onTable, proposedBy: n.proposedBy, history: n.history, campaign, creator, mandate, feedback});
      const r = await store.negotiationMove(n.id, side, move, mandate, input.now());
      if (r.ok) { push({side, attempt, move}); n = r.negotiation; done = true; }
      else { push({side, attempt, move, refused: r.reason}); feedback = r.reason; }
    }
    if (!done) {
      const move: Move = {action: 'reject', message: 'We could not find terms within my owner’s limits, so I am ending this negotiation.'};
      const r = await store.negotiationMove(n.id, side, move, mandate, input.now());
      push({side, attempt: 0, move, fellBack: true, refused: r.ok ? undefined : r.reason});
      if (r.ok) n = r.negotiation;
      else break;
    }
  }
  return {negotiation: n, events};
}
