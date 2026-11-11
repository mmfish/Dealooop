// One simulated campaign: synthetic creators decide whether to promote at the
// current price, conversions arrive, verification lags behind, and (for the
// dynamic strategy) the estimator proposes raises that core/campaign.ts decides.
// Every money operation goes through the core, so a simulated run obeys the
// same invariants as production.

import {
  applyAgentProposal, closeCampaign, counts, createCampaign, recordConversion, rejectConversion, settle,
  verifyConversion, type Book, type LedgerEntry,
} from '../core/campaign.ts';
import {createRng, generateMarket, generateProfiles, MARKETS, type MarketSpec, type SyntheticCreator} from './market.ts';
import {HeuristicEstimator, type SupplyEstimator} from './estimator.ts';
import {DEALOOP_SEED_PRODUCT, ThresholdPolicy, type CreatorPolicy} from './policy.ts';
import {mapLimit} from '../agents/claude.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const SIM_START = Date.UTC(2026, 10, 12);

/** Pricing strategy: the dynamic mechanism, or a fixed price as a baseline. */
export type Strategy = {kind: 'dynamic'} | {kind: 'fixed'; priceCents: number};

export interface Brief {
  goalCount: number;
  budgetCents: number;
  maxCacCents: number;
  days: number;
}

/** The founder's sentence from the pitch: 100 users, $1000, CAC at most $10, two weeks. */
export const DEMO_BRIEF: Brief = {goalCount: 100, budgetCents: 100_000, maxCacCents: 1_000, days: 14};

export interface RunOptions {
  seed: number;
  strategy: Strategy;
  brief?: Brief;
  market?: MarketSpec;
  estimator?: SupplyEstimator;
  tickHours?: number;
  verificationLagHours?: number;
  rejectionRate?: number;
  /** Record a per-tick timeline (for the dashboard). Off for bulk runs. */
  timeline?: boolean;
  /** How creators decide to join. Defaults to the threshold rule (join once price >= floor). */
  creatorPolicy?: CreatorPolicy;
  /** Product being promoted, shown to creator agents. Defaults to Dealoop itself. */
  product?: {productName: string; productPitch: string};
  /** Record agents' decisions and rationales (for the dashboard and the demo). */
  log?: boolean;
  /** Most creator decisions requested at once. */
  concurrency?: number;
}

export interface AgentLogEntry {
  at: number;
  actor: string;
  kind: 'join' | 'decline' | 'raise' | 'hold';
  text: string;
  fellBack?: boolean;
}

export interface TimelinePoint {
  at: number;
  priceCents: number;
  activeCreators: number;
  verified: number;
  pending: number;
  unfunded: number;
  committedCents: number;
}

export interface RunResult {
  seed: number;
  strategy: string;
  market: string;
  users: number;
  spendCents: number;
  avgCacCents: number;
  utilization: number;
  finalPriceCents: number;
  raises: number;
  unfunded: number;
  rejected: number;
  goalMet: boolean;
  creatorsActive: number;
  ledger: LedgerEntry[];
  book: Book;
  timeline: TimelinePoint[];
  agentLog: AgentLogEntry[];
  estimator: string;
  creatorPolicy: string;
}

export function strategyLabel(s: Strategy): string {
  return s.kind === 'dynamic' ? 'dynamic' : `fixed $${(s.priceCents / 100).toFixed(2)}`;
}

