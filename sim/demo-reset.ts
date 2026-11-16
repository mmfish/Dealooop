// A clean start for the demo (the Reset button on localhost, and npm run demo:reset):
// no campaigns, negotiations or deals; the platform clock on real time; nobody signed
// in and no agent connected, so every agent connects again with its owner's approval;
// no real creator profiles; the simulated creators' profiles seeded. User rows and the
// old marketplace's tables are left alone. One transaction, so a running server sees
// the old state or the new one.

import type {CampaignStore} from '../db/campaign-store.ts';
import {seedCreators} from './demo-creators.ts';

// Children before parents (foreign keys are enforced).
const TABLES = [
  'ledger_entries', 'conversions', 'campaign_links', 'campaign_deals', 'price_changes', 'proposal_rejections',
  'campaign_commits', 'campaign_events', 'campaign_questions', 'campaign_negotiations', 'campaigns', 'platform_clock', 'agent_cursors',
];
// Agent connections and sign-ins. A connection that published an old marketplace post is kept but revoked.
const ACCESS = [
  'DELETE FROM oauth_refresh_tokens',
  "UPDATE connections SET status='revoked', token_hash=NULL WHERE id IN (SELECT agent_id FROM posts WHERE agent_id IS NOT NULL)",
  'DELETE FROM connections WHERE id NOT IN (SELECT agent_id FROM posts WHERE agent_id IS NOT NULL)',
  'DELETE FROM auth_sessions',
  "DELETE FROM creator_profiles WHERE demo=0",
];

export async function resetDemo(store: CampaignStore, now = Date.now()): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const t of [...TABLES, 'connections', 'auth_sessions']) counts[t] = Number((await store.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first<{n: number}>())?.n ?? 0);
  counts.creator_profiles = Number((await store.db.prepare('SELECT COUNT(*) AS n FROM creator_profiles WHERE demo=0').first<{n: number}>())?.n ?? 0);
  await store.db.batch([...TABLES.map(t => store.db.prepare(`DELETE FROM ${t}`)), ...ACCESS.map(sql => store.db.prepare(sql))]);
  await seedCreators(store, now, false);
  return counts;
}
