// Simulator acceptance: S2 (over-delivery) and S3 (beats the fixed max-CAC
// baseline) from docs/ACCEPTANCE.md, plus determinism and money invariants on
// every simulated book. All data is synthetic (sim/market.ts).

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {committedCents, settle} from '../core/campaign.ts';
import {compare} from '../sim/compare.ts';
import {MARKETS} from '../sim/market.ts';
import {DEMO_BRIEF, runCampaign} from '../sim/run.ts';

const RUNS = 100;

test('S2: in the baseline market the dynamic price over-delivers within budget', async () => {
  const results = [];
  for (let seed = 1; seed <= RUNS; seed++) results.push(await runCampaign({seed, strategy: {kind: 'dynamic'}}));
  const meanUsers = results.reduce((s, r) => s + r.users, 0) / RUNS;
  const goalMet = results.filter(r => r.goalMet).length / RUNS;
  const spend = results.reduce((s, r) => s + r.spendCents, 0);
  const users = results.reduce((s, r) => s + r.users, 0);
  const meanUtilization = results.reduce((s, r) => s + r.utilization, 0) / RUNS;
  assert.ok(meanUsers > DEMO_BRIEF.goalCount, `mean users ${meanUsers}`);
  assert.ok(goalMet >= 0.95, `goal met in ${goalMet * 100}% of runs`);
  assert.ok(spend / users < DEMO_BRIEF.maxCacCents, `average CAC ${spend / users}`);
  assert.ok(meanUtilization > 0.95, `budget utilization ${meanUtilization}`);
  for (const r of results) {
    // Money invariants hold on every simulated book (A1, A2, A4).
    assert.ok(r.spendCents <= DEMO_BRIEF.budgetCents, `seed ${r.seed} overspent`);
    assert.ok(committedCents(r.book) <= DEMO_BRIEF.budgetCents);
    for (const e of r.ledger) assert.equal(e.amountCents, r.finalPriceCents, `seed ${r.seed} paid off the final price`);
    assert.ok(r.finalPriceCents <= DEMO_BRIEF.maxCacCents);
  }
});

test('S3: the dynamic price beats a fixed price at max CAC on the same markets', async () => {
  const c = await compare({runs: RUNS, market: MARKETS.baseline, fixedPricesCents: [1_000]});
  const dynamic = c.summaries.find(s => s.strategy === 'dynamic')!;
  const fixedMax = c.summaries.find(s => s.strategy === 'fixed $10.00')!;
  assert.ok(dynamic.users.mean > fixedMax.users.mean, `${dynamic.users.mean} vs ${fixedMax.users.mean}`);
  assert.ok((dynamic.beatsFixedMaxRate ?? 0) >= 0.7, `beats fixed $10 in ${(dynamic.beatsFixedMaxRate ?? 0) * 100}% of runs`);
  assert.ok(dynamic.avgCacCents < fixedMax.avgCacCents);
});

test('thick markets: the dynamic price finds a much lower CAC than fixed max', async () => {
  const c = await compare({runs: 40, market: MARKETS.thick, fixedPricesCents: [1_000]});
  const dynamic = c.summaries.find(s => s.strategy === 'dynamic')!;
  assert.ok(dynamic.users.mean > 1.8 * DEMO_BRIEF.goalCount, `thick market users ${dynamic.users.mean}`);
  assert.ok(dynamic.avgCacCents < 600);
});

test('runs are reproducible from their seed', async () => {
  const a = await runCampaign({seed: 42, strategy: {kind: 'dynamic'}});
  const b = await runCampaign({seed: 42, strategy: {kind: 'dynamic'}});
  assert.deepEqual(settle(a.book), settle(b.book));
  assert.deepEqual(a.book.priceHistory, b.book.priceHistory);
});
