// npm run demo:seed
//
// Adds the sample campaigns (sim/demo-campaigns.ts) to the homepage: simulated
// founders, apps, creators and sign-ups, labeled as demo data. Leaves existing
// campaigns alone; run it again after a reset. Uses DEALOOP_DB_PATH or
// data/dealoop.sqlite.

import {join} from 'node:path';
import {SQLiteDatabase} from '../runtime/sqlite.ts';
import {CampaignStore} from '../db/campaign-store.ts';
import {seedDemoCampaigns} from './demo-campaigns.ts';

const root = join(import.meta.dirname, '..');
const sqlite = new SQLiteDatabase(process.env.DEALOOP_DB_PATH || join(root, 'data/dealoop.sqlite'));
sqlite.migrate(join(root, 'drizzle'));
const made = await seedDemoCampaigns(new CampaignStore(sqlite.asD1()));
console.log(made.length ? `Added ${made.length} sample campaigns: ${made.join(', ')}` : 'The sample campaigns are already there.');
sqlite.close();
