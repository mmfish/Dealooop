// Summer's agent and Bean's agent negotiate on the platform by themselves: two
// real stdio MCP processes on one database file, using only platform tools.
// The platform keeps the conversation, applies the market rules and tells each
// agent what is waiting on it; it never sees an owner's limits. No model calls.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {SQLiteDatabase} from '../runtime/sqlite.ts';
import {CampaignStore} from '../db/campaign-store.ts';
import {campaignView} from '../db/campaign-view.ts';
import {BEAN} from '../sim/demo-creators.ts';
import {RuleNegotiator, runStoredNegotiation} from '../sim/negotiation-run.ts';

const root = join(import.meta.dirname, '..');
const DAY = 86_400_000;

async function connect(env: Record<string, string>) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--experimental-transform-types', '--no-warnings', join(root, 'mcp/stdio.ts')],
    env: {...process.env as Record<string, string>, ...env},
    stderr: 'pipe',
  });
  const client = new Client({name: 'test', version: '1'});
  await client.connect(transport);
  return client;
}
type Out = {structuredContent?: Record<string, unknown>; isError?: boolean};
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => ((await c.callTool({name, arguments: args})) as Out).structuredContent!;
type Waiting = {negotiation_id: string; last_move: {action: string; price_per_sign_up?: string; message: string} | null};

const party = (path: string, role: 'founder' | 'creator', id: string, name: string) =>
  connect({DEALOOP_ROLE: role, DEALOOP_USER_ID: id, DEALOOP_USER_NAME: name, DEALOOP_DB_PATH: path});

async function post(summer: Client) {
  const today = String((await call(summer, 'get_my_identity')).platform_today);
  return call(summer, 'post_campaign', {
    app_url: 'https://dealoop.test', app_description: 'A marketplace where founders and creators make deals.', title: 'Dealoop', brief: 'Promote Dealoop: 100 new sign-ups, the more the better. Budget $1000, no more than $10 each.',
    goal_sign_ups: 100, budget_dollars: 1000, max_price_per_sign_up_dollars: 10,
    deadline_date: new Date(Date.parse(today) + 14 * DAY).toISOString().slice(0, 10),
  });
}

test('Summer posts, Bean finds it by himself and bids, Summer finds the bid waiting and accepts', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'dealoop-deal-')), 'db.sqlite');
  const summer = await party(path, 'founder', 'summer', 'Summer');
  const bean = await party(path, 'creator', 'bean', 'Bean');
  try {
    // The tools carry no owner instructions or limits.
    for (const c of [summer, bean]) {
      for (const t of (await c.listTools()).tools) {
        const fields = Object.keys((t.inputSchema as {properties?: object}).properties ?? {});
        assert.ok(!fields.some(f => /owner|limit|quote|approval|founder_messages|preview/.test(f)), `${t.name}: ${fields}`);
      }
    }

    const posted = await post(summer);
    assert.equal(posted.status, 'posted');
    const campaignId = String(posted.campaign_id);
    assert.equal((await post(summer)).status, 'already_posted');
    assert.equal((await call(summer, 'post_campaign', {app_url: 'https://dealoop.test', app_description: 'A marketplace where founders and creators make deals.', title: 'x', brief: 'y', goal_sign_ups: 1, budget_dollars: 10, max_price_per_sign_up_dollars: 1, deadline_date: '2020-01-01'})).status, 'invalid', 'market rule: the deadline is in the future');

    const first = await call(bean, 'get_updates');
    assert.ok((first.updates as {kind: string; campaign_id: string}[]).some(u => u.kind === 'campaign.posted' && u.campaign_id === campaignId));
    assert.deepEqual((await call(bean, 'get_updates')).updates, [], 'the platform remembers how far Bean\'s agent read');

    const opened = await call(bean, 'open_negotiation', {campaign_id: campaignId, price_per_sign_up_dollars: 8, sign_ups: 60, message: 'My audience is indie founders; 200 verified sign-ups delivered so far. $8 for my next 60?'});
    assert.equal(opened.status, 'sent');
    const id = String((opened.negotiation as {negotiation_id: string}).negotiation_id);
    assert.deepEqual((await call(bean, 'get_updates')).waiting_on_you, [], 'nothing waits on Bean once he has bid');

    const s1 = await call(summer, 'get_updates');
    assert.ok((s1.updates as {kind: string}[]).some(u => u.kind === 'deal.negotiation_opened'));
    const w = (s1.waiting_on_you as Waiting[])[0];
    assert.equal(w.negotiation_id, id);
    assert.deepEqual([w.last_move?.action, w.last_move?.price_per_sign_up], ['propose', '$8.00']);
    assert.equal((await call(summer, 'negotiate', {negotiation_id: id, action: 'accept', message: 'Agreed.'})).status, 'deal_agreed');
    assert.ok(((await call(bean, 'get_updates')).updates as {kind: string}[]).some(u => u.kind === 'deal.created'), 'Bean\'s agent learns of the deal on its next look');
  } finally {
    await summer.close();
    await bean.close();
  }
});

