// npm run demo:reset
//
// Before each recording take: deletes every campaign (with its sign-ups,
// deals, questions, negotiations and feed), puts the platform clock back on
// real time and reseeds the creators' public profiles. A copy of the database
// is saved to data/backups/ first. Uses DEALOOP_DB_PATH or data/dealoop.sqlite.

import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {SQLiteDatabase} from '../runtime/sqlite.ts';
import {CampaignStore} from '../db/campaign-store.ts';
import {resetDemo} from './demo-reset.ts';

const root = join(import.meta.dirname, '..');
const path = process.env.DEALOOP_DB_PATH || join(root, 'data/dealoop.sqlite');
const sqlite = new SQLiteDatabase(path);
sqlite.migrate(join(root, 'drizzle'));

const dir = join(root, 'data/backups');
mkdirSync(dir, {recursive: true});
const backup = join(dir, `dealoop-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
sqlite.raw.prepare('VACUUM INTO ?').run(backup);

const deleted = await resetDemo(new CampaignStore(sqlite.asD1()));
const removed = Object.entries(deleted).filter(([, n]) => n > 0).map(([t, n]) => `${t} ${n}`).join(', ');
console.log(`Reset ${path}\nBackup: ${backup}\nDeleted: ${removed || 'nothing (already clean)'}\nClock: real time · simulated creators seeded; real people's agents set up their own profiles`);
sqlite.close();
