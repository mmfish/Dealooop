// One read of a campaign for everyone who shows it: the platform pages
// (app/campaigns) and the founder's Claude (mcp/campaign-tools.ts
// campaign_report). Both build on this, so a page and a report can never
// disagree. Reads only; every amount comes from the core's functions on the
// stored Book or from the settled ledger. Plain JSON, safe to pass to a client.

import {committedCents, counts, unitPrice} from '../core/campaign.ts';
import type {CampaignStore, CreatorProfile, StoredCampaign} from './campaign-store.ts';

export const DAY_MS = 86_400_000;

export type FeedTone = 'posted' | 'joined' | 'declined' | 'question' | 'approval' | 'signup' | 'price' | 'deal' | 'refused' | 'settled' | 'other';

export interface FeedItem {
  sequence: number;
  kind: string;
  tone: FeedTone;
  actor: string;
  /** True when the actor is a simulated creator agent. */
  simulated: boolean;
  summary: string;
  at: number;
}

export interface CreatorRow {
  userId: string;
  handle: string;
  platform: string;
  niche: string;
  followers: number;
  priorVerified: number;
  simulated: boolean;
  /** 'asking': waiting for the founder's answer to their question; not joined yet. */
  status: 'joined' | 'asking' | 'declined';
  /** Why they declined, or the note they joined with. */
  note: string;
  signUps: number;
  verified: number;
  deal: {priceCents: number; volumeCap: number} | null;
  /** What their sign-ups are worth at today's prices (pending and verified); after settlement, what was paid. */
  earnedCents: number;
  /** Settled payout; null until the campaign closes. */
  paidCents: number | null;
}

export interface CampaignResults {
  paidCents: number;
  verified: number;
  averageCents: number | null;
  unspentCents: number;
  dealPaidCents: number;
  /** The most sign-ups this budget buys at a fixed price equal to the maximum. */
  fixedAtMaxCount: number;
}

export interface CampaignView {
  id: string;
  title: string;
  status: 'open' | 'closed';
  demo: boolean;
  ownerId: string;
  ownerName: string;
  brief: string;
  productUrl: string;
  imageUrl: string;
  goalCount: number;
  budgetCents: number;
  maxCacCents: number;
  startPriceCents: number;
  currentPriceCents: number;
  createdAt: number;
  deadline: number;
  signUps: {verified: number; pending: number; rejected: number; unfunded: number};
  committedCents: number;
  /** Average cost per sign-up so far: committed over pending and verified sign-ups; after settlement, paid over paid sign-ups. Null with none. */
  liveCacCents: number | null;
  priceHistory: {at: number; fromCents: number; toCents: number}[];
  refusedProposals: number;
  creators: CreatorRow[];
  joinedCount: number;
  /** Creators waiting for the founder's answer. */
  askingCount: number;
  declinedCount: number;
  results: CampaignResults | null;
  feed: FeedItem[];
  lastSequence: number;
}

const TONES: Record<string, FeedTone> = {
  'campaign.posted': 'posted', 'creator.joined': 'joined', 'creator.declined': 'declined',
  'clarification.asked': 'question', 'clarification.answered': 'approval', 'approval.requested': 'approval', 'approval.given': 'approval',
  'conversion.recorded': 'signup', 'conversion.unfunded': 'signup', 'conversion.rejected': 'signup',
  'price.raised': 'price', 'deal.created': 'deal', 'deal.negotiation_opened': 'deal', 'deal.negotiation_ended': 'declined', 'proposal.refused': 'refused', 'campaign.settled': 'settled',
};
export const toneOf = (kind: string): FeedTone => TONES[kind] ?? 'other';

export interface ViewOptions {
  /** How many of the newest feed events to include (default 200). */
  feedLimit?: number;
}

export async function campaignView(store: CampaignStore, id: string, options: ViewOptions = {}): Promise<CampaignView | null> {
  const s = await store.load(id);
  return s ? viewOf(store, s, options) : null;
}

