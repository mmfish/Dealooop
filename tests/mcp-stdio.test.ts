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

const S1 = 'Promote Dealoop: 100 new sign-ups, the more the better. Budget $1000, no more than $10 each.';
const fields = {title: 'Dealoop', brief: S1, app_url: 'https://dealoop.test', app_description: 'A marketplace where founders and creators make deals.', goal_sign_ups: 100, budget_dollars: 1000, max_price_per_sign_up_dollars: 10};

test('a founder\'s agent posts a campaign; the platform checks only the market rules', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dealoop-mcp-'));
  const dbPath = join(dir, 'test.sqlite');
  const founder = await connect({DEALOOP_ROLE: 'founder', DEALOOP_USER_ID: 'summer', DEALOOP_USER_NAME: 'Summer', DEALOOP_DB_PATH: dbPath});
  try {
    const tools = (await founder.listTools()).tools.map(t => t.name).sort();
    assert.deepEqual(tools, ['answer_creator_question', 'campaign_report', 'get_my_identity', 'get_updates', 'join_campaign', 'list_creator_questions', 'list_my_campaigns', 'list_negotiations', 'list_open_campaigns', 'negotiate', 'open_negotiation', 'post_campaign', 'read_negotiation', 'set_creator_profile'], 'one set of tools for everyone: founder on their own campaigns, creator on others\'');
    const me = (await call(founder, 'get_my_identity')).structuredContent!;
    assert.equal(me.user_id, 'summer');
    const today = String(me.platform_today);

    assert.equal((await call(founder, 'post_campaign', {...fields, deadline_date: ''})).structuredContent!.status, 'invalid', 'a deadline is required');
    assert.equal((await call(founder, 'post_campaign', {...fields, max_price_per_sign_up_dollars: 2000, deadline_date: '2099-01-01'})).structuredContent!.status, 'invalid', 'within a year');
    const deadline = new Date(Date.parse(today) + 14 * 86_400_000).toISOString().slice(0, 10);
    const tooMuch = await call(founder, 'post_campaign', {...fields, max_price_per_sign_up_dollars: 2000, deadline_date: deadline});
    assert.equal(tooMuch.isError, true, 'the maximum per sign-up cannot exceed the budget');
    assert.deepEqual((await call(founder, 'list_my_campaigns')).structuredContent!.campaigns, [], 'nothing was posted');

    const posted = (await call(founder, 'post_campaign', {...fields, deadline_date: deadline})).structuredContent!;
    assert.equal(posted.status, 'posted');
    assert.equal(posted.current_price_per_sign_up, '$3.00');
    const again = (await call(founder, 'post_campaign', {...fields, deadline_date: deadline})).structuredContent!;
    assert.equal(again.status, 'already_posted');
    assert.equal(again.campaign_id, posted.campaign_id);

    // The platform (another process on the same file) sees it.
    const sqlite = new SQLiteDatabase(dbPath);
    const store = new CampaignStore(sqlite.asD1());
    const id = String(posted.campaign_id);
    const s = (await store.load(id))!;
    assert.equal(s.meta.ownerId, 'summer');
    assert.equal(s.book.campaign.budgetCents, 100_000);
    assert.equal(s.meta.brief, S1);
    assert.equal(s.meta.productDescription, 'A marketplace where founders and creators make deals.');
    assert.equal(s.meta.imageUrl, `/campaigns/${id}/art.svg`, 'the platform draws the campaign\'s picture');
    assert.equal((await store.events(id))[0].kind, 'campaign.posted');

    // The report reflects what happened on the platform.
    await store.upsertCreator({userId: 'c1', handle: '@growth_y', platform: 'YouTube', niche: 'startups', audience: '', followers: 1, priorVerified: 0, demo: true, now: Date.now()});
    const link = await store.join(id, 'c1', Date.now());
    const conv = await store.recordConversion(link.token, 'u1', Date.now());
    await store.verifyConversion(id, conv.id, Date.now());
    const report = (await call(founder, 'campaign_report', {campaign_id: id})).structuredContent!;
    assert.deepEqual(report.sign_ups, {verified: 1, pending: 0, rejected: 0, unfunded: 0});
    assert.equal((report.top_creators as {creator: string}[])[0].creator, '@growth_y');
    sqlite.close();

    // Another person's agent can browse the campaign but cannot read its report.
    const creator = await connect({DEALOOP_USER_ID: 'bean', DEALOOP_DB_PATH: dbPath});
    try {
      assert.equal((await call(creator, 'campaign_report', {campaign_id: id})).isError, true);
      const open = (await call(creator, 'list_open_campaigns')).structuredContent!.campaigns as {campaign_id: string; brief: string}[];
      assert.deepEqual([open[0].campaign_id, open[0].brief], [id, S1]);
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

test('a creator question reaches the founder\'s agent, and its answer lets the creator join', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dealoop-mcp-'));
  const dbPath = join(dir, 'test.sqlite');
  const sqlite = new SQLiteDatabase(dbPath);
  sqlite.migrate(join(root, 'drizzle'));
  const store = new CampaignStore(sqlite.asD1());
  const now = Date.now();
  await store.createCampaign({id: 'c', ownerId: 'summer', ownerName: 'Summer', title: 'Dealoop', brief: S1, productUrl: '', goalCount: 100, budgetCents: 100_000, maxCacCents: 1_000, deadline: now + 14 * 86_400_000, now});
  await store.upsertCreator({userId: 'maya', handle: '@growthwithmaya', platform: 'YouTube', niche: 'growth', audience: '', followers: 1, priorVerified: 0, demo: true, now});
  await store.askQuestion('c', 'maya', 'Can I say Dealoop is free?', now);
  const founder = await connect({DEALOOP_ROLE: 'founder', DEALOOP_USER_ID: 'summer', DEALOOP_DB_PATH: dbPath});
  try {
    const listed = (await call(founder, 'list_creator_questions')).structuredContent!.questions as {question_id: string; question: string; creator: string}[];
    assert.deepEqual(listed.map(q => [q.creator, q.question]), [['@growthwithmaya', 'Can I say Dealoop is free?']]);
    const id = listed[0].question_id;
    const answer = 'Free to post a campaign; you pay only for verified sign-ups.';
    const done = (await call(founder, 'answer_creator_question', {question_id: id, answer})).structuredContent!;
    assert.equal(done.status, 'answered');
    assert.ok(await store.link('c', 'maya'), 'the creator joined');
    assert.equal((await call(founder, 'answer_creator_question', {question_id: id, answer: 'again'})).structuredContent!.status, 'already_answered');
    const report = (await call(founder, 'campaign_report', {campaign_id: 'c'})).structuredContent!;
    assert.equal(report.questions_waiting_for_you, 0);
  } finally { await founder.close(); }
  const other = await connect({DEALOOP_ROLE: 'founder', DEALOOP_USER_ID: 'someone-else', DEALOOP_DB_PATH: dbPath});
  try {
    assert.deepEqual((await call(other, 'list_creator_questions')).structuredContent!.questions, []);
  } finally { await other.close(); sqlite.close(); rmSync(dir, {recursive: true, force: true}); }
});
