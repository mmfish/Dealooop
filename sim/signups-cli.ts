// npm run signups -- [--campaign <id> | --title <name>] [--count 60] [--rate 30] [--verify-after 8] [--reject 0.05] [--seed 1] [--wait-deals N]
//
// --title picks the newest open campaign with that title, waiting until one is posted.
// --wait-deals N waits until that many creators have agreed a deal on it, then starts
// (the demo: sign-ups begin once both creators have taken their offers).
//
// Simulates prospective users signing up through the creators' tracked links, in
// real time, so the campaign's live results fill up while you watch. Each sign-up
// goes through the public link endpoint exactly as a person's would (POST
// <origin>/api/v1/links/<token>/signup); a few seconds later the app "confirms"
// it, which verifies it (or rejects a few) on the platform. Creators with a deal
// get more sign-ups. Stops after --count sign-ups, when the budget is fully
// committed, when the campaign ends, or on Ctrl-C.
//
// ALL USERS ARE SIMULATED (example.test addresses). Needs the dev server running
// (DEALOOP_ORIGIN, default http://localhost:3200) and the same database
// (DEALOOP_DB_PATH or data/dealoop.sqlite). No model calls.

import {join} from 'node:path';
import {remainingCents} from '../core/campaign.ts';
import {SQLiteDatabase} from '../runtime/sqlite.ts';
import {CampaignStore} from '../db/campaign-store.ts';
import {createRng} from './market.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const root = join(import.meta.dirname, '..');
const origin = (process.env.DEALOOP_ORIGIN || 'http://localhost:3200').replace(/\/$/, '');
const count = Number(flag('count', '60'));
const perMinute = Number(flag('rate', '30'));
const verifyAfterMs = Number(flag('verify-after', '8')) * 1000;
const rejectRate = Number(flag('reject', '0.05'));
const rng = createRng(Number(flag('seed', String(Date.now() % 100000))));

const sqlite = new SQLiteDatabase(process.env.DEALOOP_DB_PATH || join(root, 'data/dealoop.sqlite'));
sqlite.migrate(join(root, 'drizzle'));
const store = new CampaignStore(sqlite.asD1());

const title_ = flag('title', '');
const waitDeals = Number(flag('wait-deals', '0'));
const sleep0 = (ms: number) => new Promise(r => setTimeout(r, ms));
let campaignId = flag('campaign', '');
if (!campaignId && title_) {
  console.log(`Waiting for an open campaign titled "${title_}"…`);
  for (;;) {
    campaignId = (await store.list({status: 'open', limit: 200})).find(c => c.title.toLowerCase() === title_.toLowerCase())?.id ?? '';
    if (campaignId) break;
    await sleep0(5000);
  }
  console.log(`Found it: ${campaignId}`);
}
campaignId ||= (await store.list({status: 'open', limit: 1}))[0]?.id ?? '';
if (!campaignId) { console.error('No open campaign. Post one first.'); process.exit(1); }
if (waitDeals > 0) {
  console.log(`Waiting until ${waitDeals} creators have agreed a deal…`);
  let seen = -1;
  for (;;) {
    const deals = Object.keys((await store.require(campaignId)).book.deals).length;
    if (deals !== seen) { console.log(`  deals agreed: ${deals} of ${waitDeals}`); seen = deals; }
    if (deals >= waitDeals) break;
    await sleep0(5000);
  }
}
const title = (await store.require(campaignId)).meta.title;

const FIRST = ['ava', 'ben', 'chloe', 'dan', 'ella', 'finn', 'grace', 'hugo', 'ivy', 'jack', 'kai', 'luna', 'maya', 'noah', 'olive', 'priya', 'quinn', 'ravi', 'sofia', 'theo', 'uma', 'vik', 'wren', 'yara', 'zoe'];
const LAST = ['lee', 'kim', 'patel', 'garcia', 'chen', 'nguyen', 'smith', 'khan', 'lopez', 'wu', 'brown', 'silva'];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let stopping = false;
process.on('SIGINT', () => { if (stopping) process.exit(130); stopping = true; console.log('\nStopping after pending verifications… (Ctrl-C again to quit now)'); });

console.log(`Simulated sign-ups for "${title}" (${campaignId}) through ${origin}/r/<creator's link> · up to ${count}, about ${perMinute}/min · SIMULATED USERS\n`);

const pending: Promise<void>[] = [];
let made = 0, verified = 0, rejected = 0, unfunded = 0;
const by = new Map<string, number>();

while (!stopping && made < count) {
  const s = await store.require(campaignId);
  const c = s.book.campaign;
  if (c.status !== 'open' || (await store.now()) >= c.deadline) { console.log('The campaign has ended.'); break; }
  if (remainingCents(s.book) < c.currentPriceCents) { console.log('The budget is fully committed; creators stop promoting.'); break; }
  const links = await store.links(campaignId);
  if (!links.length) { console.log('No creator has joined yet; waiting…'); await sleep(5000); continue; }
  // Creators with a deal are the most motivated: three times the share.
  const weights = links.map(l => (s.book.deals[l.creatorId] ? 3 : 1));
  let pick = rng.next() * weights.reduce((a, b) => a + b, 0), link = links[0];
  for (let i = 0; i < links.length; i++) { pick -= weights[i]; if (pick <= 0) { link = links[i]; break; } }

  const email = `${FIRST[Math.floor(rng.next() * FIRST.length)]}.${LAST[Math.floor(rng.next() * LAST.length)]}.${Date.now().toString(36)}${made}@example.test`;
  const r = await fetch(`${origin}/api/v1/links/${link.token}/signup`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email})});
  const data = await r.json() as {status?: string; sign_up?: number; error?: {message?: string}};
  if (!r.ok) { console.log(`refused   ${link.handle}: ${data.error?.message ?? r.status}`); if (r.status === 404 || r.status === 409) break; continue; }
  made++;
  by.set(link.handle, (by.get(link.handle) ?? 0) + 1);
  if (data.status === 'unfunded') { unfunded++; console.log(`unfunded  #${data.sign_up} via ${link.handle} (the budget was already committed)`); }
  else {
    console.log(`sign-up   #${data.sign_up} via ${link.handle}`);
    // The app confirms the new user a few seconds later.
    const seq = data.sign_up!;
    const reject = rng.next() < rejectRate;
    pending.push(sleep(verifyAfterMs * (0.6 + rng.next() * 0.8)).then(async () => {
      const conv = (await store.require(campaignId)).book.conversions.find(x => x.seq === seq);
      if (!conv || conv.status !== 'pending') return;
      if (reject) { await store.rejectConversion(campaignId, conv.id, await store.now()); rejected++; console.log(`rejected  #${seq} failed verification`); }
      else { await store.verifyConversion(campaignId, conv.id, await store.now()); verified++; }
    }));
  }
  await sleep((60_000 / perMinute) * (0.5 + rng.next()));
}

await Promise.all(pending);
const after = await store.require(campaignId);
console.log(`\n${made} sign-ups · ${verified} verified · ${rejected} rejected · ${unfunded} unfunded · by creator: ${[...by].map(([h, n]) => `${h} ${n}`).join(', ') || 'none'}`);
console.log(`Budget committed: $${((after.book.campaign.budgetCents - remainingCents(after.book)) / 100).toFixed(2)} of $${(after.book.campaign.budgetCents / 100).toFixed(2)} · ${origin}/campaigns/${campaignId}`);
sqlite.close();
