// Data for the Act 1 dashboard (app/sim). Two sources, neither calls the API:
//  - a recorded Claude run from data/sim-runs/ (made by `npm run sim:claude`), with
//    comparison strategies computed on the same supply by replaying its creators;
//  - a fresh heuristic simulation for any seed, computed on the spot.
// Everything returned is plain JSON so it can cross to a client component.

import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createRng, generateMarket, generateProfiles, MARKETS, type CreatorProfile, type MarketSpec} from './market.ts';
import {priceAtFrom, ReplayPolicy} from './replay.ts';
import {DEMO_BRIEF, runCampaign, SIM_START, type AgentLogEntry, type Brief, type RunResult, type TimelinePoint} from './run.ts';
import type {CreatorPolicy} from './policy.ts';

const HOUR = 3_600_000;
// Local runs from `npm run sim:claude` (git-ignored), then runs committed to the repo so a
// fresh clone can show the demo without spending API credit.
const RUN_DIRS = [join(process.cwd(), 'data', 'sim-runs'), join(process.cwd(), 'sim', 'recorded')];
const RUN_FILE = /^claude-seed\d+-[\w-]+\.json$/;

export interface Point {
  /** Hours since the campaign started. */
  h: number;
  users: number;
  priceCents: number;
  committedCents: number;
  activeCreators: number;
}

export interface Series {
  key: string;
  label: string;
  points: Point[];
}

export interface LogItem {
  h: number;
  actor: string;
  kind: AgentLogEntry['kind'];
  text: string;
  fellBack: boolean;
}

export interface Outcome {
  label: string;
  users: number;
  avgCacCents: number;
  spendCents: number;
  finalPriceCents: number;
  highlight?: boolean;
}

export interface RunOption {
  value: string;
  label: string;
}

export interface DashboardData {
  source: 'claude' | 'heuristic';
  title: string;
  subtitle: string;
  seed: number;
  brief: Brief;
  market: MarketSpec;
  models: {founder: string; creator: string} | null;
  usage: {calls: number; failures: number; costUsd: number | null} | null;
  /** The run being played back, followed by the comparison series on the same supply. */
  series: Series[];
  log: LogItem[];
  outcomes: Outcome[];
  supplyNote: string;
  runs: RunOption[];
  selected: string;
  /** Public profiles of the synthetic creators, keyed by id, for the agent feed. */
  creators: Record<string, CreatorProfile>;
}

function profilesFor(seed: number, market: MarketSpec): Record<string, CreatorProfile> {
  return Object.fromEntries(generateProfiles(generateMarket(market, createRng(seed)), seed));
}

interface RecordedRun {
  seed: number;
  market: MarketSpec;
  brief: Brief;
  models: {founder: string; creator: string};
  usage: {calls: number; failures: number; inputTokens: number; outputTokens: number};
  claude: Omit<RunResult, 'book'> & {priceHistory: {at: number; fromCents: number; toCents: number}[]};
}

const PRICES: Record<string, {input: number; output: number}> = {
  'claude-opus-5-5': {input: 4, output: 20},
  'claude-sonnet-5-5': {input: 2, output: 10},
  'claude-haiku-5-5': {input: 0.1, output: 0.5},
};

const runPaths = new Map<string, string>();

export function listRecordedRuns(): string[] {
  runPaths.clear();
  for (const dir of RUN_DIRS) {
    let files: string[] = [];
    try { files = readdirSync(dir); } catch { continue; }
    for (const f of files) if (RUN_FILE.test(f) && !runPaths.has(f)) runPaths.set(f, join(dir, f));
  }
  return [...runPaths.keys()].sort().reverse();
}

const readRun = (file: string) => JSON.parse(readFileSync(runPaths.get(file)!, 'utf8')) as RecordedRun;

/**
 * Timeline points plus the result after settlement. Conversions made just before the
 * deadline finish verification afterwards, so the last point takes the settled totals.
 */
