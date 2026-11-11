// Run strategies across many seeds and summarize (SPEC §10). Each seed is one
// synthetic market; every strategy faces the same markets and the same arrival
// randomness, so differences come from pricing alone.

import {MARKETS, type MarketSpec} from './market.ts';
import {DEMO_BRIEF, runCampaign, strategyLabel, type Brief, type RunResult, type Strategy} from './run.ts';
import type {SupplyEstimator} from './estimator.ts';

export interface Summary {
  strategy: string;
  market: string;
  runs: number;
  users: {mean: number; p10: number; p90: number};
  avgCacCents: number;
  utilization: number;
  goalMetRate: number;
  /** Share of runs where this strategy got strictly more users than fixed at max CAC. */
  beatsFixedMaxRate?: number;
}

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

export function summarize(results: RunResult[]): Omit<Summary, 'beatsFixedMaxRate'> {
  const users = results.map(r => r.users);
  const spend = results.reduce((s, r) => s + r.spendCents, 0);
  const paidUsers = results.reduce((s, r) => s + r.users, 0);
  return {
    strategy: results[0].strategy,
    market: results[0].market,
    runs: results.length,
    users: {mean: mean(users), p10: quantile(users, 0.1), p90: quantile(users, 0.9)},
    avgCacCents: paidUsers ? Math.round(spend / paidUsers) : 0,
    utilization: mean(results.map(r => r.utilization)),
    goalMetRate: mean(results.map(r => (r.goalMet ? 1 : 0))),
  };
}

export interface CompareOptions {
  runs: number;
  firstSeed?: number;
  market?: MarketSpec;
  brief?: Brief;
  estimator?: SupplyEstimator;
  /** Fixed prices to try as baselines; the best of them in hindsight is the "oracle" baseline. */
  fixedPricesCents?: number[];
  tickHours?: number;
}

export interface Comparison {
  market: string;
  brief: Brief;
  summaries: Summary[];
  /** The fixed price that did best on average, chosen with hindsight no real founder has. */
  bestFixed: Summary;
}

export async function compare(options: CompareOptions): Promise<Comparison> {
  const brief = options.brief ?? DEMO_BRIEF;
  const market = options.market ?? MARKETS.baseline;
  const firstSeed = options.firstSeed ?? 1;
  const fixed = options.fixedPricesCents ?? [300, 400, 500, 600, 700, 800, 900, 1000].filter(p => p <= brief.maxCacCents);
  if (!fixed.includes(brief.maxCacCents)) fixed.push(brief.maxCacCents);
  const strategies: Strategy[] = [{kind: 'dynamic'}, ...fixed.map(priceCents => ({kind: 'fixed' as const, priceCents}))];

  const byStrategy = new Map<string, RunResult[]>();
  for (const strategy of strategies) {
    const results: RunResult[] = [];
    for (let seed = firstSeed; seed < firstSeed + options.runs; seed++) {
      results.push(await runCampaign({seed, strategy, brief, market, estimator: options.estimator, tickHours: options.tickHours}));
    }
    byStrategy.set(strategyLabel(strategy), results);
  }

  const fixedMax = byStrategy.get(strategyLabel({kind: 'fixed', priceCents: brief.maxCacCents}))!;
  const summaries: Summary[] = [...byStrategy.values()].map(results => ({
    ...summarize(results),
    beatsFixedMaxRate: mean(results.map((r, i) => (r.users > fixedMax[i].users ? 1 : 0))),
  }));
  const fixedSummaries = summaries.filter(s => s.strategy.startsWith('fixed'));
  const bestFixed = fixedSummaries.reduce((a, b) => (b.users.mean > a.users.mean ? b : a));
  return {market: market.name, brief, summaries, bestFixed};
}
