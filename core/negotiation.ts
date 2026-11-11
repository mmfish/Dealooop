// Private negotiation channel between a top creator and the founder (SPEC §9).
//
// Deterministic protocol, like core/campaign.ts: agents propose moves, this
// module decides whether a move is legal. It ports the rules of the Muse
// engine (backend/negotiation.ts) to campaigns: a proposal is its author's
// agreement to those exact terms, the other side can accept only the terms on
// the table, and an agreement is recorded once, atomically, as a Deal.
//
// Invariants (docs/ACCEPTANCE.md C1–C5):
//  C1 at most two rounds; the founder's reply in the last round cannot counter
//  C2 nobody can propose or accept terms outside their own owner's mandate
//  C3 no message may contain the sender's private limits
//  C4 a failed negotiation changes nothing in the campaign
//  C5 only creators with enough verified conversions may open one
//
// Mandates are the owners' private limits. The platform holds them only to
// enforce C2 and C3; they are never shown to the other side.

import {z} from 'zod';
import {createDeal, DEAL_ELIGIBILITY_THRESHOLD, MAX_DEAL_VOLUME, type Book, type Cents} from './campaign.ts';

export type Side = 'creator' | 'founder';

export interface Terms {
  /** Price floor per verified sign-up for this creator (paid at least the public price anyway). */
  priceCents: Cents;
  /** How many of the creator's sign-ups the deal price covers. */
  volumeCap: number;
}

export interface CreatorMandate {
  /** Lowest deal price the creator will accept. */
  minPriceCents: Cents;
}

export interface FounderMandate {
  /** Highest deal price the founder will pay a top creator. At most the campaign's max CAC. */
  maxPriceCents: Cents;
  /** Most sign-ups the founder will cover at a deal price for one creator. */
  maxVolume: number;
}

export interface Mandates {
  creator: CreatorMandate;
  founder: FounderMandate;
}

export const MAX_ROUNDS = 2;

export type Move =
  | {action: 'propose'; terms: Terms; message: string}
  | {action: 'accept'; message: string}
  | {action: 'reject'; message: string};

export interface Turn {
  seq: number;
  round: number;
  side: Side;
  action: Move['action'];
  terms?: Terms;
  message: string;
  at: number;
}

export interface Negotiation {
  id: string;
  campaignId: string;
  creatorId: string;
  creatorVerifiedTotal: number;
  status: 'open' | 'agreed' | 'failed';
  turn: Side;
  round: number;
  /** Terms currently on the table and who put them there. */
  onTable: Terms | null;
  proposedBy: Side | null;
  history: Turn[];
  agreed: Terms | null;
}

export class NegotiationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'NegotiationError';
  }
}

export type StepResult = {ok: true; negotiation: Negotiation} | {ok: false; reason: string; negotiation: Negotiation};

const moveSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('propose'),
    terms: z.object({priceCents: z.number().int().positive(), volumeCap: z.number().int().min(1).max(MAX_DEAL_VOLUME)}).strict(),
    message: z.string().min(1).max(1200),
  }).strict(),
  z.object({action: z.literal('accept'), message: z.string().min(1).max(1200)}).strict(),
  z.object({action: z.literal('reject'), message: z.string().min(1).max(1200)}).strict(),
]);

// ---------------------------------------------------------------------------

/** Open a negotiation for a creator. The creator moves first (C5 checked here). */
export function openNegotiation(book: Book, input: {id: string; creatorId: string; creatorVerifiedTotal: number}): Negotiation {
  if (book.campaign.status !== 'open') throw new NegotiationError('CAMPAIGN_CLOSED', 'The campaign is closed.');
  if (!(Number.isSafeInteger(input.creatorVerifiedTotal) && input.creatorVerifiedTotal >= DEAL_ELIGIBILITY_THRESHOLD)) {
    throw new NegotiationError('NOT_ELIGIBLE', `Private deals need at least ${DEAL_ELIGIBILITY_THRESHOLD} verified conversions.`);
  }
  if (book.deals[input.creatorId]) throw new NegotiationError('DEAL_EXISTS', 'This creator already has a deal for this campaign.');
  return {
    id: input.id, campaignId: book.campaign.id, creatorId: input.creatorId, creatorVerifiedTotal: input.creatorVerifiedTotal,
    status: 'open', turn: 'creator', round: 1, onTable: null, proposedBy: null, history: [], agreed: null,
  };
}

/** May `side` still make a counter-proposal at this point? */
export function canPropose(n: Negotiation, side: Side): boolean {
  // The founder has the last word: in the final round it can only accept or reject.
  return n.status === 'open' && n.turn === side && !(side === 'founder' && n.round >= MAX_ROUNDS);
}