function toPoints(timeline: TimelinePoint[], startPriceCents: number, settled?: {users: number; spendCents: number}): Point[] {
  const points: Point[] = [
    {h: 0, users: 0, priceCents: startPriceCents, committedCents: 0, activeCreators: 0},
    ...timeline.map(t => ({
      h: Math.round((t.at - SIM_START) / HOUR),
      users: t.verified,
      priceCents: t.priceCents,
      committedCents: t.committedCents,
      activeCreators: t.activeCreators,
    })),
  ];
  if (settled && points.length > 1) {
    const lastPoint = points[points.length - 1];
    points[points.length - 1] = {...lastPoint, users: settled.users, committedCents: settled.spendCents};
  }
  return points;
}

const toLog = (log: AgentLogEntry[]): LogItem[] =>
  log.map(e => ({h: Math.round((e.at - SIM_START) / HOUR), actor: e.actor, kind: e.kind, text: e.text, fellBack: !!e.fellBack}));

const outcome = (label: string, r: Pick<RunResult, 'users' | 'avgCacCents' | 'spendCents' | 'finalPriceCents'>, highlight = false): Outcome =>
  ({label, users: r.users, avgCacCents: r.avgCacCents, spendCents: r.spendCents, finalPriceCents: r.finalPriceCents, highlight});

const dollars = (c: number) => '$' + (c / 100).toFixed(0);

async function comparisons(seed: number, market: MarketSpec, brief: Brief, creatorPolicy: CreatorPolicy | undefined) {
  const base = {seed, market, brief, creatorPolicy, timeline: true};
  const fixedMax = await runCampaign({...base, strategy: {kind: 'fixed', priceCents: brief.maxCacCents}});
  const fixed = [];
  for (const f of [0.7, 0.8, 0.9]) {
    const priceCents = Math.round(f * brief.maxCacCents);
    fixed.push({priceCents, run: await runCampaign({...base, strategy: {kind: 'fixed', priceCents}})});
  }
  return {fixedMax, fixed};
}

