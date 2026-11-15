// The read behind the campaign pages and Claude's report, and the live stream
// that keeps a page current when another process writes (Claude Desktop's MCP
// server, the simulation).

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SQLiteDatabase} from '../runtime/sqlite.ts';
import {CampaignStore, safeImageUrl} from '../db/campaign-store.ts';
import {campaignClock, campaignList, campaignView} from '../db/campaign-view.ts';
import {campaignReport} from '../mcp/campaign-tools.ts';
import {openCampaignStream, StreamError} from '../backend/campaign-stream.ts';
import {feedRows} from '../app/campaigns/feed-rows.ts';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 12, 9);
const base = {ownerId: 'summer', ownerName: 'Summer', title: 'Dealoop', brief: 'Help my app get 100 new sign-ups.', productUrl: '', goalCount: 100, budgetCents: 100_000, maxCacCents: 1_000, deadline: NOW + 14 * DAY, now: NOW};

async function seeded() {
  const sqlite = new SQLiteDatabase(':memory:');
  sqlite.migrate('drizzle');
  const store = new CampaignStore(sqlite.asD1());
  await store.createCampaign({...base, id: 'c'});
  for (const [id, prior] of [['growth', 0], ['yi', 200], ['chef', 0]] as const) {
    await store.upsertCreator({userId: id, handle: '@' + id, platform: 'YouTube', niche: id === 'chef' ? 'cooking' : 'startups', audience: '', followers: 5_000, priorVerified: prior, demo: id !== 'yi', now: NOW});
  }
  const growth = await store.join('c', 'growth', NOW + 1, 'my audience is early founders');
  const yi = await store.join('c', 'yi', NOW + 2);
  await store.decline('c', 'chef', 'cooking channel, wrong audience', NOW + 3);
  const convs = [];
  for (let i = 0; i < 6; i++) convs.push(await store.recordConversion(growth.token, 'g' + i, NOW + DAY + i));
  for (const c of convs.slice(0, 5)) await store.verifyConversion('c', c.id, NOW + 2 * DAY);
  await store.applyProposal('c', {kind: 'raise_price', supplyAtCurrent: 10, supplyAtRaised: 40}, NOW + 2 * DAY, 'founder-agent');
  await store.applyProposal('c', {kind: 'raise_price', supplyAtCurrent: 1, supplyAtRaised: 1, sneaky: true}, NOW + 2 * DAY, 'founder-agent');
  await store.applyProposal('c', {kind: 'create_deal', creatorId: 'yi', priceCents: 700, volumeCap: 3, creatorVerifiedTotal: 0}, NOW + 3 * DAY, 'founder-agent');
  const y = await store.recordConversion(yi.token, 'y1', NOW + 4 * DAY);
  await store.verifyConversion('c', y.id, NOW + 4 * DAY);
  return {sqlite, store};
}

test('the view shows who joined, who declined and why, every price change and refusal', async () => {
  const {store} = await seeded();
  const v = (await campaignView(store, 'c'))!;
  assert.equal(v.ownerName, 'Summer');
  assert.deepEqual(v.signUps, {verified: 6, pending: 1, rejected: 0, unfunded: 0});
  assert.equal(v.joinedCount, 2);
  assert.equal(v.declinedCount, 1);
  const [first, second, third] = v.creators;
  assert.equal(first.handle, '@growth');
  assert.equal(first.signUps, 6, 'pending and verified sign-ups count, by creator');
  assert.equal(first.verified, 5);
  assert.equal(first.note, 'my audience is early founders');
  assert.equal(first.simulated, true);
  assert.deepEqual(second.deal, {priceCents: 700, volumeCap: 3});
  assert.equal(second.simulated, false, 'Yi is a person, not a simulated agent');
  assert.equal(third.status, 'declined');
  assert.equal(third.note, 'cooking channel, wrong audience');
  assert.equal(v.priceHistory.length, 1);
  assert.equal(v.refusedProposals, 1);
  assert.equal(v.results, null);
  assert.ok(v.feed.some(e => e.tone === 'refused'));
  assert.ok(v.feed.some(e => e.summary === 'Sign-up #1 via @growth.'), 'feed names creators by handle');
  assert.ok(v.feed.some(e => e.kind === 'deal.created' && e.summary.includes("@yi's next 3")));
  assert.equal(v.lastSequence, Math.max(...v.feed.map(e => e.sequence)));

  // Only the newest events, still oldest first.
  const short = (await campaignView(store, 'c', {feedLimit: 3}))!;
  assert.deepEqual(short.feed.map(e => e.sequence), v.feed.slice(-3).map(e => e.sequence));

  const [item] = await campaignList(store);
  assert.equal(item.verified, 6);
  assert.equal(item.creatorsJoined, 2);
  assert.equal(item.committedCents, v.committedCents);
  assert.equal(item.paidCents, null);
});

test('after settlement the page and the report show the same paid totals', async () => {
  const {store} = await seeded();
  const ledger = await store.closeAndSettle('c', NOW + 14 * DAY);
  const v = (await campaignView(store, 'c'))!;
  const r = v.results!;
  assert.equal(r.verified, ledger.length);
  assert.equal(r.paidCents, ledger.reduce((s, e) => s + e.amountCents, 0));
  assert.equal(r.unspentCents, 100_000 - r.paidCents);
  assert.equal(r.fixedAtMaxCount, 100);
  assert.equal((await campaignList(store))[0].paidCents, r.paidCents);
  assert.ok(r.dealPaidCents > 0);
  assert.equal(v.creators.filter(c => c.status === 'joined').reduce((s, c) => s + (c.paidCents ?? 0), 0), r.paidCents, 'per-creator payouts add up');

  const report = await campaignReport(store, (await store.load('c'))!, 'http://x');
  const settled = report.settled as {paid: string; verified_sign_ups: number};
  assert.equal(settled.paid, '$' + (r.paidCents / 100).toFixed(2));
  assert.equal(settled.verified_sign_ups, r.verified);
  assert.equal(report.refused_agent_proposals, 1);
  assert.equal(report.creators_declined, 1);
});

