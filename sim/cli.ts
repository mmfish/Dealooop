// npm run sim -- [--runs 200] [--market baseline|thin|thick|all] [--tick 6] [--seed 1] [--json]
// Prints the strategy comparison (SPEC §10). All numbers come from synthetic markets.

import {compare, type Comparison} from './compare.ts';
import {MARKETS} from './market.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const runs = Number(flag('runs', '200'));
const tickHours = Number(flag('tick', '6'));
const firstSeed = Number(flag('seed', '1'));
const marketArg = flag('market', 'all');
const asJson = args.includes('--json');
const markets = marketArg === 'all' ? Object.values(MARKETS) : [MARKETS[marketArg]];
if (markets.some(m => !m)) throw new Error(`Unknown market ${marketArg}; use ${Object.keys(MARKETS).join(', ')} or all.`);

const dollars = (c: number) => '$' + (c / 100).toFixed(2);
const pct = (x: number) => (x * 100).toFixed(0) + '%';

function print(c: Comparison) {
  console.log(`\nMarket: ${c.market}  ·  brief: ${c.brief.goalCount} users, ${dollars(c.brief.budgetCents)} budget, max CAC ${dollars(c.brief.maxCacCents)}, ${c.brief.days} days  ·  ${c.summaries[0].runs} runs`);
  console.log('SYNTHETIC DATA — not a measurement of real creators.\n');
  const rows = c.summaries.map(s => [
    s.strategy + (s === c.bestFixed ? '  (best fixed, hindsight)' : ''),
    s.users.mean.toFixed(1), `${s.users.p10}–${s.users.p90}`, dollars(s.avgCacCents), pct(s.utilization), pct(s.goalMetRate),
    s.strategy.startsWith('fixed $' + (c.brief.maxCacCents / 100).toFixed(2)) ? '—' : pct(s.beatsFixedMaxRate ?? 0),
  ]);
  const header = ['strategy', 'users (mean)', 'users p10–p90', 'avg CAC', 'budget used', 'goal met', `beats fixed ${dollars(c.brief.maxCacCents)}`];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length)));
  const line = (r: string[]) => r.map((x, i) => (i === 0 ? x.padEnd(widths[i]) : x.padStart(widths[i]))).join('  ');
  console.log(line(header));
  console.log(widths.map(w => '-'.repeat(w)).join('  '));
  rows.forEach(r => console.log(line(r)));
}

const results: Comparison[] = [];
for (const market of markets) results.push(await compare({runs, market, tickHours, firstSeed}));
if (asJson) console.log(JSON.stringify(results, null, 2));
else results.forEach(print);
