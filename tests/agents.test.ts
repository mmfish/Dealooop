// Claude agent wiring, tested without the network: a fake JSON client for the
// agents, and a stubbed SDK object for the client wrapper. Covers privacy of
// prompts, mandate enforcement, fallbacks, and that no estimate can break money rules.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import type Anthropic from '@anthropic-ai/sdk';
import {AnthropicJsonClient, emptyUsage, type JsonClient, type JsonRequest, type JsonResult} from '../agents/claude.ts';
import {ClaudeSupplyEstimator} from '../agents/founder-estimator.ts';
import {ClaudeCreatorPolicy} from '../agents/creator-agent.ts';
import {generateMarket, generateProfiles, MARKETS, createRng} from '../sim/market.ts';
import {DEMO_BRIEF, runCampaign} from '../sim/run.ts';
import {DEALOOP_SEED_PRODUCT} from '../sim/policy.ts';

type Reply = (request: JsonRequest<unknown>) => JsonResult<unknown>;

class FakeClient implements JsonClient {
  readonly usage = emptyUsage();
  readonly requests: JsonRequest<unknown>[] = [];
  constructor(private readonly reply: Reply) {}
  async json<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
    this.requests.push(request as JsonRequest<unknown>);
    this.usage.calls++;
    const r = this.reply(request as JsonRequest<unknown>);
    if (!r.ok) return r;
    // Real agents' output is validated; the fake goes through the same schema.
    const checked = request.validate.safeParse(r.value);
    return checked.success ? {ok: true, value: checked.data, model: 'fake'} : {ok: false, error: 'output failed validation'};
  }
}

const founderReply = (current: number, raised: number): Reply => req =>
  req.purpose === 'founder.estimate'
    ? {ok: true, value: {supply_at_current: current, supply_at_raised: raised, rationale: 'fake'}, model: 'fake'}
    : {ok: false, error: 'unexpected'};

test('founder prompts contain only platform observations, never creators\' hidden economics', async () => {
  const client = new FakeClient(founderReply(10, 30));
  const seed = 5;
  await runCampaign({seed, strategy: {kind: 'dynamic'}, estimator: new ClaudeSupplyEstimator(client)});
  assert.ok(client.requests.length > 10);
  const creators = generateMarket(MARKETS.baseline, createRng(seed));
  for (const r of client.requests) {
    assert.doesNotMatch(r.user, /creator-\d\d/, 'creator identities stay out of the founder prompt');
    assert.doesNotMatch(r.user, /floor|capacity|minimum take-home|daily rate/i);
    // Hidden floors that are not also a price level the campaign has used must never appear.
    const visiblePrices = new Set(r.user.match(/\$\d+\.\d\d/g) ?? []);
    for (const c of creators) {
      const floor = `$${(c.minPriceCents / 100).toFixed(2)}`;
      if (c.minPriceCents % 100 !== 0) assert.ok(!visiblePrices.has(floor), `hidden floor ${floor} leaked`);
    }
  }
});

test('B3 end to end: absurd Claude estimates cannot overspend or overpay', async () => {
  for (const [current, raised] of [[0, 1_000_000], [1_000_000, 0], [0, 0], [999_999, 1_000_000]]) {
    const r = await runCampaign({seed: 11, strategy: {kind: 'dynamic'}, estimator: new ClaudeSupplyEstimator(new FakeClient(founderReply(current, raised)))});
    assert.ok(r.spendCents <= DEMO_BRIEF.budgetCents);
    assert.ok(r.finalPriceCents <= DEMO_BRIEF.maxCacCents);
    for (const e of r.ledger) assert.equal(e.amountCents, r.finalPriceCents);
  }
});

test('when Claude is unavailable, the run completes on the heuristic and says so', async () => {
  const down = new FakeClient(() => ({ok: false, error: 'connection error'}));
  const withFallback = await runCampaign({seed: 3, strategy: {kind: 'dynamic'}, estimator: new ClaudeSupplyEstimator(down), creatorPolicy: new ClaudeCreatorPolicy(down), log: true});
  const heuristic = await runCampaign({seed: 3, strategy: {kind: 'dynamic'}});
  assert.equal(withFallback.users, heuristic.users, 'fallbacks reproduce the heuristic run exactly');
  assert.equal(withFallback.spendCents, heuristic.spendCents);
  const creatorEntries = withFallback.agentLog.filter(e => e.actor !== 'founder');
  assert.ok(creatorEntries.length > 0 && creatorEntries.every(e => e.fellBack));
  assert.ok(withFallback.agentLog.filter(e => e.actor === 'founder').every(e => e.text.includes('Claude unavailable')));
});

