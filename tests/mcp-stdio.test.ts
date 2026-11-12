// The local MCP server, started exactly as Claude Desktop starts it (a child
// process over stdio), driven through the founder's flow in DEMO-FLOW beats 1
// and 7. A temporary database keeps the real one untouched.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {SQLiteDatabase} from '../runtime/sqlite.ts';
import {CampaignStore} from '../db/campaign-store.ts';

const root = join(import.meta.dirname, '..');

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
const call = async (c: Client, name: string, args: Record<string, unknown> = {}) => (await c.callTool({name, arguments: args})) as Out;

const S1 = 'Help my app get 100 new sign-ups, the more the better. Budget $1000, CAC no more than $10.';
const fields = {
  product_name: 'Dealoop', product_url: 'https://dealoop.test',
  goal_count: 100, goal_quote: '100 new sign-ups', budget_dollars: 1000, budget_quote: 'Budget $1000',
  max_cac_dollars: 10, max_cac_quote: 'CAC no more than $10', deadline_date: '', deadline_quote: '', quantity_intent: 'more_is_better',
};

test('a founder posts a campaign from their own words, and nothing is invented', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dealoop-mcp-'));
  const dbPath = join(dir, 'test.sqlite');
  const founder = await connect({DEALOOP_ROLE: 'founder', DEALOOP_USER_ID: 'summer', DEALOOP_USER_NAME: 'Summer', DEALOOP_DB_PATH: dbPath});
  try {
    const tools = (await founder.listTools()).tools.map(t => t.name).sort();
    assert.deepEqual(tools, ['campaign_report', 'get_my_identity', 'list_my_campaigns', 'list_open_campaigns', 'post_campaign']);
    const me = (await call(founder, 'get_my_identity')).structuredContent!;
    assert.equal(me.role, 'founder');
    assert.equal(me.user_id, 'summer');
    const today = String(me.platform_today);

    // Beat 1: no deadline, so the platform returns the question and posts nothing.
    const ask = (await call(founder, 'post_campaign', {founder_messages: [S1], ...fields, preview: true})).structuredContent!;
    assert.equal(ask.status, 'needs_info');
    assert.match(String(ask.ask_your_owner), /When should the campaign end/);

    // An agent that "helpfully" fills the deadline in gets the same question back.
    const deadline = new Date(Date.parse(today) + 14 * 86_400_000).toISOString().slice(0, 10);
    const guessed = (await call(founder, 'post_campaign', {founder_messages: [S1], ...fields, deadline_date: deadline, deadline_quote: 'in two weeks', preview: true})).structuredContent!;
    assert.equal(guessed.status, 'needs_info');

    // With the founder's answer: a preview first, then the post.
    const messages = [S1, 'Two weeks.'];
    const withDeadline = {founder_messages: messages, ...fields, deadline_date: deadline, deadline_quote: 'Two weeks'};
    const preview = (await call(founder, 'post_campaign', {...withDeadline, preview: true})).structuredContent!;
    assert.equal(preview.status, 'preview');
    assert.deepEqual((preview.campaign as Record<string, unknown>).starting_price_per_sign_up, '$3.00');
    assert.deepEqual((await call(founder, 'list_my_campaigns')).structuredContent!.campaigns, [], 'a preview posts nothing');

    const posted = (await call(founder, 'post_campaign', {...withDeadline, preview: false})).structuredContent!;
    assert.equal(posted.status, 'posted');
    assert.equal(posted.current_price_per_sign_up, '$3.00');
    const again = (await call(founder, 'post_campaign', {...withDeadline, preview: false})).structuredContent!;
    assert.equal(again.status, 'already_posted');
    assert.equal(again.campaign_id, posted.campaign_id);

    // Beat 2: the platform (another process on the same file) sees it.
    const sqlite = new SQLiteDatabase(dbPath);
    const store = new CampaignStore(sqlite.asD1());
    const id = String(posted.campaign_id);
    const s = (await store.load(id))!;
    assert.equal(s.meta.ownerId, 'summer');
    assert.equal(s.book.campaign.budgetCents, 100_000);
    assert.equal(s.meta.brief, S1 + '\nTwo weeks.');
    assert.equal((await store.events(id))[0].kind, 'campaign.posted');

    // Beat 7: the report reflects what happened on the platform.
    await store.upsertCreator({userId: 'c1', handle: '@growth_y', platform: 'YouTube', niche: 'startups', audience: '', followers: 1, priorVerified: 0, demo: true, now: Date.now()});
    const link = await store.join(id, 'c1', Date.now());
    const conv = await store.recordConversion(link.token, 'u1', Date.now());
    await store.verifyConversion(id, conv.id, Date.now());
    const report = (await call(founder, 'campaign_report', {campaign_id: id})).structuredContent!;
    assert.deepEqual(report.sign_ups, {verified: 1, pending: 0, rejected: 0, unfunded: 0});
    assert.equal((report.top_creators as {creator: string}[])[0].creator, '@growth_y');
    sqlite.close();

    // A creator's window can browse campaigns but has no founder tools, and cannot read the report.
    const creator = await connect({DEALOOP_ROLE: 'creator', DEALOOP_USER_ID: 'yi', DEALOOP_DB_PATH: dbPath});
    try {
      assert.deepEqual((await creator.listTools()).tools.map(t => t.name).sort(), ['get_my_identity', 'list_open_campaigns']);
      const open = (await call(creator, 'list_open_campaigns')).structuredContent!.campaigns as {campaign_id: string}[];
      assert.equal(open[0].campaign_id, id);
    } finally { await creator.close(); }
    const other = await connect({DEALOOP_ROLE: 'founder', DEALOOP_USER_ID: 'someone-else', DEALOOP_DB_PATH: dbPath});
    try {
      const denied = await call(other, 'campaign_report', {campaign_id: id});
      assert.equal(denied.isError, true, 'another founder cannot read this campaign');
    } finally { await other.close(); }
  } finally {
    await founder.close();
    rmSync(dir, {recursive: true, force: true});
  }
});
