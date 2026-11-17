// The campaign store persists exactly what the core decides. These tests run
// against real SQLite with every migration applied, and compare the stored Book
// with the same operations applied to an in-memory Book.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SQLiteDatabase} from '../runtime/sqlite.ts';
import {CampaignStore, StoreError} from '../db/campaign-store.ts';
import {
  applyAgentProposal, closeCampaign, CoreError, createCampaign, recordConversion, rejectConversion, settle, verifyConversion,
  type Book,
} from '../core/campaign.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 12, 9);

function setup() {
  const sqlite = new SQLiteDatabase(':memory:');
  sqlite.migrate('drizzle');
  return {sqlite, store: new CampaignStore(sqlite.asD1())};
}

const base = {ownerId: 'founder', ownerName: 'Summer', title: 'Dealoop', brief: 'Help my app get 100 new sign-ups.', productUrl: 'https://dealoop.test', goalCount: 100, budgetCents: 100_000, maxCacCents: 1_000, deadline: NOW + 14 * DAY, now: NOW};

async function creator(store: CampaignStore, id: string, priorVerified = 0) {
  await store.upsertCreator({userId: id, handle: '@' + id, platform: 'YouTube', niche: 'startups', audience: 'founders', followers: 10_000, priorVerified, demo: true, now: NOW});
}

test('a campaign round-trips, and a missing deadline writes nothing', async () => {
  const {store} = setup();
  const s = await store.createCampaign({...base, id: 'c1'});
  const expected = createCampaign({id: 'c1', goalCount: 100, budgetCents: 100_000, maxCacCents: 1_000, deadline: base.deadline, now: NOW});
  assert.deepEqual(s.book, expected);
  assert.equal(s.meta.title, 'Dealoop');
  assert.equal(s.book.campaign.startPriceCents, 300);
  const [posted] = await store.events('c1');
  assert.equal(posted.kind, 'campaign.posted');

  await assert.rejects(store.createCampaign({...base, id: 'c2', deadline: null}), (e: unknown) => e instanceof CoreError && e.code === 'MISSING_DEADLINE');
  assert.equal(await store.load('c2'), null);
  assert.equal((await store.list()).length, 1);
});

test('the full lifecycle matches the core, and settlement pays once', async () => {
  const {store} = setup();
  await store.createCampaign({...base, id: 'c'});
  await creator(store, 'small');
  await creator(store, 'big', 200);
  const small = await store.join('c', 'small', NOW + 1);
  assert.deepEqual(await store.join('c', 'small', NOW + 2), small, 'joining twice returns the same link');
  const big = await store.join('c', 'big', NOW + 3);
  await store.decline('c', 'small', 'testing a decline event', NOW + 4);

  // Mirror every step on an in-memory Book.
  let mirror: Book = createCampaign({id: 'c', goalCount: 100, budgetCents: 100_000, maxCacCents: 1_000, deadline: base.deadline, now: NOW});
  const ids: string[] = [];
  const convert = async (token: string, creatorId: string, user: string, at: number) => {
    const c = await store.recordConversion(token, user, at);
    mirror = recordConversion(mirror, {id: c.id, creatorId, externalUserId: user, now: at});
    ids.push(c.id);
    return c;
  };
  for (let i = 0; i < 10; i++) await convert(small.token, 'small', 'u' + i, NOW + DAY + i);

  const raise = {kind: 'raise_price', supplyAtCurrent: 10, supplyAtRaised: 40, rationale: 'Few creators at $3.'};
  const r = await store.applyProposal('c', raise, NOW + 2 * DAY, 'founder-agent');
  assert.equal(r.accepted, true);
  mirror = applyAgentProposal(mirror, raise, NOW + 2 * DAY).book;

  // The agent claims a track record; the store uses the database's (200).
  const deal = await store.applyProposal('c', {kind: 'create_deal', creatorId: 'big', priceCents: 725, volumeCap: 3, creatorVerifiedTotal: 0}, NOW + 3 * DAY, 'founder-agent');
  assert.equal(deal.accepted, true, deal.reason);
  mirror = applyAgentProposal(mirror, {kind: 'create_deal', creatorId: 'big', priceCents: 725, volumeCap: 3, creatorVerifiedTotal: 200}, NOW + 3 * DAY).book;
  for (let i = 0; i < 5; i++) await convert(big.token, 'big', 'b' + i, NOW + 4 * DAY + i);

  for (const id of ids.slice(0, 13)) {
    await store.verifyConversion('c', id, NOW + 5 * DAY);
    mirror = verifyConversion(mirror, id);
  }
  await store.rejectConversion('c', ids[13], NOW + 5 * DAY);
  mirror = rejectConversion(mirror, ids[13]);

  const loaded = (await store.load('c'))!;
  assert.deepEqual(loaded.book, mirror);
  assert.equal(loaded.book.conversions.filter(c => c.channel === 'deal').length, 3, 'deal volume cap honored');

  const ledger = await store.closeAndSettle('c', NOW + 14 * DAY);
  assert.deepEqual(ledger, settle(closeCampaign(mirror)));
  assert.ok(ledger.some(e => e.channel === 'deal' && e.amountCents === 725));
  assert.deepEqual(await store.closeAndSettle('c', NOW + 15 * DAY), ledger, 'settling again pays nothing new');
  assert.equal((await store.load('c'))!.book.campaign.status, 'closed');

  const kinds = (await store.events('c')).map(e => e.kind);
  assert.deepEqual(kinds.filter(k => k !== 'conversion.recorded' && k !== 'conversion.verified'), ['campaign.posted', 'creator.joined', 'creator.joined', 'creator.declined', 'price.raised', 'deal.created', 'conversion.rejected', 'campaign.settled']);
  assert.equal(await store.creatorVerifiedTotal('big'), 200 + 3);
});