export async function loadDashboard(params: {run?: string; seed?: string}): Promise<DashboardData> {
  const recorded = listRecordedRuns();
  // Read each recorded run's size so the picker can describe it and the default is a full run, not a trial.
  const sizes = new Map(recorded.map(f => {
    try {
      const r = readRun(f);
      return [f, {seed: r.seed, creators: r.market.creators, days: r.brief.days}];
    } catch {
      return [f, null];
    }
  }));
  const valid = recorded.filter(f => sizes.get(f));
  const runs: RunOption[] = [
    ...valid.map(f => {
      const z = sizes.get(f)!;
      const date = f.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? '';
      return {value: f, label: `Claude run · seed ${z.seed} · ${z.creators} creators · ${z.days} days · ${date}`};
    }),
    ...[1, 2, 3, 4, 5].map(s => ({value: `heuristic-${s}`, label: `Heuristic simulation · seed ${s}`})),
  ];

  const wantHeuristic = params.run?.startsWith('heuristic-');
  const full = valid.find(f => sizes.get(f)!.creators >= MARKETS.baseline.creators && sizes.get(f)!.days >= DEMO_BRIEF.days);
  const file = wantHeuristic ? undefined : params.run && valid.includes(params.run) ? params.run : full ?? valid[0];

  if (file) {
    const rec = readRun(file);
    const startPriceCents = Math.max(1, Math.round(0.3 * rec.brief.maxCacCents));
    const replay = new ReplayPolicy(rec.claude.agentLog, priceAtFrom(startPriceCents, rec.claude.priceHistory));
    const heuristicFounder = await runCampaign({seed: rec.seed, market: rec.market, brief: rec.brief, creatorPolicy: replay, timeline: true, strategy: {kind: 'dynamic'}});
    const {fixedMax, fixed} = await comparisons(rec.seed, rec.market, rec.brief, replay);
    const price = PRICES[rec.models.founder];
    const costUsd = price && rec.models.founder === rec.models.creator
      ? (rec.usage.inputTokens * price.input + rec.usage.outputTokens * price.output) / 1_000_000 : null;
    const best = [...fixed, {priceCents: rec.brief.maxCacCents, run: fixedMax}].reduce((a, b) => (b.run.users > a.run.users ? b : a));
    return {
      source: 'claude',
      title: 'A campaign run by Claude agents',
      subtitle: `Claude is the founder's pricing analyst and every creator's agent. Recorded run, seed ${rec.seed}.`,
      seed: rec.seed,
      brief: rec.brief,
      market: rec.market,
      models: rec.models,
      usage: {calls: rec.usage.calls, failures: rec.usage.failures, costUsd},
      series: [
        {key: 'dynamic', label: 'Claude founder, dynamic price', points: toPoints(rec.claude.timeline, startPriceCents, rec.claude)},
        {key: 'fixed', label: `Fixed ${dollars(rec.brief.maxCacCents)}`, points: toPoints(fixedMax.timeline, rec.brief.maxCacCents, fixedMax)},
      ],
      log: toLog(rec.claude.agentLog),
      outcomes: [
        outcome('Claude founder, dynamic price', rec.claude, true),
        outcome('Heuristic founder, dynamic price', heuristicFounder),
        ...fixed.map(f => outcome(`Fixed ${dollars(f.priceCents)}${f === best ? ' (best fixed, hindsight)' : ''}`, f.run)),
        outcome(`Fixed ${dollars(rec.brief.maxCacCents)}${best.run === fixedMax ? ' (best fixed, hindsight)' : ''}`, fixedMax),
      ],
      supplyNote: `Every strategy faces the same creators: the Claude creators' recorded decisions are replayed without API calls. ${replay.joinPrice.size} of ${rec.market.creators} creators ever agreed to promote; the rest judged Dealoop a poor fit for their audience or priced below their floor.`,
      runs,
      selected: file,
      creators: profilesFor(rec.seed, rec.market),
    };
  }

  const seed = Number(params.run?.slice('heuristic-'.length) || params.seed || 1) || 1;
  const market = MARKETS.baseline;
  const brief = DEMO_BRIEF;
  const startPriceCents = Math.max(1, Math.round(0.3 * brief.maxCacCents));
  const dynamic = await runCampaign({seed, market, brief, timeline: true, log: true, strategy: {kind: 'dynamic'}});
  const {fixedMax, fixed} = await comparisons(seed, market, brief, undefined);
  const best = [...fixed, {priceCents: brief.maxCacCents, run: fixedMax}].reduce((a, b) => (b.run.users > a.run.users ? b : a));
  return {
    source: 'heuristic',
    title: 'A campaign priced by the heuristic simulator',
    subtitle: `No model calls: a transparent rule forecasts supply, and creators join once the price meets their floor. Seed ${seed}.`,
    seed,
    brief,
    market,
    models: null,
    usage: null,
    series: [
      {key: 'dynamic', label: 'Dynamic price', points: toPoints(dynamic.timeline, startPriceCents, dynamic)},
      {key: 'fixed', label: `Fixed ${dollars(brief.maxCacCents)}`, points: toPoints(fixedMax.timeline, brief.maxCacCents, fixedMax)},
    ],
    log: toLog(dynamic.agentLog),
    outcomes: [
      outcome('Dynamic price', dynamic, true),
      ...fixed.map(f => outcome(`Fixed ${dollars(f.priceCents)}${f === best ? ' (best fixed, hindsight)' : ''}`, f.run)),
      outcome(`Fixed ${dollars(brief.maxCacCents)}${best.run === fixedMax ? ' (best fixed, hindsight)' : ''}`, fixedMax),
    ],
    supplyNote: 'Every strategy faces the same synthetic creators and the same random arrivals; differences come from pricing alone.',
    runs,
    selected: `heuristic-${seed}`,
    creators: profilesFor(seed, market),
  };
}