test('consecutive sign-ups fold into one row, newest first', () => {
  const e = (sequence: number, kind: string, summary = kind) => ({sequence, kind, tone: 'other' as const, actor: 'platform', simulated: false, summary, at: NOW + sequence});
  const rows = feedRows([e(1, 'campaign.posted'), e(2, 'conversion.recorded', 'Sign-up #1'), e(3, 'conversion.recorded'), e(4, 'conversion.recorded'), e(5, 'price.raised'), e(6, 'conversion.recorded', 'Sign-up #4')]);
  assert.deepEqual(rows.map(r => r.summary), ['Sign-up #4', 'price.raised', '3 sign-ups recorded.', 'campaign.posted']);
});

test('a campaign image is an http(s) URL or a site path, nothing else', async () => {
  const {store} = await seeded();
  assert.equal((await campaignView(store, 'c'))!.imageUrl, '');
  await store.setImage('c', '/brand/dealoop-icon.png');
  assert.equal((await campaignView(store, 'c'))!.imageUrl, '/brand/dealoop-icon.png');
  assert.equal((await campaignList(store))[0].imageUrl, '/brand/dealoop-icon.png');
  for (const bad of ['javascript:alert(1)', '//evil.test/x.png', 'data:image/png;base64,AA']) assert.equal(safeImageUrl(bad), '');
  assert.equal(safeImageUrl('https://cdn.test/a.png'), 'https://cdn.test/a.png');
  await assert.rejects(store.setImage('c', 'javascript:alert(1)'));
  const v = (await campaignView(store, 'c'))!;
  assert.equal(v.liveCacCents, Math.round(v.committedCents / 7), 'live CAC is committed over pending and verified sign-ups');
  assert.equal(v.creators.find(c => c.handle === '@yi')!.earnedCents, 700, "Yi's one sign-up is paid on deal terms");
});

test('the campaign clock counts from the campaign start', () => {
  assert.equal(campaignClock(NOW, NOW), 'Day 1 · 00:00');
  assert.equal(campaignClock(NOW + 2 * DAY + 14 * 3_600_000 + 5 * 60_000, NOW), 'Day 3 · 14:05');
});

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, pattern: RegExp, ms = 3000) {
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    const chunk = await Promise.race([reader.read(), new Promise<null>(r => setTimeout(() => r(null), deadline - Date.now()))]);
    if (!chunk || chunk.done) break;
    text += decoder.decode(chunk.value);
    if (pattern.test(text)) return text;
  }
  throw new Error(`stream never matched ${pattern}; got ${JSON.stringify(text)}`);
}

test('a page hears about writes made by another process', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dealoop-stream-'));
  const file = join(dir, 'db.sqlite');
  const web = new SQLiteDatabase(file);
  web.migrate('drizzle');
  const mcp = new SQLiteDatabase(file); // stands in for Claude Desktop's server process
  const elsewhere = new CampaignStore(mcp.asD1());
  const abort = new AbortController();
  try {
    await elsewhere.createCampaign({...base, id: 'c'});
    const after = await new CampaignStore(web.asD1()).latestSequence();
    const all = await openCampaignStream(new Request(`http://local/api/campaigns/stream?after=${after}`, {signal: abort.signal}), web.asD1(), {pollMs: 40});
    const one = await openCampaignStream(new Request(`http://local/api/campaigns/stream?campaign=c&after=${after}`, {signal: abort.signal}), web.asD1(), {pollMs: 40});
    assert.equal(all.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const allReader = all.body!.getReader(), oneReader = one.body!.getReader();
    await readUntil(allReader, /event: ready/);
    await readUntil(oneReader, /event: ready/);

    await elsewhere.createCampaign({...base, id: 'other', brief: 'another'});
    const seen = await readUntil(allReader, /event: change/);
    assert.match(seen, new RegExp(`"sequence":${after + 1}`));
    await elsewhere.addEvent('c', {kind: 'creator.joined', actor: '@x', summary: 'joined'}, NOW);
    const own = await readUntil(oneReader, /event: change/);
    assert.match(own, new RegExp(`"sequence":${after + 2}`), 'the campaign stream skips other campaigns\' events');
  } finally {
    abort.abort();
    web.close(); mcp.close();
    rmSync(dir, {recursive: true, force: true});
  }
});

test('the stream refuses other origins and bad cursors', async () => {
  const sqlite = new SQLiteDatabase(':memory:');
  sqlite.migrate('drizzle');
  await assert.rejects(openCampaignStream(new Request('http://local/s', {headers: {origin: 'http://evil'}}), sqlite.asD1()), (e: unknown) => e instanceof StreamError && e.status === 403);
  await assert.rejects(openCampaignStream(new Request('http://local/s?after=-1'), sqlite.asD1()), (e: unknown) => e instanceof StreamError && e.status === 400);
  await assert.rejects(openCampaignStream(new Request('http://local/s?campaign=a%20b'), sqlite.asD1()), (e: unknown) => e instanceof StreamError && e.status === 400);
});