test('a deal for a creator without a track record is refused, whatever the agent claims', async () => {
  const {store, sqlite} = setup();
  await store.createCampaign({...base, id: 'c'});
  await creator(store, 'newbie', 0);
  const r = await store.applyProposal('c', {kind: 'create_deal', creatorId: 'newbie', priceCents: 900, volumeCap: 50, creatorVerifiedTotal: 9_999}, NOW + DAY, 'founder-agent');
  assert.equal(r.accepted, false);
  assert.match(r.reason, /at least 50 verified/);
  const s = (await store.load('c'))!;
  assert.deepEqual(s.book.deals, {});
  assert.equal(s.book.rejections.length, 1);
  const row = sqlite.raw.prepare('SELECT actor, kind FROM proposal_rejections').get() as {actor: string; kind: string};
  assert.deepEqual({...row}, {actor: 'founder-agent', kind: 'create_deal'});
});

test('malicious proposals change nothing but the refusal log (S7)', async () => {
  const {store} = setup();
  await store.createCampaign({...base, id: 'c'});
  const before = (await store.load('c'))!.book;
  for (const p of [{kind: 'settle', priceCents: 5_000}, {kind: 'raise_price', supplyAtCurrent: -1, supplyAtRaised: 5}, null, 'raise']) {
    const r = await store.applyProposal('c', p, NOW + DAY, 'founder-agent');
    assert.equal(r.accepted, false);
  }
  const after = (await store.load('c'))!.book;
  assert.deepEqual({...after, rejections: []}, {...before, rejections: []});
  assert.equal(after.rejections.length, 4);
  assert.equal((await store.events('c')).filter(e => e.kind === 'proposal.refused').length, 4);
});

test('concurrent writers never lose an update or reuse a sequence number', async () => {
  const {store} = setup();
  await store.createCampaign({...base, id: 'c'});
  await creator(store, 'a');
  const link = await store.join('c', 'a', NOW + 1);
  let calls = 0;
  const raced = await Promise.all(Array.from({length: 25}, (_, i) => store.mutate('c', s => {
    calls++;
    const book = recordConversion(s.book, {id: 'x' + i, creatorId: 'a', externalUserId: 'u' + i, now: NOW + DAY});
    return {book, result: book.conversions.at(-1)!.seq};
  }, NOW + DAY).catch(e => e)));
  // Writers in one process are queued: every one commits, in order, with no retries.
  assert.ok(raced.every(r => typeof r === 'number'), 'no local writer was turned away');
  assert.equal(calls, 25);
  const s = (await store.load('c'))!;
  assert.deepEqual(s.book.conversions.map(c => c.seq), Array.from({length: 25}, (_, i) => i + 1));
  assert.equal(s.meta.version, 25);
  void link;
});

test('writers in separate processes cannot overwrite each other (commit guard)', async () => {
  const file = `/tmp/dealoop-store-${process.pid}-${Date.now()}.db`;
  const one = new SQLiteDatabase(file);
  one.migrate('drizzle');
  const two = new SQLiteDatabase(file);
  const a = new CampaignStore(one.asD1()), b = new CampaignStore(two.asD1());
  await a.createCampaign({...base, id: 'c'});
  await creator(a, 'x');
  await a.join('c', 'x', NOW + 1);
  let calls = 0;
  const write = (store: CampaignStore, i: number) => store.mutate('c', s => {
    calls++;
    const book = recordConversion(s.book, {id: 'p' + i, creatorId: 'x', externalUserId: 'pu' + i, now: NOW + DAY});
    return {book, result: true};
  }, NOW + DAY).catch(e => e);
  const raced = await Promise.all(Array.from({length: 8}, (_, i) => write(i % 2 ? a : b, i)));
  const ok = raced.filter(r => r === true).length;
  assert.ok(raced.every(r => r === true || (r instanceof StoreError && r.code === 'CONFLICT')));
  const s = (await a.load('c'))!;
  assert.equal(s.book.conversions.length, ok, 'every reported commit is stored, and nothing else');
  assert.deepEqual(s.book.conversions.map(c => c.seq), Array.from({length: ok}, (_, i) => i + 1));
  assert.ok(calls >= 8);
  one.close(); two.close();
});

