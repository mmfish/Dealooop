// npm run sim:claude -- [--seed 1] [--market baseline] [--creators N] [--days 14] [--agents both|founder|creators]
//
// Runs ONE simulated campaign with Claude agents, and the heuristic simulator on
// the same seed for comparison. Calls the Anthropic API and costs real money:
// a full baseline run makes a few hundred calls. Use --creators and --days to
// keep a trial run small. The market is synthetic; the agents' decisions are real.

import {mkdirSync, writeFileSync} from 'node:fs';
import {AnthropicJsonClient, creatorModel, estimateCostUsd, founderModel} from '../agents/claude.ts';
import {ClaudeSupplyEstimator} from '../agents/founder-estimator.ts';
import {ClaudeCreatorPolicy} from '../agents/creator-agent.ts';
import {MARKETS} from './market.ts';
import {DEMO_BRIEF, runCampaign, SIM_START, type RunResult} from './run.ts';
import {priceAtFrom, ReplayPolicy} from './replay.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const seed = Number(flag('seed', '1'));
const baseMarket = MARKETS[flag('market', 'baseline')];
if (!baseMarket) throw new Error(`Unknown market; use ${Object.keys(MARKETS).join(', ')}.`);
const market = {...baseMarket, creators: Number(flag('creators', String(baseMarket.creators)))};
const brief = {...DEMO_BRIEF, days: Number(flag('days', String(DEMO_BRIEF.days)))};
const which = flag('agents', 'both');

const client = new AnthropicJsonClient();
const estimator = which === 'creators' ? undefined : new ClaudeSupplyEstimator(client);
const creatorPolicy = which === 'founder' ? undefined : new ClaudeCreatorPolicy(client);

const dollars = (c: number) => '$' + (c / 100).toFixed(2);
const hour = (at: number) => `h${String(Math.round((at - SIM_START) / 3_600_000)).padStart(3, ' ')}`;
const summary = (label: string, r: RunResult) =>
  `${label.padEnd(26)} users ${String(r.users).padStart(4)}  avg CAC ${dollars(r.avgCacCents)}  spent ${dollars(r.spendCents)}  final price ${dollars(r.finalPriceCents)}  raises ${r.raises}  creators active ${r.creatorsActive}/${market.creators}`;

console.log(`Dealoop simulator with Claude agents · seed ${seed} · ${market.name} market, ${market.creators} creators · ${brief.days} days`);
console.log(`Founder model: ${estimator ? founderModel() : '(heuristic)'} · creator model: ${creatorPolicy ? creatorModel() : '(threshold rule)'}`);
console.log('SYNTHETIC MARKET — the creators are generated; the agents\' decisions are real model calls.\n');

const started = Date.now();
const claude = await runCampaign({seed, strategy: {kind: 'dynamic'}, market, brief, estimator, creatorPolicy, log: true, timeline: true});
const seconds = ((Date.now() - started) / 1000).toFixed(0);
const heuristic = await runCampaign({seed, strategy: {kind: 'dynamic'}, market, brief});
const fixedMax = await runCampaign({seed, strategy: {kind: 'fixed', priceCents: brief.maxCacCents}, market, brief});

console.log(summary('Claude agents', claude));
console.log(summary('Heuristic simulator', heuristic));
console.log(summary(`Fixed ${dollars(brief.maxCacCents)}`, fixedMax));

// Claude creators decline poor fits, so their market is thinner than the threshold rule's.
// Replay their recorded decisions to compare pricing strategies on the same supply.
if (creatorPolicy) {
  const replay = new ReplayPolicy(claude.agentLog, priceAtFrom(claude.book.campaign.startPriceCents, claude.book.priceHistory));
  const same = {seed, market, brief, creatorPolicy: replay};
  console.log(`\nSame supply (Claude creators' decisions replayed, no API calls; ${replay.joinPrice.size} of ${market.creators} creators ever joined):`);
  console.log(summary(estimator ? 'Claude founder' : 'Heuristic founder', claude));
  if (estimator) console.log(summary('Heuristic founder', await runCampaign({...same, strategy: {kind: 'dynamic'}})));
  const fixedPrices = [0.7, 0.8, 0.9, 1].map(f => Math.round(f * brief.maxCacCents));
  for (const p of fixedPrices) console.log(summary(`Fixed ${dollars(p)}`, await runCampaign({...same, strategy: {kind: 'fixed', priceCents: p}})));
}

console.log('\nPrice decisions (founder agent → core):');
for (const e of claude.agentLog.filter(x => x.actor === 'founder' && x.kind === 'raise')) console.log(`  ${hour(e.at)}  RAISE  ${e.text}`);
const holds = claude.agentLog.filter(x => x.actor === 'founder' && x.kind === 'hold');
if (holds.length) console.log(`  …and ${holds.length} holds; last: ${hour(holds.at(-1)!.at)}  ${holds.at(-1)!.text}`);

console.log('\nCreator decisions (sample):');
const creatorEntries = claude.agentLog.filter(x => x.actor !== 'founder');
const sample = [...creatorEntries.filter(e => e.kind === 'join').slice(0, 4), ...creatorEntries.filter(e => e.kind === 'decline').slice(0, 4)];
for (const e of sample) console.log(`  ${hour(e.at)}  ${e.actor}  ${e.kind.toUpperCase().padEnd(7)}  ${e.text}`);
const fellBack = claude.agentLog.filter(e => e.fellBack).length;

const usage = client.usage;
const cost = estimateCostUsd(usage, founderModel());
console.log(`\nAPI usage: ${usage.calls} calls, ${usage.failures} failed (fell back ${fellBack} times), ${usage.inputTokens.toLocaleString('en-US')} input / ${usage.outputTokens.toLocaleString('en-US')} output tokens, ${seconds}s.`);
for (const [purpose, p] of Object.entries(usage.byPurpose)) console.log(`  ${purpose}: ${p.calls} calls, ${p.inputTokens.toLocaleString('en-US')} in / ${p.outputTokens.toLocaleString('en-US')} out`);
if (cost !== null && founderModel() === creatorModel()) console.log(`Estimated cost at list price: $${cost.toFixed(2)}`);

mkdirSync('data/sim-runs', {recursive: true});
const file = `data/sim-runs/claude-seed${seed}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const {book, ...rest} = claude;
writeFileSync(file, JSON.stringify({seed, market, brief, models: {founder: founderModel(), creator: creatorModel()}, usage, claude: {...rest, priceHistory: book.priceHistory}, heuristic: {users: heuristic.users, spendCents: heuristic.spendCents, finalPriceCents: heuristic.finalPriceCents}, fixedMax: {users: fixedMax.users, spendCents: fixedMax.spendCents}}, null, 2));
console.log(`\nSaved the run to ${file}`);
