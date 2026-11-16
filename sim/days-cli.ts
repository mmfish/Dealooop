// npm run days -- --to 5   [--campaign <id>] [--pace 60] [--seed 1]
// npm run days -- --to end [--campaign <id>] [--pace 60] [--seed 1]
//
// Beats 5a and 5b of the demo: runs the newest open campaign (or --campaign)
// day by day on an accelerated clock, writing each simulated sign-up,
// verification and price decision as it happens; open the campaign page to
// watch it. --to 5 stops at the end of day 5, for Bean's private deal; --to end
// runs to the deadline and settles. No model calls. Uses DEALOOP_DB_PATH or
// data/dealoop.sqlite.

import {join} from 'node:path';
import {SQLiteDatabase} from '../runtime/sqlite.ts';
import {CampaignStore} from '../db/campaign-store.ts';
import {campaignDay} from '../db/campaign-view.ts';
import {runDays} from './campaign-days.ts';

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : undefined; };
const root = join(import.meta.dirname, '..');

const to = flag('to');
if (!to || (to !== 'end' && !(Number(to) >= 1))) { console.error('Usage: npm run days -- --to <day>|end [--campaign <id>] [--pace <ms>] [--seed <n>]'); process.exit(1); }

const sqlite = new SQLiteDatabase(process.env.DEALOOP_DB_PATH || join(root, 'data/dealoop.sqlite'));
sqlite.migrate(join(root, 'drizzle'));
const store = new CampaignStore(sqlite.asD1());
const id = flag('campaign') ?? (await store.list({status: 'open', limit: 1}))[0]?.id;
if (!id) { console.error('No open campaign.'); process.exit(1); }
const s = await store.require(id);
const c = s.book.campaign;

console.log(`"${s.meta.title}" (${id}) · ${campaignDay(await store.now(), c.createdAt, c.deadline)} → ${to === 'end' ? 'deadline and settlement' : `end of day ${to}`} · SIMULATED SIGN-UPS\n`);
const r = await runDays(store, id, {to: to === 'end' ? 'end' : Number(to), seed: Number(flag('seed') ?? 1), paceMs: Number(flag('pace') ?? 60), onStep: line => console.log(line)});
const after = await store.require(id);
console.log(`\n${r.signUps} sign-ups · ${r.verified} verified · ${r.rejected} rejected · ${r.raises} price raises, ${r.refusals} refused · public price ${'$' + (after.book.campaign.currentPriceCents / 100).toFixed(2)}${r.joinedLater.length ? ` · joined later: ${r.joinedLater.join(', ')}` : ''}`);
console.log(r.settled ? 'Settled; the results are on the campaign page.' : `Paused at the end of day ${to}. The platform clock stays here for the page and both Claude windows.`);
sqlite.close();