export async function runCampaign(options: RunOptions): Promise<RunResult> {
  const brief = options.brief ?? DEMO_BRIEF;
  const market = options.market ?? MARKETS.baseline;
  const tickHours = options.tickHours ?? 6;
  const lagHours = options.verificationLagHours ?? 24;
  const rejectionRate = options.rejectionRate ?? 0.05;
  const estimator = options.estimator ?? new HeuristicEstimator();
  const policy = options.creatorPolicy ?? new ThresholdPolicy();
  const product = options.product ?? DEALOOP_SEED_PRODUCT;
  const strategy = options.strategy;

  // The market and the event stream use separate seeds so strategies face the same creators.
  const creators: SyntheticCreator[] = generateMarket(market, createRng(options.seed));
  const rng = createRng(options.seed * 7919 + 17);
  const profiles = generateProfiles(creators, options.seed);

  const deadline = SIM_START + brief.days * DAY;
  let book = createCampaign({
    id: `sim-${options.seed}`,
    goalCount: brief.goalCount,
    budgetCents: brief.budgetCents,
    maxCacCents: brief.maxCacCents,
    deadline,
    now: SIM_START,
    startPriceCents: strategy.kind === 'fixed' ? strategy.priceCents : undefined,
  });

  const produced = new Map<string, number>();
  const dueAt = new Map<string, number>();
  const timeline: TimelinePoint[] = [];
  const agentLog: AgentLogEntry[] = [];
  const log = (entry: AgentLogEntry) => { if (options.log) agentLog.push(entry); };
  // Creators who have agreed to promote. The price never falls, so a creator who joins stays in.
  const joined = new Set<string>();
  // The price each undecided creator was last asked about, so nobody is asked twice at one price.
  const askedAt = new Map<string, number>();
  let n = 0;

  const settleDue = (now: number) => {
    for (const c of book.conversions) {
      if (c.status !== 'pending' || (dueAt.get(c.id) ?? Infinity) > now) continue;
      book = rng.next() < rejectionRate ? rejectConversion(book, c.id) : verifyConversion(book, c.id);
    }
  };

  for (let tickStart = SIM_START; tickStart < deadline; tickStart += tickHours * HOUR) {
    const tickEnd = Math.min(deadline, tickStart + tickHours * HOUR);
    const price = book.campaign.currentPriceCents;
    // Creators who have not joined decide at each new price level. With a retroactive
    // uniform price there is nothing to gain by waiting (SPEC §6).
    const undecided = creators.filter(c => !joined.has(c.id) && askedAt.get(c.id) !== price && (produced.get(c.id) ?? 0) < c.capacity);
    if (undecided.length) {
      const committed = book.conversions.filter(x => x.status === 'pending' || x.status === 'verified').length * price;
      const offer = {
        ...product, priceCents: price, maxCacCents: brief.maxCacCents,
        remainingBudgetCents: Math.max(0, brief.budgetCents - committed), hoursLeft: (deadline - tickStart) / HOUR,
      };
      const decisions = await mapLimit(undecided, options.concurrency ?? 8, creator =>
        policy.decide({profile: profiles.get(creator.id)!, minTakeHomeCents: creator.minPriceCents, offer}));
      undecided.forEach((creator, i) => {
        askedAt.set(creator.id, price);
        const d = decisions[i];
        if (d.join) joined.add(creator.id);
        // Declines are logged only when an agent reasoned about them; the threshold rule's are noise.
        if (d.join || policy.name !== 'threshold') {
          log({at: tickStart, actor: creator.id, kind: d.join ? 'join' : 'decline', text: d.rationale, fellBack: d.fellBack});
        }
      });
    }
    const active = creators.filter(c => joined.has(c.id) && (produced.get(c.id) ?? 0) < c.capacity);

    const arrivals: {creator: SyntheticCreator; at: number}[] = [];
    for (const creator of active) {
      const room = creator.capacity - (produced.get(creator.id) ?? 0);
      const k = Math.min(room, rng.poisson(creator.dailyRate * (tickEnd - tickStart) / DAY));
      for (let i = 0; i < k; i++) arrivals.push({creator, at: tickStart + Math.floor(rng.next() * (tickEnd - tickStart))});
      produced.set(creator.id, (produced.get(creator.id) ?? 0) + k);
    }
    arrivals.sort((a, b) => a.at - b.at);
    for (const {creator, at} of arrivals) {
      const id = `${creator.id}-c${n}`;
      book = recordConversion(book, {id, creatorId: creator.id, externalUserId: `sim-user-${options.seed}-${n}`, now: at});
      dueAt.set(id, at + lagHours * HOUR);
      n++;
    }

    settleDue(tickEnd);

    if (strategy.kind === 'dynamic' && tickEnd < deadline) {
      const estimate = await estimator.estimate(book, tickEnd);
      const result = applyAgentProposal(book, {
        kind: 'raise_price', supplyAtCurrent: estimate.supplyAtCurrent, supplyAtRaised: estimate.supplyAtRaised, rationale: estimate.rationale,
      }, tickEnd);
      book = result.book;
      const d = result.decision;
      const price = (cents: number) => '$' + (cents / 100).toFixed(2);
      log({
        at: tickEnd, actor: 'founder', kind: result.accepted ? 'raise' : 'hold',
        text: `Forecast ${estimate.supplyAtCurrent} more at the current price vs ${estimate.supplyAtRaised} one step up. `
          + `${estimate.rationale} Core: ${result.reason}`
          + (d ? ` (projected ${d.projectedAtCurrent} vs ${d.projectedAtRaised} users${result.accepted ? `; price now ${price(d.toCents)}` : ''})` : ''),
      });
    }

    if (options.timeline) {
      const c = counts(book);
      timeline.push({
        at: tickEnd, priceCents: book.campaign.currentPriceCents, activeCreators: active.length,
        verified: c.verified, pending: c.pending, unfunded: c.unfunded,
        committedCents: book.conversions.filter(x => x.status === 'pending' || x.status === 'verified').length * book.campaign.currentPriceCents,
      });
    }
  }

  // Close, then let the verification window run out for conversions still pending.
  book = closeCampaign(book);
  settleDue(Infinity);

  const ledger = settle(book);
  const spendCents = ledger.reduce((s, e) => s + e.amountCents, 0);
  const c = counts(book);
  return {
    seed: options.seed,
    strategy: strategyLabel(strategy),
    market: market.name,
    users: ledger.length,
    spendCents,
    avgCacCents: ledger.length ? Math.round(spendCents / ledger.length) : 0,
    utilization: spendCents / brief.budgetCents,
    finalPriceCents: book.campaign.currentPriceCents,
    raises: book.priceHistory.length,
    unfunded: c.unfunded,
    rejected: c.rejected,
    goalMet: ledger.length >= brief.goalCount,
    creatorsActive: new Set(book.conversions.map(x => x.creatorId)).size,
    ledger,
    book,
    timeline,
    agentLog,
    estimator: strategy.kind === 'dynamic' ? estimator.name : 'none',
    creatorPolicy: policy.name,
  };
}
