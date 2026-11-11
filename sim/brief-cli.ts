// npm run brief -- "Help my app get 100 sign-ups..." [--answer "two weeks"] [--simulate]
//
// The founder agent reads a one-sentence brief (one Claude call, under a cent).
// If something required is missing, it prints the question it would ask; pass
// the founder's reply with --answer (repeatable). With --simulate, a complete
// brief is run through the heuristic simulator, which makes no model calls.

import {AnthropicJsonClient, estimateCostUsd, founderModel} from '../agents/claude.ts';
import {parseBrief} from '../agents/brief-parser.ts';
import {createCampaign} from '../core/campaign.ts';
import {MARKETS} from './market.ts';
import {runCampaign} from './run.ts';

const args = process.argv.slice(2);
const answers: string[] = [];
const positional: string[] = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--answer' && args[i + 1]) answers.push(args[++i]);
  else if (!args[i].startsWith('--')) positional.push(args[i]);
}
const sentence = positional.join(' ').trim();
if (!sentence) {
  console.error('Usage: npm run brief -- "Help my app get 100 new sign-ups. Budget $1000, CAC no more than $10." [--answer "two weeks"] [--simulate]');
  process.exit(1);
}
const dollars = (c: number) => '$' + (c / 100).toFixed(2);
const now = Date.now();

const client = new AnthropicJsonClient();
console.log(`Founder: ${sentence}`);
for (const a of answers) console.log(`Founder: ${a}`);
const result = await parseBrief(client, [sentence, ...answers], now);
const cost = estimateCostUsd(client.usage, founderModel());
console.log('');

if (result.status === 'unavailable') {
  console.log(`The founder agent is unavailable (${result.error}). Nothing was created.`);
  process.exit(1);
}
if (result.status === 'invalid') {
  console.log('Founder agent: I can’t set this campaign up as written:');
  for (const p of result.problems) console.log(`  - ${p}`);
  process.exit(0);
}
for (const n of result.notes) console.log(`  note: ${n}`);
if (result.status === 'needs_info') {
  console.log(`Founder agent: ${result.question}`);
  console.log(`\n(No campaign created. Reply with --answer "...". ${client.usage.calls} call${cost !== null ? `, about $${cost.toFixed(3)}` : ''}.)`);
  process.exit(0);
}

const b = result.brief;
const book = createCampaign({id: 'from-brief', goalCount: b.goalCount, budgetCents: b.budgetCents, maxCacCents: b.maxCacCents, deadline: b.deadline, now});
console.log('Founder agent: Here is the campaign I will post.');
console.log(`  Product      ${b.productName}${b.productPitch ? ` — ${b.productPitch}` : ''}`);
console.log(`  Goal         ${b.goalCount} verified sign-ups (more if the budget allows)`);
console.log(`  Budget       ${dollars(b.budgetCents)}`);
console.log(`  Max CAC      ${dollars(b.maxCacCents)} per sign-up`);
console.log(`  Deadline     ${new Date(b.deadline).toISOString().slice(0, 10)} (${b.days} days)`);
console.log(`  Start price  ${dollars(book.campaign.startPriceCents)}, rising by ${dollars(book.campaign.stepCents)} steps when that is expected to bring more sign-ups`);
for (const a of result.assumptions) console.log(`  assumption: ${a}`);
console.log(`\n(${client.usage.calls} call${cost !== null ? `, about $${cost.toFixed(3)}` : ''}.)`);

if (args.includes('--simulate')) {
  const brief = {goalCount: b.goalCount, budgetCents: b.budgetCents, maxCacCents: b.maxCacCents, days: b.days};
  const dynamic = await runCampaign({seed: 1, strategy: {kind: 'dynamic'}, brief, market: MARKETS.baseline});
  const fixed = await runCampaign({seed: 1, strategy: {kind: 'fixed', priceCents: b.maxCacCents}, brief, market: MARKETS.baseline});
  console.log('\nHeuristic simulation on a synthetic market (no model calls):');
  console.log(`  Dynamic price   ${dynamic.users} sign-ups, avg CAC ${dollars(dynamic.avgCacCents)}, spent ${dollars(dynamic.spendCents)}`);
  console.log(`  Fixed ${dollars(b.maxCacCents).padEnd(9)} ${fixed.users} sign-ups, avg CAC ${dollars(fixed.avgCacCents)}, spent ${dollars(fixed.spendCents)}`);
}
