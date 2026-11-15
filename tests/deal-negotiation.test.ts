// A private deal negotiated on a stored campaign (DEMO-FLOW beat 6): through
// the store with the rule-based negotiators, and over MCP between two real
// stdio processes, Summer's window and Yi's window, on one database file.
// No model calls.

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
import {YI, DEMO_CREATORS} from '../sim/demo-creators.ts';
import {RuleNegotiator, runStoredNegotiation} from '../sim/negotiation-run.ts';
import {approves} from '../mcp/deal-tools.ts';

const root = join(import.meta.dirname, '..');
const DAY = 86_400_000;

async function seed(path: string) {
  const sqlite = new SQLiteDatabase(path);
  sqlite.migrate(join(root, 'drizzle'));
  const store = new CampaignStore(sqlite.asD1());
  const now = Date.now();
  await store.ensureUser('summer', 'Summer', now);
  await store.createCampaign({id: 'c', ownerId: 'summer', ownerName: 'Summer', title: 'Dealoop', brief: 'Promote Dealoop: 100 new sign-ups. Budget $1000, no more than $10 each. Two weeks.', productUrl: '', goalCount: 100, budgetCents: 100_000, maxCacCents: 1_000, deadline: now + 14 * DAY, now});
  await store.upsertCreator({...YI, demo: false, now});
  return {sqlite, store};
}

test('the old negotiators run on a stored campaign, and an agreement becomes a deal', async () => {
  const {store} = await seed(':memory:');
  const before = (await store.require('c')).book.campaign.currentPriceCents;
  const rules = new RuleNegotiator();
  const out = await runStoredNegotiation({
    store, campaignId: 'c', creatorId: YI.userId, creatorAgent: rules, founderAgent: rules, now: Date.now,
    mandates: {creator: {minPriceCents: 650}, founder: {maxPriceCents: 750, maxVolume: 50}},
  });
  assert.equal(out.negotiation.status, 'agreed');
  const s = await store.require('c');
  const deal = s.book.deals[YI.userId];
  assert.ok(deal && deal.priceCents >= 650 && deal.priceCents <= 750 && deal.volumeCap <= 50);
  assert.equal(s.book.campaign.currentPriceCents, before, 'the public price is unchanged');
  assert.ok(s.links[YI.userId], 'Yi joins with the deal, so his sign-ups can be paid');
  const v = (await campaignView(store, 'c'))!;
  assert.deepEqual(v.feed.filter(e => e.kind.startsWith('deal.')).map(e => [e.kind, e.tone]), [['deal.negotiation_opened', 'deal'], ['deal.created', 'deal']]);
  assert.ok(!v.feed.some(e => /6\.50|7\.50/.test(e.summary) && e.kind !== 'deal.created'), 'no private limit in the public feed');
});

test('only creators with a track record can negotiate', async () => {
  const {store} = await seed(':memory:');
  const nobody = DEMO_CREATORS[1];
  await store.upsertCreator({userId: nobody.userId, handle: nobody.handle, platform: nobody.platform, niche: nobody.niche, audience: nobody.audience, followers: nobody.followers, priorVerified: 0, demo: true, now: Date.now()});
  await assert.rejects(store.openNegotiation('c', nobody.userId, Date.now()), (e: unknown) => (e as {code?: string}).code === 'NOT_ELIGIBLE');
});

test('approval words: a yes counts, a no that contains a yes does not', () => {
  for (const yes of ['Yes, take it', 'ok', '可以，接受', 'Sounds good']) assert.ok(approves(yes), yes);
  for (const no of ['not ok', "don't accept", 'No, that is fine to refuse', '不可以']) assert.ok(!approves(no), no);
});

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

