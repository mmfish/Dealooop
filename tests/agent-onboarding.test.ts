// An agent that only knows Dealoop's address connects by itself, with its owner's
// approval, and does business through the HTTP tools: Summer's agent posts,
// Bean's agent finds the campaign and bids, they agree. The owners only sign in
// (localhost email sign-in) and click approve. No model calls.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {SQLiteDatabase} from '../runtime/sqlite.ts';

const ORIGIN = 'http://localhost:3200';
process.env.DEALOOP_RUNTIME = 'aws';
process.env.DEALOOP_ORIGIN = ORIGIN;
const {handleApi} = await import('../backend/service.ts');
const {authEndpoint} = await import('../backend/auth.ts');
const {dealoopGuide} = await import('../backend/dealoop-discovery.ts');

const DAY = 86_400_000;
const sqlite = new SQLiteDatabase(':memory:');
sqlite.migrate(join(import.meta.dirname, '..', 'drizzle'));
const db = sqlite.asD1();

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON in an HTTP test
type Json = Record<string, any>;
async function api(path: string, method = 'GET', body?: unknown, auth: {token?: string; cookie?: string} = {}, headers: Record<string, string> = {}) {
  const r = await handleApi(new Request(ORIGIN + '/api/v1' + path, {
    method,
    headers: {'Content-Type': 'application/json', Origin: ORIGIN, ...(auth.token ? {Authorization: 'Bearer ' + auth.token} : {}), ...(auth.cookie ? {Cookie: 'thread_session=' + auth.cookie} : {}), ...headers},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  }), {DB: db});
  const text = await r.text();
  return {status: r.status, data: (text ? JSON.parse(text) : {}) as Json};
}

async function signIn(name: string, email: string) {
  const r = await authEndpoint(new Request(ORIGIN + '/api/auth/email', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: ORIGIN}, body: JSON.stringify({name, email})}), db, 'email');
  assert.equal(r.status, 200, await r.clone().text());
  return /thread_session=([a-f0-9]{64})/.exec(r.headers.get('set-cookie') ?? '')![1];
}

/** What the guide tells an agent to do: request, have the owner approve, poll for the token. */
async function connect(agentName: string, ownerCookie: string) {
  const req = await api('/agent-connections', 'POST', {name: agentName});
  assert.equal(req.status, 201);
  assert.match(req.data.verification_uri_complete, /^http:\/\/localhost:3200\/connect\?code=/);
  assert.equal((await api('/agent-token', 'POST', {device_code: req.data.device_code})).status, 428, 'waiting for the owner');
  assert.equal((await api('/connections/approve', 'POST', {user_code: req.data.user_code, can_write: true, can_negotiate: true, can_accept: true}, {cookie: ownerCookie})).status, 200);
  const token = await api('/agent-token', 'POST', {device_code: req.data.device_code});
  assert.equal(token.status, 200);
  return token.data.access_token as string;
}
const tool = async (token: string, name: string, args: Json = {}) => api('/tools/' + name, 'POST', args, {token});

test('the guide is enough to connect: request, owner approval, token, tools', () => {
  const guide = dealoopGuide(ORIGIN);
  for (const needle of ['/api/v1/agent-connections', '/api/v1/agent-token', '/api/v1/tools', '/api/v1/mcp', 'verification_uri_complete', 'get_updates', 'open_negotiation', 'post_campaign']) assert.ok(guide.includes(needle), needle);
});

