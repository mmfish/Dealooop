// Matching on a live campaign (DEMO-FLOW beat 3): every simulated creator's
// agent reads the campaign and joins, declines or asks the founder a question.
// Each decision is written as soon as it is made, so the campaign page fills
// up while the audience watches. A run can be recorded and replayed without
// model calls (the fallback for beat 3).

import {readFileSync} from 'node:fs';
import type {JsonClient} from '../agents/claude.ts';
import {mapLimit} from '../agents/claude.ts';
import {decideMatch, type MatchCampaign, type MatchDecision} from '../agents/match-agent.ts';
import type {CampaignStore} from '../db/campaign-store.ts';
import {DEMO_CREATORS, seedCreators, type DemoCreator} from './demo-creators.ts';

export interface RecordedDecision {
  userId: string;
  handle: string;
  decision: MatchDecision;
  fellBack?: boolean;
}

export interface MatchRecording {
  campaignTitle: string;
  recordedAt: string;
  model: string | null;
  decisions: RecordedDecision[];
}

export interface MatchOptions {
  /** Make live model calls with this client... */
  client?: JsonClient;
  /** ...or replay these decisions (no model calls). */
  recording?: MatchRecording;
  creators?: DemoCreator[];
  concurrency?: number;
  /** Pause between writes, so the page visibly fills (replays especially). */
  paceMs?: number;
  now?: () => number;
  onDecision?: (d: RecordedDecision) => void;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export const loadRecording = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as MatchRecording;

export async function runMatching(store: CampaignStore, campaignId: string, options: MatchOptions): Promise<RecordedDecision[]> {
  if (!options.client === !options.recording) throw new Error('Pass either a client or a recording.');
  const now = options.now ?? Date.now;
  const stored = await store.require(campaignId);
  const c = stored.book.campaign;
  await seedCreators(store, now());

  // Creators who already answered this campaign are left alone, so a rerun only adds the missing ones.
  const decided = new Set<string>();
  for (const e of await store.events(campaignId, 0, 1000)) {
    if (['creator.joined', 'creator.declined', 'clarification.asked'].includes(e.kind) && typeof e.data.creatorId === 'string') decided.add(e.data.creatorId);
  }
  const creators = (options.creators ?? DEMO_CREATORS).filter(x => !decided.has(x.userId));
  const recorded = new Map(options.recording?.decisions.map(d => [d.userId, d]));
  const out: RecordedDecision[] = [];

  const apply = async (owner: DemoCreator, d: MatchDecision, fellBack?: boolean) => {
    const at = now();
    if (d.action === 'join') await store.join(campaignId, owner.userId, at, d.reason);
    else if (d.action === 'decline') await store.decline(campaignId, owner.userId, d.reason, at);
    else await store.askQuestion(campaignId, owner.userId, d.question, at);
    const r: RecordedDecision = {userId: owner.userId, handle: owner.handle, decision: d, ...(fellBack ? {fellBack} : {})};
    out.push(r);
    options.onDecision?.(r);
    if (options.paceMs) await sleep(options.paceMs);
  };

  if (options.recording) {
    for (const owner of creators) {
      const r = recorded.get(owner.userId);
      if (r) await apply(owner, r.decision, r.fellBack);
    }
    return out;
  }

  const view: MatchCampaign = {title: stored.meta.title, brief: stored.meta.brief, productUrl: stored.meta.productUrl, priceCents: c.currentPriceCents, maxCacCents: c.maxCacCents, deadline: c.deadline, now: now()};
  // Writes happen in completion order; the store serializes them per campaign.
  await mapLimit(creators, options.concurrency ?? 6, async owner => {
    const d = await decideMatch(options.client!, owner, view);
    await apply(owner, d, d.fellBack);
  });
  return out;
}