test('beat 6 over MCP: Yi opens, Summer counters, Yi approves going below his floor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dealoop-deal-'));
  const path = join(dir, 'db.sqlite');
  (await seed(path)).sqlite.close();
  const yi = await connect({DEALOOP_ROLE: 'creator', DEALOOP_USER_ID: 'yi', DEALOOP_USER_NAME: 'Yi', DEALOOP_DB_PATH: path});
  const summer = await connect({DEALOOP_ROLE: 'founder', DEALOOP_USER_ID: 'summer', DEALOOP_USER_NAME: 'Summer', DEALOOP_DB_PATH: path});
  try {
    const tools = (await yi.listTools()).tools.map(t => t.name).sort();
    assert.deepEqual(tools, ['deal_move', 'get_my_identity', 'join_campaign', 'list_deal_negotiations', 'list_open_campaigns', 'open_private_deal', 'read_deal_negotiation']);

    // Without Yi's own floor nothing opens.
    const open = {campaign_id: 'c', price_per_sign_up_dollars: 8, sign_ups: 60, message: 'My audience of indie founders converts well; 200 verified sign-ups so far.'};
    assert.equal((await call(yi, 'open_private_deal', open)).status, 'needs_your_owner');
    // A floor the owner did not state is refused.
    const yiSays = ['Open a private deal on Dealoop. Ask $8 for my next 60, never below $7.'];
    assert.equal((await call(yi, 'open_private_deal', {...open, owner_messages: yiSays, limit_price_dollars: 6, limit_price_quote: 'never below $7'})).status, 'invalid');
    // A message that reveals the floor is refused by the core.
    const leaky = await call(yi, 'open_private_deal', {...open, message: 'I will not go below $7.00.', owner_messages: yiSays, limit_price_dollars: 7, limit_price_quote: 'never below $7'});
    assert.equal(leaky.status, 'refused');
    const opened = await call(yi, 'deal_move', {negotiation_id: (leaky.negotiation as {negotiation_id: string}).negotiation_id, action: 'propose', price_per_sign_up_dollars: 8, sign_ups: 60, message: open.message});
    assert.equal(opened.status, 'sent');
    const id = (opened.negotiation as {negotiation_id: string}).negotiation_id;

    // Summer's window: the negotiation waits on her, and her agent needs her limit.
    const list = await call(summer, 'list_deal_negotiations');
    assert.equal((list.negotiations as {whose_turn: string}[])[0].whose_turn, 'yours');
    const read = await call(summer, 'read_deal_negotiation', {negotiation_id: id});
    assert.ok(!JSON.stringify(read).includes('7.00'), 'Summer never sees Yi\'s floor');
    const counter = {negotiation_id: id, action: 'propose', price_per_sign_up_dollars: 6.5, sign_ups: 50, message: 'The public price is $3; I can offer $6.50 for 50.'};
    assert.equal((await call(summer, 'deal_move', counter)).status, 'needs_your_owner');
    const summerSays = ['Offer $6.50 for 50 sign-ups. Max $7.50, and no more than 50 sign-ups.'];
    const sent = await call(summer, 'deal_move', {...counter, owner_messages: summerSays, limit_price_dollars: 7.5, limit_price_quote: 'Max $7.50', limit_sign_ups: 50, limit_sign_ups_quote: 'no more than 50 sign-ups'});
    assert.equal(sent.status, 'sent');

    // Yi's window: $6.50 is below his floor, so his agent must ask him.
    const accept = {negotiation_id: id, action: 'accept', message: 'Thanks, that works.'};
    const ask = await call(yi, 'deal_move', accept);
    assert.equal(ask.status, 'needs_your_owner');
    assert.match(String(ask.ask_your_owner), /\$6\.50 per sign-up for 50 sign-ups/);
    assert.equal((await call(yi, 'deal_move', {...accept, owner_messages: [...yiSays, 'not ok'], limit_price_dollars: 6.5, limit_price_quote: 'not ok'})).status, 'invalid');
    const done = await call(yi, 'deal_move', {...accept, owner_messages: [...yiSays, 'Yes, take it.'], limit_price_dollars: 6.5, limit_price_quote: 'Yes, take it'});
    assert.equal(done.status, 'deal_agreed');

    const check = new SQLiteDatabase(path);
    const s = await new CampaignStore(check.asD1()).require('c');
    assert.deepEqual(s.book.deals.yi && [s.book.deals.yi.priceCents, s.book.deals.yi.volumeCap], [650, 50]);
    assert.equal(s.book.campaign.currentPriceCents, 300, 'the public price is unchanged');
    const stateRow = check.asD1().prepare('SELECT state_json FROM campaign_negotiations').bind();
    const row = await stateRow.first<{state_json: string}>();
    assert.ok(!/700|750/.test(row!.state_json), 'neither private limit is stored');
    check.close();
  } finally {
    await yi.close();
    await summer.close();
  }
});
