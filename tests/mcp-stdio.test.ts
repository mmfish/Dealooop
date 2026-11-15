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
    assert.deepEqual(tools, ['answer_creator_question', 'campaign_report', 'deal_move', 'get_my_identity', 'list_creator_questions', 'list_deal_negotiations', 'list_my_campaigns', 'list_open_campaigns', 'post_campaign', 'read_deal_negotiation']);
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
      assert.deepEqual((await creator.listTools()).tools.map(t => t.name).sort(), ['deal_move', 'get_my_identity', 'join_campaign', 'list_deal_negotiations', 'list_open_campaigns', 'open_private_deal', 'read_deal_negotiation']);
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

test('a creator question reaches the founder, and only their own approval answers it', async () => {
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
    const wording = 'Free to post a campaign; you pay only for verified sign-ups.';
    const answer = (extra: Record<string, unknown>) => call(founder, 'answer_creator_question', {question_id: id, wording, ...extra});

    const unseen = (await answer({preview: false, owner_messages: ['yes'], approval_quote: 'yes'})).structuredContent!;
    assert.equal(unseen.status, 'invalid', 'a wording the owner never saw is refused');
    assert.equal((await answer({preview: true})).structuredContent!.status, 'preview');
    const guessed = (await answer({preview: false, owner_messages: ['hmm, what does that mean?'], approval_quote: 'yes'})).structuredContent!;
    assert.equal(guessed.status, 'needs_approval', 'an approval the owner did not write is refused');
    const vague = (await answer({preview: false, owner_messages: ['hmm, what does that mean?'], approval_quote: 'what does that mean'})).structuredContent!;
    assert.equal(vague.status, 'needs_approval', 'their words must actually approve');
    assert.equal((await store.questions('c', 'pending')).length, 1, 'nothing was sent yet');

    const done = (await answer({preview: false, owner_messages: ['Yes, that works.'], approval_quote: 'Yes, that works'})).structuredContent!;
    assert.equal(done.status, 'answered');
    assert.ok(await store.link('c', 'maya'), 'the creator joined');
    assert.equal((await answer({preview: false, owner_messages: ['Yes'], approval_quote: 'Yes'})).structuredContent!.status, 'already_answered');
    const report = (await call(founder, 'campaign_report', {campaign_id: 'c'})).structuredContent!;
    assert.equal(report.questions_waiting_for_you, 0);
  } finally { await founder.close(); }
  const other = await connect({DEALOOP_ROLE: 'founder', DEALOOP_USER_ID: 'someone-else', DEALOOP_DB_PATH: dbPath});
  try {
    assert.deepEqual((await call(other, 'list_creator_questions')).structuredContent!.questions, []);
  } finally { await other.close(); sqlite.close(); rmSync(dir, {recursive: true, force: true}); }
});
