// The campaign's days on an accelerated clock (DEMO-FLOW beats 5a and 5b), on
// the stored campaign the founder posted and the creators who really joined it.
//
// Runs from the platform's current time to the end of a given day, or to the
// deadline and settlement, writing every sign-up, verification and price
// proposal through the store as it goes, so the campaign page fills up live and
// both owners' agents see the same day (CampaignStore.now). Run it to day 5,
// let Bean negotiate (beat 6), then run it to the end: the deal is in the stored
// Book by then, so the core pays his sign-ups on deal terms with no special case.
//
// ALL SIGN-UPS ARE SIMULATED (CLAUDE.md rule 5). Each creator's audience
// response (sign-ups per day, how many in all) is a seeded assumption below,
// never stored and never shown to the founder's agent. The founder's daily
// price review uses the heuristic estimator; the core decides every raise and
// refuses the ones that are not expected to help, and the refusals show in the
// feed. Deterministic for a given seed: each tick draws from its own seed, so
// running in two parts gives the same days as running in one.

import {remainingCents} from '../core/campaign.ts';
import {DAY_MS} from '../db/campaign-view.ts';
import type {CampaignStore} from '../db/campaign-store.ts';
import {createRng} from './market.ts';
import {HeuristicEstimator} from './estimator.ts';
import {DEMO_CREATORS, BEAN} from './demo-creators.ts';

const HOUR = 3_600_000;

export interface DaysOptions {
  /** Run to the end of this campaign day (1-based), or to the deadline and settle. */
  to: number | 'end';
  seed?: number;
  tickHours?: number;
  /** How long a sign-up waits before it is verified or rejected. */
  verificationLagHours?: number;
  rejectionRate?: number;
  /** Pause after each write, so the page visibly fills. */
  paceMs?: number;
  onStep?: (line: string) => void;
}

export interface DaysResult {
  from: number;
  to: number;
  signUps: number;
  verified: number;
  rejected: number;
  raises: number;
  refusals: number;
  joinedLater: string[];
  settled: boolean;
}

/** A creator's audience response. Hidden: the platform and the founder's agent never see it. */
interface Audience { perDay: number; capacity: number }