test('creator agents see only their own owner\'s profile and floor', async () => {
  const client = new FakeClient(req => (req.purpose === 'creator.decide' ? {ok: true, value: {join: true, rationale: 'fits'}, model: 'fake'} : {ok: false, error: 'x'}));
  const seed = 9;
  await runCampaign({seed, strategy: {kind: 'fixed', priceCents: 1_000}, creatorPolicy: new ClaudeCreatorPolicy(client)});
  const creators = generateMarket(MARKETS.baseline, createRng(seed));
  const profiles = generateProfiles(creators, seed);
  assert.equal(client.requests.length, creators.length, 'each creator is asked once at a fixed price');
  for (const r of client.requests) {
    const own = [...profiles.values()].filter(p => r.user.includes(p.handle + ' '));
    assert.equal(own.length, 1, 'exactly one owner per prompt');
    const floors = r.user.match(/minimum take-home: \$[\d.]+/g) ?? [];
    assert.equal(floors.length, 1, 'only the owner\'s own floor');
    assert.ok(r.user.includes(DEALOOP_SEED_PRODUCT.productName));
  }
});

test('a creator agent that accepts below its owner\'s floor is overruled', async () => {
  const yes = new FakeClient(() => ({ok: true, value: {join: true, rationale: 'sure'}, model: 'fake'}));
  const policy = new ClaudeCreatorPolicy(yes);
  const profile = {id: 'c', handle: '@c', niche: 'AI tools', platform: 'X', followers: 1000};
  const offer = {...DEALOOP_SEED_PRODUCT, priceCents: 300, maxCacCents: 1000, remainingBudgetCents: 100_000, hoursLeft: 300};
  const below = await policy.decide({profile, minTakeHomeCents: 500, offer});
  assert.equal(below.join, false);
  assert.match(below.rationale, /Overruled/);
  const above = await policy.decide({profile, minTakeHomeCents: 200, offer});
  assert.equal(above.join, true);
});

// --- The SDK wrapper, with a stubbed client object -------------------------

function stubSdk(response: Partial<Anthropic.Beta.BetaMessage>, seen: unknown[] = []) {
  const message = {model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: {input_tokens: 100, output_tokens: 20}, content: [], ...response};
  return {beta: {messages: {create: async (params: unknown) => { seen.push(params); return message; }}}} as unknown as Anthropic;
}

const request = {
  purpose: 'test', model: 'claude-opus-5-5', effort: 'low' as const, system: 's', user: 'u',
  jsonSchema: {type: 'object', properties: {join: {type: 'boolean'}}, required: ['join'], additionalProperties: false},
  validate: (await import('zod')).z.object({join: (await import('zod')).z.boolean()}),
};

test('the SDK wrapper sends structured-output and fallback settings and validates replies', async () => {
  const seen: unknown[] = [];
  const ok = await new AnthropicJsonClient(stubSdk({content: [{type: 'text', text: '{"join":true}', citations: null} as Anthropic.Beta.BetaTextBlock]}, seen)).json(request);
  assert.deepEqual(ok, {ok: true, value: {join: true}, model: 'claude-opus-5-5'});
  const params = seen[0] as Record<string, any>;
  assert.equal(params.fallbacks, 'default');
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(params.output_config.format.type, 'json_schema');
  assert.equal(params.output_config.effort, 'low');

  const text = (t: string) => [{type: 'text', text: t, citations: null} as Anthropic.Beta.BetaTextBlock];
  const refused = await new AnthropicJsonClient(stubSdk({stop_reason: 'refusal', content: []})).json(request);
  assert.deepEqual(refused, {ok: false, error: 'refused'});
  const notJson = await new AnthropicJsonClient(stubSdk({content: text('yes')})).json(request);
  assert.deepEqual(notJson, {ok: false, error: 'output was not JSON'});
  const wrongShape = await new AnthropicJsonClient(stubSdk({content: text('{"join":"maybe"}')})).json(request);
  assert.deepEqual(wrongShape, {ok: false, error: 'output failed validation'});

  const client = new AnthropicJsonClient(stubSdk({content: text('{"join":false}')}));
  await client.json(request);
  await client.json(request);
  assert.equal(client.usage.calls, 2);
  assert.equal(client.usage.inputTokens, 200);
  assert.equal(client.usage.byPurpose.test.outputTokens, 40);
});

test('replaying recorded creator decisions reproduces the recorded run exactly', async () => {
  const {ReplayPolicy, priceAtFrom} = await import('../sim/replay.ts');
  const {ThresholdPolicy} = await import('../sim/policy.ts');
  // Record a run, replay its creators' decisions, and the same pricing must give the same result.
  const recorded = await runCampaign({seed: 4, strategy: {kind: 'dynamic'}, creatorPolicy: new ThresholdPolicy(), log: true});
  const replay = new ReplayPolicy(recorded.agentLog, priceAtFrom(recorded.book.campaign.startPriceCents, recorded.book.priceHistory));
  const replayed = await runCampaign({seed: 4, strategy: {kind: 'dynamic'}, creatorPolicy: replay});
  assert.equal(replayed.users, recorded.users);
  assert.equal(replayed.spendCents, recorded.spendCents);
  assert.deepEqual(replayed.book.priceHistory, recorded.book.priceHistory);
});