/** Every way the sender's own private limits could be written in a message. */
export function privateNumbers(side: Side, mandates: Mandates): string[] {
  const cents = side === 'creator' ? [mandates.creator.minPriceCents] : [mandates.founder.maxPriceCents];
  const out: string[] = [];
  for (const c of cents) {
    const dollars = (c / 100).toFixed(2);
    out.push(`$${dollars}`, dollars);
    if (c % 100 === 0) out.push(`$${c / 100}`, `${c / 100} dollars`);
  }
  if (side === 'founder') out.push(`${mandates.founder.maxVolume} sign-ups`, `${mandates.founder.maxVolume} users`, `up to ${mandates.founder.maxVolume}`);
  return out;
}

function leaks(message: string, side: Side, mandates: Mandates, openTerms: Terms[]): string | null {
  const text = message.toLowerCase();
  // A limit that equals terms already put on the table is public by then; only an undisclosed limit leaks.
  const disclosedPrices = new Set(openTerms.map(t => t.priceCents));
  const disclosedVolumes = new Set(openTerms.map(t => t.volumeCap));
  const ownPrice = side === 'creator' ? mandates.creator.minPriceCents : mandates.founder.maxPriceCents;
  const candidates = privateNumbers(side, mandates).filter(s => {
    const isVolume = /sign-ups|users|up to/.test(s);
    return isVolume ? !disclosedVolumes.has(mandates.founder.maxVolume) : !disclosedPrices.has(ownPrice);
  });
  for (const s of candidates) {
    const needle = s.toLowerCase();
    // Match whole numbers only: "$6.40" must not match "$16.40".
    const at = text.indexOf(needle);
    if (at >= 0 && !/[\d.]/.test(text[at - 1] ?? '') && !/\d/.test(text[at + needle.length] ?? '')) return s;
  }
  return null;
}

function within(side: Side, terms: Terms, mandates: Mandates): string | null {
  if (side === 'creator' && terms.priceCents < mandates.creator.minPriceCents) return 'These terms are below your owner\'s minimum price.';
  if (side === 'founder' && terms.priceCents > mandates.founder.maxPriceCents) return 'These terms are above your owner\'s maximum deal price.';
  if (side === 'founder' && terms.volumeCap > mandates.founder.maxVolume) return 'These terms cover more sign-ups than your owner allows.';
  return null;
}

/**
 * Apply one move by `side`. An illegal move is refused with a reason and leaves the
 * negotiation unchanged, so the agent can be asked again.
 */
export function step(book: Book, n: Negotiation, side: Side, input: unknown, mandates: Mandates, now: number): StepResult {
  const refuse = (reason: string): StepResult => ({ok: false, reason, negotiation: n});
  if (n.status !== 'open') return refuse('The negotiation is over.');
  if (n.turn !== side) return refuse(`It is the ${n.turn}'s turn.`);
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return refuse('The move is malformed.');
  const move = parsed.data;

  const openTerms = [...n.history.flatMap(t => (t.terms ? [t.terms] : [])), ...(move.action === 'propose' ? [move.terms] : [])];
  const leaked = leaks(move.message, side, mandates, openTerms);
  if (leaked) return refuse(`The message reveals your owner's private limit (${leaked}). Rewrite it without that number.`);

  const record = (patch: Partial<Negotiation>, terms?: Terms): StepResult => ({
    ok: true,
    negotiation: {
      ...n, ...patch,
      history: [...n.history, {seq: n.history.length + 1, round: n.round, side, action: move.action, terms, message: move.message, at: now}],
    },
  });

  if (move.action === 'reject') return record({status: 'failed', onTable: null});

  if (move.action === 'accept') {
    if (!n.onTable || n.proposedBy === side) return refuse('There are no terms from the other side to accept.');
    const problem = within(side, n.onTable, mandates);
    if (problem) return refuse(problem);
    return record({status: 'agreed', agreed: n.onTable});
  }

  // propose
  if (!canPropose(n, side)) return refuse('No more counter-proposals: in the last round you can only accept or reject.');
  const terms = move.terms;
  if (terms.priceCents > book.campaign.maxCacCents) return refuse('The price is above the campaign\'s maximum CAC.');
  const problem = within(side, terms, mandates);
  if (problem) return refuse(problem);
  const nextTurn: Side = side === 'creator' ? 'founder' : 'creator';
  // A round is one creator move and the founder's reply; the founder countering starts the next round.
  const nextRound = side === 'founder' ? n.round + 1 : n.round;
  return record({onTable: terms, proposedBy: side, turn: nextTurn, round: nextRound}, terms);
}

/** Record an agreed negotiation as a deal in the campaign (no change for any other outcome, C4). */
export function settleNegotiation(book: Book, n: Negotiation, now: number): Book {
  if (n.status !== 'agreed' || !n.agreed) return book;
  return createDeal(book, {creatorId: n.creatorId, priceCents: n.agreed.priceCents, volumeCap: n.agreed.volumeCap, creatorVerifiedTotal: n.creatorVerifiedTotal, now});
}