test('random operation sequences keep the stored Book identical to the core', async () => {
  let seed = 7;
  const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
  for (let round = 0; round < 6; round++) {
    const {store} = setup();
    const budget = 20_000 + Math.floor(rand() * 80_000);
    await store.createCampaign({...base, id: 'c', budgetCents: budget, maxCacCents: 1_000});
    let mirror: Book = (await store.load('c'))!.book;
    const creators = ['a', 'b', 'c', 'vip'];
    const tokens: Record<string, string> = {};
    for (const c of creators) {
      await creator(store, c, c === 'vip' ? 120 : 0);
      tokens[c] = (await store.join('c', c, NOW + 1)).token;
    }
    let t = NOW + 10;
    for (let i = 0; i < 120; i++) {
      t += 60_000;
      const roll = rand();
      if (roll < 0.6) {
        const who = creators[Math.floor(rand() * creators.length)];
        const user = 'u' + Math.floor(rand() * 200);
        try {
          const c = await store.recordConversion(tokens[who], user, t);
          mirror = recordConversion(mirror, {id: c.id, creatorId: who, externalUserId: user, now: t});
        } catch (e) {
          assert.ok(e instanceof CoreError && e.code === 'DUPLICATE_USER');
          assert.throws(() => recordConversion(mirror, {id: 'probe', creatorId: who, externalUserId: user, now: t}), {code: 'DUPLICATE_USER'});
        }
      } else if (roll < 0.8) {
        const pending = mirror.conversions.filter(c => c.status === 'pending');
        if (!pending.length) continue;
        const c = pending[Math.floor(rand() * pending.length)];
        if (rand() < 0.85) { await store.verifyConversion('c', c.id, t); mirror = verifyConversion(mirror, c.id); }
        else { await store.rejectConversion('c', c.id, t); mirror = rejectConversion(mirror, c.id); }
      } else if (roll < 0.95) {
        const p = {kind: 'raise_price', supplyAtCurrent: Math.floor(rand() * 50), supplyAtRaised: Math.floor(rand() * 80)};
        await store.applyProposal('c', p, t, 'founder-agent');
        mirror = applyAgentProposal(mirror, p, t).book;
      } else {
        const p = {kind: 'create_deal', creatorId: 'vip', priceCents: 500 + Math.floor(rand() * 600), volumeCap: 1 + Math.floor(rand() * 10), creatorVerifiedTotal: 0};
        await store.applyProposal('c', p, t, 'founder-agent');
        mirror = applyAgentProposal(mirror, {...p, creatorVerifiedTotal: await store.creatorVerifiedTotal('vip')}, t).book;
      }
      assert.deepEqual((await store.load('c'))!.book, mirror, `round ${round}, step ${i}`);
    }
    const ledger = await store.closeAndSettle('c', t + 1);
    assert.deepEqual(ledger, settle(closeCampaign(mirror)));
    assert.ok(ledger.reduce((s, e) => s + e.amountCents, 0) <= budget, 'A1 holds in the database');
  }
});

test('the store refuses what the core would never do, and bad links or closed campaigns', async () => {
  const {store} = setup();
  await store.createCampaign({...base, id: 'c'});
  await assert.rejects(store.mutate('c', s => ({book: {...s.book, campaign: {...s.book.campaign, budgetCents: 999_999}}, result: 0}), NOW), {code: 'INVALID_MUTATION'});
  await assert.rejects(store.mutate('c', s => ({book: {...s.book, campaign: {...s.book.campaign, currentPriceCents: 5_000}}, result: 0}), NOW), /CHECK/, 'the database refuses a price above max CAC');
  assert.equal((await store.load('c'))!.meta.version, 0, 'failed writes leave no trace');
  await assert.rejects(store.recordConversion('no-such-token', 'u1', NOW), {code: 'UNKNOWN_LINK'});
  await assert.rejects(store.join('c', 'ghost', NOW), {code: 'NO_PROFILE'});
  await creator(store, 'late');
  await store.closeAndSettle('c', NOW + DAY);
  await assert.rejects(store.join('c', 'late', NOW + DAY), {code: 'CAMPAIGN_CLOSED'});
});

test('committing a feed event notifies local listeners', async () => {
  const {store, sqlite} = setup();
  let fired = 0;
  sqlite.onEventCommit(() => { fired++; });
  await store.createCampaign({...base, id: 'c'});
  await new Promise(r => setTimeout(r, 0));
  assert.equal(fired, 1);
});
