// Matching on a live campaign and the creator-question protocol (DEMO-FLOW
// beats 3–4). The model is a fake that answers from the prompt, so these
// tests make no network calls.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyUsage, type JsonClient, type JsonRequest, type JsonResult} from '../agents/claude.ts';
import {buildMatchPrompt, decideMatch} from '../agents/match-agent.ts';
import {SQLiteDatabase} from '../runtime/sqlite.ts';
import {CampaignStore, StoreError} from '../db/campaign-store.ts';
import {campaignView} from '../db/campaign-view.ts';
import {DEMO_CREATORS, YI} from '../sim/demo-creators.ts';
import {runMatching, type MatchRecording} from '../sim/match.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 14, 9);
const BRIEF = 'Promote Dealoop: 100 new sign-ups, the more the better. Budget $1000, no more than $10 each.\nIn two weeks';

type Reply = (user: string) => JsonResult<unknown>;
class FakeClient implements JsonClient {
  readonly usage = emptyUsage();
  readonly prompts: string[] = [];
  constructor(private readonly reply: Reply) {}
  async json<T>(request: JsonRequest<T>): Promise<JsonResult<T>> {
    this.prompts.push(request.user);
    this.usage.calls++;
    const r = this.reply(request.user);
    if (!r.ok) return r as JsonResult<T>;
    const checked = request.validate.safeParse(r.value);
    return checked.success ? {ok: true, value: checked.data, model: 'fake'} : {ok: false, error: 'output failed validation'};
  }
}

/** Joins startup-ish niches, declines the rest, and asks whenever its owner's instructions say to. */
const sensible: Reply = user => {
  if (user.includes('ask the founder first')) return {ok: true, value: {action: 'ask', reason: 'my audience needs to know the price.', question: 'Can I say Dealoop is free?'}, model: 'fake'};
  const fit = /founder|indie|SaaS|launch|maker|startup|creator|no-code|agent/i.test(user.split('\n')[0]);
  return {ok: true, value: fit ? {action: 'join', reason: 'good fit for my audience.', question: ''} : {action: 'decline', reason: 'wrong audience.', question: ''}, model: 'fake'};
};

async function setup() {
  const sqlite = new SQLiteDatabase(':memory:');
  sqlite.migrate('drizzle');
  const store = new CampaignStore(sqlite.asD1());
  await store.createCampaign({id: 'c', ownerId: 'summer', ownerName: 'Summer', title: 'Dealoop', brief: BRIEF, productUrl: '', goalCount: 100, budgetCents: 100_000, maxCacCents: 1_000, deadline: NOW + 14 * DAY, now: NOW});
  return {sqlite, store};
}

test('each creator agent sees only its own owner, and the campaign as data', () => {
  const [maya, dan] = DEMO_CREATORS;
  const prompt = buildMatchPrompt(maya, {title: 'Dealoop', brief: BRIEF, productUrl: '', priceCents: 300, maxCacCents: 1000, deadline: NOW + 14 * DAY, now: NOW});
  assert.match(prompt, /\$3\.00 per verified sign-up/);
  assert.match(prompt, /<campaign>[\s\S]*Promote Dealoop[\s\S]*<\/campaign>/);
  assert.ok(prompt.includes(maya.note!));
  assert.ok(!prompt.includes(dan.handle), 'no other creator appears');
});

test('the floor overrules the model, and a failed call falls back to the rule', async () => {
  const chef = DEMO_CREATORS.find(c => c.handle === '@weeknightchef')!;
  const c = {title: 'Dealoop', brief: BRIEF, productUrl: '', priceCents: 300, maxCacCents: 1000, deadline: NOW + DAY, now: NOW};
  const eager = new FakeClient(() => ({ok: true, value: {action: 'join', reason: 'sure', question: ''}, model: 'fake'}));
  assert.equal((await decideMatch(eager, chef, c)).action, 'decline', 'a join below the $5 floor is overruled');
  const asker = new FakeClient(() => ({ok: true, value: {action: 'ask', reason: 'x', question: 'Is it free?'}, model: 'fake'}));
  assert.equal((await decideMatch(asker, chef, c)).action, 'decline', 'so is a question that would end in a join below the floor');
  const down = new FakeClient(() => ({ok: false, error: 'overloaded'}));
  const d = await decideMatch(down, DEMO_CREATORS[1], c);
  assert.deepEqual([d.action, d.fellBack], ['join', true]);
});