test('a longer bargain: counter, a question, a counter, accept; a restarted agent picks up where it was', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'dealoop-deal-')), 'db.sqlite');
  const summer = await party(path, 'founder', 'summer', 'Summer');
  let bean = await party(path, 'creator', 'bean', 'Bean');
  try {
    const campaignId = String((await post(summer)).campaign_id);
    const id = String(((await call(bean, 'open_negotiation', {campaign_id: campaignId, price_per_sign_up_dollars: 8, sign_ups: 60, message: '$8 for my next 60?'})).negotiation as {negotiation_id: string}).negotiation_id);

    assert.equal((await call(summer, 'negotiate', {negotiation_id: id, action: 'propose', price_per_sign_up_dollars: 6.5, sign_ups: 50, message: 'The public price is $3; I can do $6.50 for 50.'})).status, 'sent');
    assert.equal((await call(summer, 'negotiate', {negotiation_id: id, action: 'message', message: 'Out of turn.'})).status, 'refused');

    // Bean's agent restarts (a new session): what waits on it comes from the platform, not from memory.
    await bean.close();
    bean = await party(path, 'creator', 'bean', 'Bean');
    const w = ((await call(bean, 'get_updates')).waiting_on_you as Waiting[])[0];
    assert.deepEqual([w.negotiation_id, w.last_move?.price_per_sign_up], [id, '$6.50']);

    assert.equal((await call(bean, 'negotiate', {negotiation_id: id, action: 'message', message: 'Before I answer: is the product free for my audience?'})).status, 'sent');
    assert.equal((await call(summer, 'negotiate', {negotiation_id: id, action: 'message', message: 'Free to post; founders pay per verified sign-up.'})).status, 'sent');
    assert.equal((await call(bean, 'negotiate', {negotiation_id: id, action: 'propose', price_per_sign_up_dollars: 7.25, sign_ups: 50, message: 'Then $7.25 for 50.'})).status, 'sent');
    assert.equal((await call(summer, 'negotiate', {negotiation_id: id, action: 'accept', message: 'Agreed.'})).status, 'deal_agreed');

    // The platform has the whole conversation; each party reads it and has a private page.
    const read = await call(bean, 'read_negotiation', {negotiation_id: id});
    const convo = read.conversation as {by: string; action: string}[];
    assert.deepEqual(convo.map(t => [t.by, t.action]), [['you', 'propose'], ['founder', 'propose'], ['you', 'message'], ['founder', 'message'], ['you', 'propose'], ['founder', 'accept']]);
    assert.match(String(read.private_page), /\/negotiations\/neg_\w+\?key=nk_\w+/);

    const check = new SQLiteDatabase(path);
    const store = new CampaignStore(check.asD1());
    const s = await store.require(campaignId);
    assert.deepEqual([s.book.deals.bean.priceCents, s.book.deals.bean.volumeCap], [725, 50]);
    assert.ok(s.links.bean, 'Bean joins with the deal, so his sign-ups can be paid');
    const key = new URL(String(read.private_page)).searchParams.get('key')!;
    assert.equal((await store.negotiationByKey(key))?.side, 'creator');
    // The campaign's Activity shows every turn of the conversation, in order, with the terms.
    const v = (await campaignView(store, campaignId))!;
    const turns = v.feed.filter(e => e.kind === 'deal.turn');
    assert.equal(turns.length, 6);
    assert.match(turns[1].summary, /^Proposed \$6\.50 per sign-up for 50 sign-ups: “The public price is \$3/);
    assert.match(turns[2].summary, /is the product free/);
    assert.equal(turns[2].tone, 'chat');
    assert.match(turns[1].actor, /'s agent → @beanbuilds$/);
    assert.ok(v.feed.some(e => e.kind === 'deal.created' && /\$7\.25/.test(e.summary)));
    check.close();
  } finally {
    await summer.close();
    await bean.close();
  }
});

test('a creator without a profile sets one, then negotiates with no track record', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'dealoop-deal-')), 'db.sqlite');
  const summer = await party(path, 'founder', 'summer', 'Summer');
  const kim = await party(path, 'creator', 'kim', 'Kim');
  try {
    const campaignId = String((await post(summer)).campaign_id);
    const bid = {campaign_id: campaignId, price_per_sign_up_dollars: 5, sign_ups: 20, message: '$5 for 20?'};
    assert.equal((await call(kim, 'open_negotiation', bid)).error, 'NO_PROFILE');
    assert.equal((await call(kim, 'set_creator_profile', {handle: '@makerkim', platform: 'X', niche: 'building in public', audience: 'indie makers', followers: 8200})).status, 'saved');
    assert.equal((await call(kim, 'open_negotiation', bid)).status, 'sent');
  } finally {
    await summer.close();
    await kim.close();
  }
});

test('the simulated negotiators reach a deal on a stored campaign, each keeping its own limit', async () => {
  const sqlite = new SQLiteDatabase(':memory:');
  sqlite.migrate(join(root, 'drizzle'));
  const store = new CampaignStore(sqlite.asD1());
  const now = Date.now();
  await store.createCampaign({id: 'c', ownerId: 'summer', ownerName: 'Summer', title: 'Dealoop', brief: 'Promote Dealoop.', productUrl: '', goalCount: 100, budgetCents: 100_000, maxCacCents: 1_000, deadline: now + 14 * DAY, now});
  await store.upsertCreator({...BEAN, demo: false, now});
  const rules = new RuleNegotiator();
  const out = await runStoredNegotiation({store, campaignId: 'c', creatorId: BEAN.userId, creatorAgent: rules, founderAgent: rules, now: Date.now, mandates: {creator: {minPriceCents: 650}, founder: {maxPriceCents: 750, maxVolume: 50}}});
  assert.equal(out.negotiation.status, 'agreed');
  const deal = (await store.require('c')).book.deals[BEAN.userId];
  assert.ok(deal.priceCents >= 650 && deal.priceCents <= 750 && deal.volumeCap <= 50);
  const row = await store.db.prepare('SELECT state_json FROM campaign_negotiations').first<{state_json: string}>();
  assert.ok(!/minPriceCents|maxPriceCents/.test(row!.state_json), 'no limit reaches the platform');
});