test('Summer\'s and Bean\'s agents connect on their own and agree a deal over HTTP', async () => {
  const listed = await api('/tools');
  assert.equal(listed.status, 200);
  const names = (listed.data.tools as {name: string; input_schema: {properties?: object}}[]).map(t => t.name);
  for (const n of ['get_my_identity', 'get_updates', 'post_campaign', 'open_negotiation', 'negotiate', 'set_creator_profile', 'read_negotiation']) assert.ok(names.includes(n), n);
  assert.ok((listed.data.tools as {input_schema: {properties?: Json}}[]).find((_, i) => names[i] === 'post_campaign')!.input_schema.properties!.deadline_date);
  assert.equal((await tool('', 'get_my_identity')).status, 401, 'tools need a token');

  const summer = await connect('Claude Code for Summer', await signIn('Summer', 'summer.xia@zoom.us'));
  const bean = await connect('Codex for Bean', await signIn('Bean', 'qinxian.xia@gmail.com'));

  const me = await tool(summer, 'get_my_identity');
  assert.deepEqual([me.data.user_id, me.data.name], ['email:summer.xia@zoom.us', 'Summer'], 'the owner comes from the token, with the owner\'s own name');
  const today = String(me.data.platform_today);
  assert.equal((await tool(summer, 'post_campaign', {title: 'Dealoop'})).status, 400, 'arguments are checked against the schema');
  const posted = await tool(summer, 'post_campaign', {app_url: 'https://dealoop.test', app_description: 'A marketplace where founders and creators make deals.', title: 'Dealoop', brief: 'Promote Dealoop: 100 new sign-ups, the more the better. Budget $1000, no more than $10 each.', goal_sign_ups: 100, budget_dollars: 1000, max_price_per_sign_up_dollars: 10, deadline_date: new Date(Date.parse(today) + 14 * DAY).toISOString().slice(0, 10)});
  assert.equal(posted.data.status, 'posted');
  const campaignId = posted.data.campaign_id;

  const found = await tool(bean, 'get_updates');
  assert.ok(found.data.updates.some((u: Json) => u.kind === 'campaign.posted' && u.campaign_id === campaignId));
  assert.equal((await tool(bean, 'open_negotiation', {campaign_id: campaignId, price_per_sign_up_dollars: 8, sign_ups: 60, message: '$8 for 60?'})).data.error, 'NO_PROFILE');
  assert.equal((await tool(bean, 'set_creator_profile', {handle: '@beanbuilds', platform: 'YouTube', niche: 'AI tools', audience: 'developers and indie founders', followers: 120000})).data.status, 'saved');
  const bid = await tool(bean, 'open_negotiation', {campaign_id: campaignId, price_per_sign_up_dollars: 8, sign_ups: 60, message: 'Developers and indie founders; $8 for my next 60?'});
  assert.equal(bid.data.status, 'sent');
  assert.equal((await tool(summer, 'open_negotiation', {campaign_id: campaignId, price_per_sign_up_dollars: 1, sign_ups: 1, message: 'x'})).data.error, 'OWN_CAMPAIGN');

  const waiting = (await tool(summer, 'get_updates')).data.waiting_on_you;
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].you_are, 'founder');
  assert.equal((await tool(summer, 'negotiate', {negotiation_id: waiting[0].negotiation_id, action: 'propose', price_per_sign_up_dollars: 6.5, sign_ups: 50, message: 'I can do $6.50 for 50.'})).data.status, 'sent');
  const back = (await tool(bean, 'get_updates')).data.waiting_on_you[0];
  assert.deepEqual([back.you_are, back.last_move.price_per_sign_up], ['creator', '$6.50']);
  assert.equal((await tool(bean, 'negotiate', {negotiation_id: back.negotiation_id, action: 'accept', message: 'Deal.'})).data.status, 'deal_agreed');

  // The same tools over MCP, with the same token.
  const rpc = (body: Json) => api('/mcp', 'POST', body, {token: bean}, {Accept: 'application/json, text/event-stream'});
  const tools = await rpc({jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}});
  assert.equal(tools.status, 200, JSON.stringify(tools.data));
  assert.ok(tools.data.result.tools.some((t: Json) => t.name === 'read_negotiation'));
  const read = await rpc({jsonrpc: '2.0', id: 2, method: 'tools/call', params: {name: 'read_negotiation', arguments: {negotiation_id: back.negotiation_id}}});
  assert.equal(read.data.result.structuredContent.status, 'agreed');
  assert.equal((await api('/mcp', 'POST', {jsonrpc: '2.0', id: 3, method: 'tools/list'})).status, 401, 'MCP needs the token too');
});