test('matching writes every decision to the feed, and a rerun adds nothing', async () => {
  const {store} = await setup();
  const client = new FakeClient(sensible);
  const decisions = await runMatching(store, 'c', {client, now: () => NOW + 1000});
  assert.equal(decisions.length, DEMO_CREATORS.length);
  assert.equal(client.usage.calls, DEMO_CREATORS.length);
  const v = (await campaignView(store, 'c'))!;
  const joins = decisions.filter(d => d.decision.action === 'join').length;
  assert.ok(joins > 3 && joins < DEMO_CREATORS.length - 3, 'some join, some decline');
  assert.equal(v.joinedCount, joins);
  assert.equal(v.askingCount, 1);
  assert.equal(v.creators.find(c => c.handle === '@growthwithmaya')!.status, 'asking');
  assert.ok(v.creators.some(c => c.status === 'declined' && c.note === 'wrong audience.'));
  assert.ok(v.feed.some(e => e.kind === 'clarification.asked' && e.tone === 'question'));
  assert.ok(v.creators.find(c => c.handle === YI.handle) === undefined, 'Yi decides for himself, in his own window');

  const again = await runMatching(store, 'c', {client, now: () => NOW + 2000});
  assert.equal(again.length, 0);
  assert.equal(client.usage.calls, DEMO_CREATORS.length, 'no new calls for creators who already decided');
});

test('a recorded run replays with no model calls', async () => {
  const first = await setup();
  const decisions = await runMatching(first.store, 'c', {client: new FakeClient(sensible), now: () => NOW + 1000});
  const recording: MatchRecording = {campaignTitle: 'Dealoop', recordedAt: new Date(NOW).toISOString(), model: 'fake', decisions};
  const second = await setup();
  const replayed = await runMatching(second.store, 'c', {recording, now: () => NOW + 1000});
  assert.deepEqual(replayed.map(d => [d.userId, d.decision.action]).sort(), decisions.map(d => [d.userId, d.decision.action]).sort());
  assert.equal((await campaignView(second.store, 'c'))!.joinedCount, (await campaignView(first.store, 'c'))!.joinedCount);
});

test('the founder answers a question once, and the creator joins with that wording', async () => {
  const {store} = await setup();
  await runMatching(store, 'c', {client: new FakeClient(sensible), now: () => NOW + 1000});
  const [q] = await store.questions('c', 'pending');
  assert.equal(q.question, 'Can I say Dealoop is free?');
  const {link} = await store.answerQuestion(q.id, 'Free to post a campaign; you pay only for verified sign-ups.', NOW + 5000);
  assert.ok(link.token);
  await assert.rejects(store.answerQuestion(q.id, 'again', NOW + 6000), (e: unknown) => e instanceof StoreError && e.code === 'CONFLICT');
  const v = (await campaignView(store, 'c'))!;
  const maya = v.creators.find(c => c.handle === '@growthwithmaya')!;
  assert.equal(maya.status, 'joined');
  assert.match(maya.note, /Free to post a campaign/);
  assert.equal(v.askingCount, 0);
  assert.deepEqual(v.feed.filter(e => e.kind.startsWith('clarification')).map(e => e.tone), ['question', 'approval']);
});

test('questions are refused on a closed campaign and from creators without a profile', async () => {
  const {store} = await setup();
  await assert.rejects(store.askQuestion('c', 'nobody', 'hi?', NOW), (e: unknown) => e instanceof StoreError && e.code === 'NO_PROFILE');
  await runMatching(store, 'c', {client: new FakeClient(() => ({ok: true, value: {action: 'decline', reason: 'no', question: ''}, model: 'fake'})), now: () => NOW});
  await store.closeAndSettle('c', NOW + 15 * DAY);
  await assert.rejects(store.askQuestion('c', DEMO_CREATORS[0].userId, 'hi?', NOW + 15 * DAY), (e: unknown) => e instanceof StoreError && e.code === 'CAMPAIGN_CLOSED');
});