export async function viewOf(store: CampaignStore, s: StoredCampaign, options: ViewOptions = {}): Promise<CampaignView> {
  const {book, meta} = s;
  const c = book.campaign;
  const n = counts(book);
  const profiles = new Map((await store.creators()).map(p => [p.userId, p]));
  const handles = new Map([...profiles.values()].map(p => [p.handle, p]));

  // Who joined comes from the links (authoritative); who declined, and the notes, from the feed.
  const all = await store.events(c.id, 0, 1000);
  const declined = new Map<string, string>();
  const notes = new Map<string, string>();
  for (const e of all) {
    const creatorId = typeof e.data.creatorId === 'string' ? e.data.creatorId : null;
    if (!creatorId) continue;
    if (e.kind === 'creator.declined') declined.set(creatorId, typeof e.data.reason === 'string' ? e.data.reason : '');
    if (e.kind === 'creator.joined' && typeof e.data.note === 'string') notes.set(creatorId, e.data.note);
  }

  const ledger = c.status === 'closed' ? await store.ledger(c.id) : [];
  const paidBy = new Map<string, number>();
  for (const e of ledger) paidBy.set(e.creatorId, (paidBy.get(e.creatorId) ?? 0) + e.amountCents);

  const tally = new Map<string, {signUps: number; verified: number; owed: number}>();
  for (const conv of book.conversions) {
    if (conv.status !== 'pending' && conv.status !== 'verified') continue;
    const t = tally.get(conv.creatorId) ?? {signUps: 0, verified: 0, owed: 0};
    t.signUps++;
    t.owed += unitPrice(book, conv);
    if (conv.status === 'verified') t.verified++;
    tally.set(conv.creatorId, t);
  }

  const asking = new Map((await store.questions(c.id, 'pending')).map(q => [q.creatorId, q.question]));
  const row = (userId: string, status: CreatorRow['status']): CreatorRow => {
    const p: Partial<CreatorProfile> = profiles.get(userId) ?? {};
    const t = tally.get(userId) ?? {signUps: 0, verified: 0, owed: 0};
    const d = book.deals[userId];
    return {
      userId, handle: p.handle ?? userId, platform: p.platform ?? '', niche: p.niche ?? '', followers: p.followers ?? 0,
      priorVerified: p.priorVerified ?? 0, simulated: p.demo ?? false, status,
      note: status === 'declined' ? declined.get(userId) ?? '' : status === 'asking' ? asking.get(userId) ?? '' : notes.get(userId) ?? '',
      signUps: t.signUps, verified: t.verified, deal: d ? {priceCents: d.priceCents, volumeCap: d.volumeCap} : null,
      earnedCents: c.status === 'closed' ? paidBy.get(userId) ?? 0 : t.owed,
      paidCents: c.status === 'closed' ? paidBy.get(userId) ?? 0 : null,
    };
  };
  const joined = Object.keys(s.links).map(u => row(u, 'joined'))
    .sort((a, b) => b.signUps - a.signUps || b.verified - a.verified || a.handle.localeCompare(b.handle));
  const askingRows = [...asking.keys()].filter(u => !s.links[u]).map(u => row(u, 'asking'));
  const declinedRows = [...declined.keys()].filter(u => !s.links[u] && !asking.has(u)).map(u => row(u, 'declined'))
    .sort((a, b) => a.handle.localeCompare(b.handle));

  const paid = ledger.reduce((sum, e) => sum + e.amountCents, 0);
  const results: CampaignResults | null = c.status === 'closed' ? {
    paidCents: paid, verified: ledger.length, averageCents: ledger.length ? Math.round(paid / ledger.length) : null,
    unspentCents: c.budgetCents - paid,
    dealPaidCents: ledger.filter(e => e.channel === 'deal').reduce((sum, e) => sum + e.amountCents, 0),
    fixedAtMaxCount: Math.min(c.goalCount, Math.floor(c.budgetCents / c.maxCacCents)),
  } : null;

  const recent = await store.recentEvents(c.id, options.feedLimit ?? 200);
  const owner = await store.db.prepare('SELECT name FROM users WHERE id=?').bind(meta.ownerId).first<{name: string}>();

  return {
    id: c.id, title: meta.title, status: c.status, demo: meta.demo, ownerId: meta.ownerId, ownerName: owner?.name ?? meta.ownerId,
    brief: meta.brief, productUrl: meta.productUrl, imageUrl: meta.imageUrl,
    goalCount: c.goalCount, budgetCents: c.budgetCents, maxCacCents: c.maxCacCents, startPriceCents: c.startPriceCents,
    currentPriceCents: c.currentPriceCents, createdAt: c.createdAt, deadline: c.deadline,
    signUps: {verified: n.verified, pending: n.pending, rejected: n.rejected, unfunded: n.unfunded},
    committedCents: committedCents(book),
    liveCacCents: results ? results.averageCents : (n.verified + n.pending ? Math.round(committedCents(book) / (n.verified + n.pending)) : null),
    priceHistory: book.priceHistory.map(p => ({at: p.at, fromCents: p.fromCents, toCents: p.toCents})),
    refusedProposals: book.rejections.length,
    creators: [...joined, ...askingRows, ...declinedRows], joinedCount: joined.length, declinedCount: declinedRows.length, askingCount: askingRows.length,
    results,
    feed: recent.map(e => ({
      sequence: e.sequence, kind: e.kind, tone: toneOf(e.kind), actor: e.actor,
      simulated: handles.get(e.actor)?.demo ?? profiles.get(e.actor)?.demo ?? false, summary: e.summary, at: e.createdAt,
    })),
    lastSequence: recent.at(-1)?.sequence ?? 0,
  };
}

