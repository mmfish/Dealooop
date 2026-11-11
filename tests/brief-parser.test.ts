// S1: the founder's one sentence becomes a campaign, and a missing or invented
// value turns into a question instead of a guess. Claude is replaced by a fake
// client that returns a scripted extraction; the judging code is the real one.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {judgeExtraction, numbersIn, parseBrief, type Extraction} from '../agents/brief-parser.ts';
import {emptyUsage, type JsonClient, type JsonRequest, type JsonResult} from '../agents/claude.ts';
import {createCampaign} from '../core/campaign.ts';

const NOW = Date.UTC(2026, 10, 12, 9);
const S1 = 'Help my app get 100 new sign-ups, the more the better. Budget $1000, CAC no more than $10.';
const S1_WITH_DEADLINE = S1 + ' Run it for two weeks.';

const none: Extraction = {
  product_name: '', product_description: '', goal_count: 0, goal_quote: '', budget_dollars: 0, budget_quote: '',
  max_cac_dollars: 0, max_cac_quote: '', deadline_date: '', deadline_quote: '', quantity_intent: 'unstated',
};
const s1Extraction: Extraction = {
  ...none, goal_count: 100, goal_quote: '100 new sign-ups', budget_dollars: 1000, budget_quote: 'Budget $1000',
  max_cac_dollars: 10, max_cac_quote: 'CAC no more than $10', quantity_intent: 'more_is_better',
};

test('S1: the brief without a deadline produces a question, and no campaign', () => {
  const r = judgeExtraction(S1, s1Extraction, NOW);
  assert.equal(r.status, 'needs_info');
  if (r.status !== 'needs_info') return;
  assert.deepEqual(r.missing, ['deadline']);
  assert.match(r.question, /When should the campaign end/);
  assert.equal(r.partial.goalCount, 100);
  assert.equal(r.partial.budgetCents, 100_000);
  assert.equal(r.partial.maxCacCents, 1_000);
  // And the core refuses to create a campaign without one, independently.
  assert.throws(() => createCampaign({id: 'x', goalCount: 100, budgetCents: 100_000, maxCacCents: 1_000, deadline: r.partial.deadline, now: NOW}), {code: 'MISSING_DEADLINE'});
});

test('S1: with a deadline, the brief becomes the expected campaign', () => {
  const r = judgeExtraction(S1_WITH_DEADLINE, {...s1Extraction, deadline_date: '2026-11-26', deadline_quote: 'Run it for two weeks'}, NOW);
  assert.equal(r.status, 'complete');
  if (r.status !== 'complete') return;
  assert.equal(r.brief.days, 14);
  const book = createCampaign({id: 'c', goalCount: r.brief.goalCount, budgetCents: r.brief.budgetCents, maxCacCents: r.brief.maxCacCents, deadline: r.brief.deadline, now: NOW});
  assert.equal(book.campaign.startPriceCents, 300);
  assert.deepEqual(r.assumptions, []);
});

test('values that do not appear in the founder\'s words are discarded, not used', () => {
  // Claude "helpfully" invents a deadline and inflates the budget.
  const r = judgeExtraction(S1, {...s1Extraction, budget_dollars: 10_000, deadline_date: '2026-11-26', deadline_quote: 'within two weeks'}, NOW);
  assert.equal(r.status, 'needs_info');
  if (r.status !== 'needs_info') return;
  assert.deepEqual(r.missing, ['deadline', 'budget']);
  assert.ok(r.notes.some(n => /deadline because it does not appear/.test(n)));
  assert.ok(r.notes.some(n => /budget of 10000/.test(n)));
});

test('a computed value is not a stated one: no maximum CAC means a question', () => {
  const text = 'Get me 200 users with $1,000 by December 1.';
  const r = judgeExtraction(text, {...none, goal_count: 200, goal_quote: '200 users', budget_dollars: 1000, budget_quote: '$1,000', max_cac_dollars: 5, max_cac_quote: '', deadline_date: '2026-12-01', deadline_quote: 'by December 1'}, NOW);
  assert.equal(r.status, 'needs_info');
  if (r.status === 'needs_info') assert.deepEqual(r.missing, ['maxCac']);
});

test('a missing goal is filled from budget and max CAC, and said so', () => {
  const text = 'Spend up to $500, at most $5 per sign-up, over 10 days.';
  const r = judgeExtraction(text, {...none, budget_dollars: 500, budget_quote: '$500', max_cac_dollars: 5, max_cac_quote: '$5 per sign-up', deadline_date: '2026-11-22', deadline_quote: 'over 10 days'}, NOW);
  assert.equal(r.status, 'complete');
  if (r.status !== 'complete') return;
  assert.equal(r.brief.goalCount, 100);
  assert.match(r.assumptions[0], /budget ÷ maximum CAC = 100/);
});

test('past deadlines, CAC above budget and fixed quantities are handled', () => {
  const past = judgeExtraction('100 users, $1000, $10 each, by Nov 1.', {...s1Extraction, goal_quote: '100 users', budget_quote: '$1000', max_cac_quote: '$10 each', deadline_date: '2026-11-01', deadline_quote: 'by Nov 1'}, NOW);
  assert.equal(past.status, 'needs_info');
  const inverted = judgeExtraction('Budget $50, $100 per user, 2 weeks.', {...none, budget_dollars: 50, budget_quote: 'Budget $50', max_cac_dollars: 100, max_cac_quote: '$100 per user', deadline_date: '2026-11-26', deadline_quote: '2 weeks'}, NOW);
  assert.equal(inverted.status, 'invalid');
  const exactly = judgeExtraction(S1_WITH_DEADLINE, {...s1Extraction, quantity_intent: 'exactly', deadline_date: '2026-11-26', deadline_quote: 'two weeks'}, NOW);
  assert.equal(exactly.status, 'complete');
  if (exactly.status === 'complete') assert.ok(exactly.notes.some(n => /treats the goal as a minimum/.test(n)));
});

test('Chinese briefs are grounded the same way', () => {
  const text = '帮我的app拉新100个注册用户，越多越好。预算1000刀，CAC不超过10刀，两周内完成。';
  const r = judgeExtraction(text, {...none, goal_count: 100, goal_quote: '拉新100个注册用户', budget_dollars: 1000, budget_quote: '预算1000刀', max_cac_dollars: 10, max_cac_quote: 'CAC不超过10刀', deadline_date: '2026-11-26', deadline_quote: '两周内完成', quantity_intent: 'more_is_better'}, NOW);
  assert.equal(r.status, 'complete');
  assert.deepEqual(numbersIn('预算1千刀'), [1000]);
  assert.deepEqual(numbersIn('$1.5k budget'), [1500]);
});

test('parseBrief joins the founder\'s follow-up answer and reports an unavailable model', async () => {
  const seen: string[] = [];
  const client: JsonClient = {
    usage: emptyUsage(),
    async json<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
      seen.push(req.user);
      const v = req.validate.safeParse({...s1Extraction, deadline_date: '2026-11-26', deadline_quote: 'two weeks'});
      return v.success ? {ok: true, value: v.data, model: 'fake'} : {ok: false, error: 'invalid'};
    },
  };
  const r = await parseBrief(client, [S1, 'two weeks'], NOW);
  assert.equal(r.status, 'complete');
  assert.ok(seen[0].includes(S1) && seen[0].includes('two weeks') && seen[0].includes("Today's date: 2026-11-12"));
  const down: JsonClient = {usage: emptyUsage(), json: async () => ({ok: false, error: 'connection error'})};
  assert.deepEqual(await parseBrief(down, [S1], NOW), {status: 'unavailable', error: 'connection error'});
});