test('email sign-in exists only when the site runs on localhost', async () => {
  process.env.DEALOOP_ORIGIN = 'https://dealoop.example';
  try {
    const r = await authEndpoint(new Request('https://dealoop.example/api/auth/email', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://dealoop.example'}, body: JSON.stringify({name: 'X', email: 'x@example.com'})}), db, 'email');
    assert.equal(r.status, 404);
  } finally {
    process.env.DEALOOP_ORIGIN = ORIGIN;
  }
});

test('a creator\'s tracked link: people sign up through it, and the sign-ups count for that creator', async () => {
  const founder = await connect('Founder agent', await signIn('Link Founder', 'link-founder@example.test'));
  const creator = await connect('Creator agent', await signIn('Link Creator', 'link-creator@example.test'));
  const today = String((await tool(founder, 'get_my_identity')).data.platform_today);
  const campaignId = (await tool(founder, 'post_campaign', {title: 'StoryNest', app_url: 'https://storynest.test', app_description: 'Learn to read with short stories for kids.', brief: 'Promote StoryNest to parents.', goal_sign_ups: 50, budget_dollars: 500, max_price_per_sign_up_dollars: 8, deadline_date: new Date(Date.parse(today) + 7 * DAY).toISOString().slice(0, 10)})).data.campaign_id;
  await tool(creator, 'set_creator_profile', {handle: '@linkcreator', platform: 'YouTube', niche: 'parenting', audience: 'parents', followers: 5000});
  const joined = await tool(creator, 'join_campaign', {campaign_id: campaignId});
  const url = String(joined.data.tracked_link);
  assert.match(url, /^http:\/\/localhost:3200\/r\/t_[a-f0-9]{32}$/);
  const token = url.split('/r/')[1];
  const signup = (email: string, t = token) => api(`/links/${t}/signup`, 'POST', {email});
  assert.equal((await signup('not-an-email')).status, 400);
  assert.equal((await signup('a@example.test', 't_' + '0'.repeat(32))).status, 404);
  const first = await signup('Parent.One@example.test');
  assert.deepEqual([first.status, first.data.status], [201, 'recorded']);
  assert.equal((await signup('parent.one@example.test')).status, 409, 'one sign-up per person');
  await signup('parent.two@example.test');

  const {CampaignStore} = await import('../db/campaign-store.ts');
  const {campaignView} = await import('../db/campaign-view.ts');
  const {feedRows} = await import('../app/campaigns/feed-rows.ts');
  const store = new CampaignStore(db);
  for (const c of (await store.require(campaignId)).book.conversions) await store.verifyConversion(campaignId, c.id, Date.now());
  const v = (await campaignView(store, campaignId))!;
  const row = v.creators.find(c => c.handle === '@linkcreator')!;
  assert.deepEqual([row.signUps, row.verified], [2, 2], 'the live results count them for the creator');
  assert.deepEqual(feedRows(v.feed).slice(0, 2).map(r => r.summary), ['2 sign-ups verified.', '2 sign-ups recorded.']);
  assert.equal(v.imageUrl, `/campaigns/${campaignId}/art.svg`);
});

test('the Reset button wipes campaigns, sign-ins and agent connections, on localhost only', async () => {
  const token = await connect('Agent before reset', await signIn('Reset Tester', 'reset@example.test'));
  const today = String((await tool(token, 'get_my_identity')).data.platform_today);
  assert.equal((await tool(token, 'post_campaign', {title: 'Temp', app_url: 'https://temp.test', app_description: 'A temporary app for this test.', brief: 'Test.', goal_sign_ups: 10, budget_dollars: 100, max_price_per_sign_up_dollars: 5, deadline_date: new Date(Date.parse(today) + 7 * DAY).toISOString().slice(0, 10)})).data.status, 'posted');
  assert.equal((await api('/demo/reset', 'POST', {}, {}, {Origin: 'https://evil.example'})).status, 403, 'only from Dealoop\'s own page');
  const r = await handleApi(new Request(ORIGIN + '/api/v1/demo/reset', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: ORIGIN}, body: '{}'}), {DB: db});
  assert.equal(r.status, 200);
  assert.match(r.headers.get('set-cookie') ?? '', /thread_session=signed-out/, 'this browser is signed out');
  assert.equal((await tool(token, 'get_my_identity')).status, 401, 'agents must connect again');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM campaigns WHERE id NOT LIKE 'cmp_demo_%'").first<{n: number}>())!.n, 0, 'real campaigns are gone');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM campaigns WHERE id LIKE 'cmp_demo_%'").first<{n: number}>())!.n, 7, 'the sample campaigns stay');
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').first<{n: number}>())!.n, 0);
  process.env.DEALOOP_ORIGIN = 'https://dealoop.example';
  try {
    assert.equal((await handleApi(new Request('https://dealoop.example/api/v1/demo/reset', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: 'https://dealoop.example'}, body: '{}'}), {DB: db})).status, 404);
  } finally {
    process.env.DEALOOP_ORIGIN = ORIGIN;
  }
});

test('internal test accounts sign in with their code, through the API only', async () => {
  const before = process.env.DEALOOP_TEST_USERS;
  const post = (body: unknown) => authEndpoint(new Request(ORIGIN + '/api/auth/code', {method: 'POST', headers: {'Content-Type': 'application/json', Origin: ORIGIN}, body: JSON.stringify(body)}), db, 'code');
  try {
    delete process.env.DEALOOP_TEST_USERS;
    assert.equal((await post({email: 'tester@example.test', code: 'ABCDEFGH12'})).status, 404, 'off unless configured');
    process.env.DEALOOP_TEST_USERS = 'tester@example.test:ABCDEFGH12:Tester, other@example.test:ZYXWVUTS98:Other';
    assert.equal((await post({email: 'tester@example.test', code: 'WRONGCODE1'})).status, 401);
    assert.equal((await post({email: 'stranger@example.test', code: 'ABCDEFGH12'})).status, 401, 'a code only works for its own account');
    const ok = await post({email: 'Tester@Example.test', code: 'ABCDEFGH12'});
    assert.equal(ok.status, 200);
    const cookie = /thread_session=([a-f0-9]{64})/.exec(ok.headers.get('set-cookie') ?? '')![1];
    const req = await api('/agent-connections', 'POST', {name: 'Test agent'});
    assert.equal((await api('/connections/approve', 'POST', {user_code: req.data.user_code, can_write: true, can_negotiate: true, can_accept: true}, {cookie})).status, 200, 'the session works like any other');
  } finally {
    if (before === undefined) delete process.env.DEALOOP_TEST_USERS; else process.env.DEALOOP_TEST_USERS = before;
  }
});
