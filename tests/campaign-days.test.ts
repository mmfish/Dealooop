// The campaign's days on the platform clock (DEMO-FLOW beats 5a, 6, 5b and 7):
// days 1–5, a private deal at the pause, days 6–14 and settlement, on one
// stored campaign; and the reset that starts each recording take. No model calls.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SQLiteDatabase} from '../runtime/sqlite.ts';
import {CampaignStore} from '../db/campaign-store.ts';
import {campaignDay, campaignView, DAY_MS} from '../db/campaign-view.ts';
import {DEMO_CREATORS, BEAN} from '../sim/demo-creators.ts';
import {runDays} from '../sim/campaign-days.ts';
import {resetDemo} from '../sim/demo-reset.ts';
import {RuleNegotiator, runStoredNegotiation} from '../sim/negotiation-run.ts';
import {negotiationView} from '../mcp/deal-tools.ts';

/** A posted campaign after matching: the cheap, well-matched creators joined, the rest declined. */
async function matched() {
  const sqlite = new SQLiteDatabase(':memory:');
  sqlite.migrate('drizzle');
  const store = new CampaignStore(sqlite.asD1());
  await resetDemo(store);
  const now = await store.now();
  await store.upsertCreator({...BEAN, demo: false, now});
  await store.createCampaign({id: 'c', ownerId: 'summer', ownerName: 'Summer', title: 'Dealoop', brief: 'Promote Dealoop.', productUrl: '', goalCount: 100, budgetCents: 100_000, maxCacCents: 1_000, deadline: now + 14 * DAY_MS, now, demo: true});
  for (const c of DEMO_CREATORS) {
    if (c.fit && c.floorCents <= 300) await store.join('c', c.userId, now, 'good fit');
    else await store.decline('c', c.userId, c.fit ? 'below my minimum' : 'wrong audience', now);
  }
  return {store, createdAt: now};
}

test('the platform clock is shared through the database and never runs back', async () => {
  const {store} = await matched();
  const t = await store.now();
  await store.setClock(t + 3 * DAY_MS);
  const ahead = await store.now();
  assert.ok(Math.abs(ahead - (t + 3 * DAY_MS)) < 1000);
  await store.setClock(t);
  assert.ok(await store.now() >= ahead, 'a stale writer cannot move the clock back');
  await resetDemo(store);
  assert.ok(Math.abs(await store.now() - Date.now()) < 1000, 'a reset puts it back on real time');
});

test('days 1–5, a deal at the pause, then days 6–14 and settlement', async () => {
  const {store, createdAt} = await matched();
  const first = await runDays(store, 'c', {to: 5});
  const now = await store.now();
  assert.ok(Math.abs(now - (createdAt + 5 * DAY_MS)) < 1000, 'the clock pauses at the end of day 5');
  assert.equal(campaignDay(now + 1, createdAt, createdAt + 14 * DAY_MS), 'Day 6 of 14');
  assert.ok(first.signUps > 20 && !first.settled);
  const atPause = (await campaignView(store, 'c'))!;
  assert.equal(atPause.status, 'open');

  // Bean's window at the pause sees the same day as the page.
  const rules = new RuleNegotiator();
  const out = await runStoredNegotiation({store, campaignId: 'c', creatorId: BEAN.userId, creatorAgent: rules, founderAgent: rules, now: () => Date.now() + (now - Date.now()), mandates: {creator: {minPriceCents: 650}, founder: {maxPriceCents: 750, maxVolume: 50}}});
  assert.equal(out.negotiation.status, 'agreed');
  const [stored] = await store.negotiations('c');
  const seen = await negotiationView(store, stored, 'creator', 'http://x', await store.now());
  assert.equal(seen.public_facts.days_left, 9);

  const second = await runDays(store, 'c', {to: 'end'});
  assert.ok(second.settled);
  const v = (await campaignView(store, 'c'))!;
  assert.equal(v.status, 'closed');
  const r = v.results!;
  assert.ok(r.verified > r.fixedAtMaxCount, `more sign-ups (${r.verified}) than a fixed $10 buys (${r.fixedAtMaxCount})`);
  assert.ok(r.paidCents <= v.budgetCents);
  const yi = v.creators.find(c => c.userId === BEAN.userId)!;
  assert.ok(yi.signUps > 0 && yi.deal, 'Bean joined with the deal and brought sign-ups');
  assert.ok(yi.paidCents! >= yi.verified * yi.deal!.priceCents, 'his verified sign-ups are paid at least the deal price');
  assert.ok(v.feed.some(e => e.tone === 'refused'), 'at least one refused proposal is visible, for beat 8');
  assert.ok(v.feed.some(e => e.tone === 'price'), 'and at least one raise');
  const times = (await store.events('c', 0, 1000)).map(e => e.createdAt);
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'the feed reads in time order');
});

test('running in two parts gives the same days as running in one', async () => {
  const a = await matched();
  await runDays(a.store, 'c', {to: 5});
  await runDays(a.store, 'c', {to: 'end'});
  const b = await matched();
  await runDays(b.store, 'c', {to: 'end'});
  const total = async (s: CampaignStore) => (await s.ledger('c')).map(e => [e.creatorId, e.amountCents]).sort();
  assert.deepEqual(await total(a.store), await total(b.store));
});

test('a reset removes every campaign and reseeds the creators', async () => {
  const {store} = await matched();
  await runDays(store, 'c', {to: 2});
  const removed = await resetDemo(store);
  assert.ok(removed.campaigns === 1 && removed.conversions > 0);
  assert.equal((await store.list()).length, 0);
  assert.equal((await store.creators()).length, DEMO_CREATORS.length, 'only the simulated creators are reseeded');
});