export interface CampaignListItem {
  id: string;
  title: string;
  status: 'open' | 'closed';
  demo: boolean;
  ownerName: string;
  imageUrl: string;
  goalCount: number;
  verified: number;
  signUps: number;
  currentPriceCents: number;
  maxCacCents: number;
  budgetCents: number;
  committedCents: number;
  /** What settlement paid; null while the campaign is open. */
  paidCents: number | null;
  creatorsJoined: number;
  createdAt: number;
  deadline: number;
}

export async function campaignList(store: CampaignStore, options: {status?: 'open' | 'closed'; q?: string; limit?: number} = {}): Promise<CampaignListItem[]> {
  const q = options.q?.trim().toLowerCase();
  const rows = (await store.list({status: options.status, limit: options.limit ?? 50})).filter(r => !q || r.title.toLowerCase().includes(q));
  const out: CampaignListItem[] = [];
  for (const r of rows) {
    const s = await store.load(r.id);
    if (!s) continue;
    const n = counts(s.book);
    const owner = await store.db.prepare('SELECT name FROM users WHERE id=?').bind(r.ownerId).first<{name: string}>();
    out.push({
      id: r.id, title: r.title, status: s.book.campaign.status, demo: r.demo, ownerName: owner?.name ?? r.ownerId, imageUrl: s.meta.imageUrl,
      goalCount: r.goalCount, verified: n.verified, signUps: n.verified + n.pending,
      currentPriceCents: s.book.campaign.currentPriceCents, maxCacCents: r.maxCacCents, budgetCents: r.budgetCents,
      committedCents: committedCents(s.book),
      paidCents: s.book.campaign.status === 'closed' ? (await store.ledger(r.id)).reduce((sum, e) => sum + e.amountCents, 0) : null,
      creatorsJoined: Object.keys(s.links).length, createdAt: r.createdAt, deadline: r.deadline,
    });
  }
  return out;
}

/** "Day 3 · 14:05": time since the campaign started, which reads the same on a live clock and an accelerated one. */
export function campaignClock(at: number, startedAt: number): string {
  const elapsed = Math.max(0, at - startedAt);
  const dayNo = Math.floor(elapsed / DAY_MS) + 1;
  const within = elapsed % DAY_MS;
  const hh = String(Math.floor(within / 3_600_000)).padStart(2, '0');
  const mm = String(Math.floor((within % 3_600_000) / 60_000)).padStart(2, '0');
  return `Day ${dayNo} · ${hh}:${mm}`;
}