/** FNV-1a, so each creator and each sign-up gets its own stable random stream. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

// Assumptions, not measurements: a well-matched creator brings 0.8–2 sign-ups a day, 8–20 in all.
// Chosen so the demo's $1000 campaign is limited by its budget, not by creators, before the deadline.
const PER_DAY = [0.8, 2.0] as const;
const CAPACITY = [8, 20] as const;

const FIT = new Map(DEMO_CREATORS.map(c => [c.userId, c]));

export function audienceOf(userId: string, seed: number): Audience {
  // Bean is the top creator the demo is about: a large, well-matched audience.
  if (userId === BEAN.userId) return {perDay: 7, capacity: 70};
  const rng = createRng(hash(userId) ^ seed);
  const c = FIT.get(userId);
  if (c && !c.fit) return {perDay: 0.2, capacity: 3};
  return {perDay: rng.uniform(PER_DAY[0], PER_DAY[1]), capacity: rng.int(CAPACITY[0], CAPACITY[1])};
}

const dollars = (c: number) => '$' + (c / 100).toFixed(2);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

type Action = {at: number; run: () => Promise<string | null>};

export async function runDays(store: CampaignStore, campaignId: string, options: DaysOptions): Promise<DaysResult> {
  const seed = options.seed ?? 1;
  const tick = (options.tickHours ?? 6) * HOUR;
  const lag = (options.verificationLagHours ?? 24) * HOUR;
  const rejectionRate = options.rejectionRate ?? 0.05;
  const say = options.onStep ?? (() => {});
  const estimator = new HeuristicEstimator();

  const first = await store.require(campaignId);
  const {createdAt, deadline} = first.book.campaign;
  if (first.book.campaign.status !== 'open') throw new Error('The campaign is already closed.');
  const start = Math.max(await store.now(), createdAt);
  const target = options.to === 'end' ? deadline : Math.min(deadline, createdAt + options.to * DAY_MS);
  const out: DaysResult = {from: start, to: target, signUps: 0, verified: 0, rejected: 0, raises: 0, refusals: 0, joinedLater: [], settled: false};

  // Who declined, and when: a creator who turned the campaign down on price may reconsider when it rises.
  const declinedAt = new Map<string, number>();
  for (const e of await store.events(campaignId, 0, 1000)) {
    if (e.kind === 'creator.declined' && typeof e.data.creatorId === 'string') declinedAt.set(e.data.creatorId, e.createdAt);
  }
  const priceAt = (book: typeof first.book, at: number) => {
    let p = book.campaign.startPriceCents;
    for (const h of book.priceHistory) if (h.at <= at) p = h.toCents;
    return p;
  };

  const handles = new Map((await store.creators()).map(p => [p.userId, p.handle]));
  const act = async (a: Action) => {
    const line = await a.run();
    if (line) say(line);
    if (options.paceMs) await sleep(options.paceMs);
  };

  /** Verifications due before `until`, each at its due time (or `from` if that is later). */
  const verifications = (book: typeof first.book, from: number, until: number): Action[] =>
    book.conversions.filter(c => c.status === 'pending' && c.createdAt + lag < until).map(c => ({
      at: Math.max(from, c.createdAt + lag),
      run: async () => {
        const reject = createRng(hash(c.externalUserId) ^ seed).next() < rejectionRate;
        if (reject) { await store.rejectConversion(campaignId, c.id, Math.max(from, c.createdAt + lag)); out.rejected++; return `rejected  sign-up #${c.seq} failed verification`; }
        await store.verifyConversion(campaignId, c.id, Math.max(from, c.createdAt + lag)); out.verified++; return null;
      },
    }));

  for (let t0 = start; t0 < target;) {
    const index = Math.floor((t0 - createdAt) / tick);
    const t1 = Math.min(target, createdAt + (index + 1) * tick);
    const rng = createRng(seed * 1_000_003 + index);
    let s = await store.require(campaignId);
    const price = s.book.campaign.currentPriceCents;

    // Creators who declined below their minimum and suit the audience reconsider once the price meets it.
    for (const c of DEMO_CREATORS) {
      const at = declinedAt.get(c.userId);
      if (at === undefined || s.links[c.userId] || !c.fit || c.floorCents > price || c.floorCents <= priceAt(s.book, at)) continue;
      await store.join(campaignId, c.userId, t0, `the price is now ${dollars(price)}, which meets their minimum (simulated decision)`);
      out.joinedLater.push(c.handle);
      say(`joined    ${c.handle} at ${dollars(price)}`);
    }
    s = await store.require(campaignId);

    const actions: Action[] = verifications(s.book, t0, t1);
    const produced = new Map<string, number>();
    for (const c of s.book.conversions) produced.set(c.creatorId, (produced.get(c.creatorId) ?? 0) + 1);
    let n = s.book.conversions.length;
    // Creators see the budget left on the campaign; once it cannot pay for another sign-up they stop promoting.
    const full = remainingCents(s.book) < price;
    for (const userId of Object.keys(s.links).sort()) {
      const a = audienceOf(userId, seed);
      const room = a.capacity - (produced.get(userId) ?? 0);
      const drawn = rng.poisson(a.perDay * (t1 - t0) / DAY_MS);
      const k = full ? 0 : Math.min(room, drawn);
      const link = await store.link(campaignId, userId);
      for (let i = 0; i < k; i++) {
        const at = t0 + Math.floor(rng.next() * (t1 - t0));
        const user = `sim-${campaignId}-${userId}-${n++}`;
        actions.push({at, run: async () => {
          const c = await store.recordConversion(link!.token, user, at);
          out.signUps++;
          return `sign-up   #${c.seq} via ${handles.get(userId) ?? userId}${c.channel === 'deal' ? ' (deal)' : ''}${c.status === 'unfunded' ? ' (unfunded)' : ''}`;
        }});
      }
    }
    for (const a of actions.sort((x, y) => x.at - y.at)) await act(a);

    // The founder's agent reviews the price once a day; the core decides.
    if ((t1 - createdAt) % DAY_MS === 0 && t1 < deadline) {
      const book = (await store.require(campaignId)).book;
      // After a refusal the agent waits two days for new evidence before asking again.
      const lastRefusal = book.rejections.at(-1)?.at ?? -Infinity;
      if (book.campaign.currentPriceCents < book.campaign.maxCacCents && t1 - lastRefusal >= 2 * DAY_MS) {
        const e = estimator.estimate(book, t1);
        if (e.supplyAtRaised > e.supplyAtCurrent) {
          const r = await store.applyProposal(campaignId, {kind: 'raise_price', supplyAtCurrent: e.supplyAtCurrent, supplyAtRaised: e.supplyAtRaised, rationale: e.rationale}, t1, 'founder-agent');
          if (r.accepted) out.raises++; else out.refusals++;
          say(r.accepted ? `price     raised to ${dollars(r.decision!.toCents)}` : `refused   ${r.reason}`);
        }
      }
    }
    await store.setClock(t1);
    t0 = t1;
  }

  if (options.to === 'end') {
    // The deadline has passed: no new sign-ups, but the last ones still finish verification. Then settle.
    const book = (await store.require(campaignId)).book;
    const rest = verifications(book, deadline, Infinity).sort((x, y) => x.at - y.at);
    for (const a of rest) await act(a);
    const closeAt = Math.max(deadline, ...rest.map(a => a.at)) + 60_000;
    const ledger = await store.closeAndSettle(campaignId, closeAt);
    await store.setClock(closeAt);
    out.settled = true;
    say(`settled   ${ledger.length} verified sign-ups, ${dollars(ledger.reduce((s, e) => s + e.amountCents, 0))} paid`);
  }
  return out;
}
