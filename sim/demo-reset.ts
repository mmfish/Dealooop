// Back to the demo's starting point (DEMO-FLOW, recording): no campaigns, the
// platform clock on real time, and the creators' public profiles seeded, Yi
// with his 200-sign-up track record. Users and the old marketplace's tables are
// left alone. One transaction, so a running dev server sees either the old
// state or the new one.

import type {CampaignStore} from '../db/campaign-store.ts';
import {seedCreators} from './demo-creators.ts';

// Children before parents (foreign keys are enforced).
const TABLES = [
  'ledger_entries', 'conversions', 'campaign_links', 'campaign_deals', 'price_changes', 'proposal_rejections',
  'campaign_commits', 'campaign_events', 'campaign_questions', 'campaign_negotiations', 'campaigns', 'platform_clock',
];

export async function resetDemo(store: CampaignStore, now = Date.now()): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const t of TABLES) counts[t] = Number((await store.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{n: number}>())?.n ?? 0);
  await store.db.batch(TABLES.map(t => store.db.prepare(`DELETE FROM ${t}`)));
  await seedCreators(store, now);
  return counts;
}
