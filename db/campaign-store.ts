// Persistence for the campaign core (SPEC §5, §7).
//
// The store never decides money. Every change follows one path: load the
// campaign's Book, run a pure function from core/campaign.ts on it, and write
// the difference back in one atomic batch. The batch starts by claiming the
// next version in campaign_commits, so two writers that loaded the same version
// cannot both commit; the loser reloads and retries on fresh data.
//
// Works on anything D1-shaped: Cloudflare D1, or runtime/sqlite.ts locally.

import {
  applyAgentProposal, closeCampaign, createCampaign as coreCreateCampaign, recordConversion as coreRecordConversion,
  rejectConversion as coreReject, settle, verifyConversion as coreVerify,
  type Book, type Conversion, type Deal, type LedgerEntry, type ProposalResult,
} from '../core/campaign.ts';
import {
  NegotiationError, openNegotiation as coreOpenNegotiation, settleNegotiation, step,
  type CreatorMandate, type FounderMandate, type Mandates, type Negotiation, type Side, type StepResult,
} from '../core/negotiation.ts';

export interface CampaignMeta {
  ownerId: string;
  title: string;
  brief: string;
  productUrl: string;
  /** Cover image for the campaign page: an http(s) URL or a path on this site; empty for none. */
  imageUrl: string;
  demo: boolean;
  version: number;
}

export interface StoredCampaign {
  book: Book;
  meta: CampaignMeta;
  /** creatorId → link id, for every creator who has joined. */
  links: Record<string, string>;
}

export interface EventInput {
  kind: string;
  actor: string;
  summary: string;
  data?: Record<string, unknown>;
}

export interface CampaignEvent {
  sequence: number;
  campaignId: string;
  kind: string;
  actor: string;
  summary: string;
  data: Record<string, unknown>;
  createdAt: number;
}

export interface CreatorProfile {
  userId: string;
  handle: string;
  platform: string;
  niche: string;
  audience: string;
  followers: number;
  priorVerified: number;
  demo: boolean;
}

export interface CampaignLink {
  id: string;
  campaignId: string;
  creatorId: string;
  token: string;
  createdAt: number;
}

export interface CampaignQuestion {
  id: string;
  campaignId: string;
  creatorId: string;
  question: string;
  status: 'pending' | 'answered';
  answer: string;
  createdAt: number;
  answeredAt: number | null;
}

const toQuestion = (r: Record<string, unknown>): CampaignQuestion => ({
  id: String(r.id), campaignId: String(r.campaign_id), creatorId: String(r.creator_id), question: String(r.question),
  status: String(r.status) as CampaignQuestion['status'], answer: String(r.answer ?? ''), createdAt: Number(r.created_at),
  answeredAt: r.answered_at === null || r.answered_at === undefined ? null : Number(r.answered_at),
});

export interface StoredNegotiation {
  negotiation: Negotiation;
  campaignId: string;
  creatorId: string;
  createdAt: number;
  updatedAt: number;
}

const toNegotiation = (r: Record<string, unknown>): StoredNegotiation => ({
  negotiation: JSON.parse(String(r.state_json)) as Negotiation, campaignId: String(r.campaign_id), creatorId: String(r.creator_id),
  createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
});

export class StoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'StoreError';
  }
}

export interface NewCampaign {
  id?: string;
  ownerId: string;
  ownerName?: string;
  title: string;
  brief: string;
  productUrl: string;
  imageUrl?: string;
  goalCount: number;
  budgetCents: number;
  maxCacCents: number;
  deadline: number | null | undefined;
  now: number;
  demo?: boolean;
}

/** What a mutation returns: the new Book, the feed events it produced, and any value for the caller. */
export interface MutationOutcome<T> {
  book: Book;
  events?: EventInput[];
  result: T;
  /** Rationale stored with each new price change, if any. */
  priceRationale?: string;
  /** Extra statements committed atomically with the change (for example ledger entries). */
  extra?: (db: D1Database) => D1PreparedStatement[];
}

const MAX_ATTEMPTS = 5;

// Writes to one campaign are queued within a process, so local writers do not
// starve each other in retries; the commit guard still protects across processes.
const queues = new WeakMap<object, Map<string, Promise<unknown>>>();
function serialize<T>(db: object, key: string, task: () => Promise<T>): Promise<T> {
  let byKey = queues.get(db);
  if (!byKey) queues.set(db, byKey = new Map());
  const prev = byKey.get(key) ?? Promise.resolve();
  const run = prev.then(task, task);
  const tail = run.catch(() => undefined);
  byKey.set(key, tail);
  void tail.then(() => { if (byKey!.get(key) === tail) byKey!.delete(key); });
  return run;
}
/** An http(s) URL or a site path ("/brand/x.png"); anything else becomes ''. */
export function safeImageUrl(value: string): string {
  const v = value.trim().slice(0, 500);
  if (/^\/(?!\/)[\w\-./%]*$/.test(v)) return v;
  try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : ''; } catch { return ''; }
}

const dollars = (c: number) => '$' + (c / 100).toFixed(2);
const newId = (prefix: string) => `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '')}`;
const isVersionConflict = (e: unknown) => /campaign_commits|campaign_commit_version/.test(String((e as Error)?.message ?? e));

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v);
const str = (v: unknown) => String(v);

export class CampaignStore {
  constructor(readonly db: D1Database) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async load(id: string): Promise<StoredCampaign | null> {
    const row = await this.db.prepare('SELECT * FROM campaigns WHERE id=?').bind(id).first<Row>();
    if (!row) return null;
    const [convs, deals, prices, rejections, links] = await Promise.all([
      this.all('SELECT * FROM conversions WHERE campaign_id=? ORDER BY seq', id),
      this.all('SELECT * FROM campaign_deals WHERE campaign_id=?', id),
      this.all('SELECT * FROM price_changes WHERE campaign_id=? ORDER BY sequence', id),
      this.all('SELECT * FROM proposal_rejections WHERE campaign_id=? ORDER BY sequence', id),
      this.all('SELECT id, creator_id FROM campaign_links WHERE campaign_id=?', id),
    ]);
    const book: Book = {
      campaign: {
        id: str(row.id),
        goalCount: num(row.goal_count),
        budgetCents: num(row.budget_cents),
        maxCacCents: num(row.max_cac_cents),
        startPriceCents: num(row.start_price_cents),
        stepCents: num(row.step_cents),
        currentPriceCents: num(row.current_price_cents),
        deadline: num(row.deadline),
        status: str(row.status) as Book['campaign']['status'],
        createdAt: num(row.created_at),
      },
      conversions: convs.map((c): Conversion => ({
        id: str(c.id),
        seq: num(c.seq),
        creatorId: str(c.creator_id),
        externalUserId: str(c.external_user_id),
        status: str(c.status) as Conversion['status'],
        channel: str(c.channel) as Conversion['channel'],
        dealPriceCents: c.deal_price_cents == null ? null : num(c.deal_price_cents),
        createdAt: num(c.created_at),
      })),
      deals: Object.fromEntries(deals.map(d => [str(d.creator_id), {
        creatorId: str(d.creator_id), priceCents: num(d.price_cents), volumeCap: num(d.volume_cap), createdAt: num(d.created_at),
      } satisfies Deal])),
      nextSeq: num(row.next_seq),
      priceHistory: prices.map(p => ({at: num(p.created_at), fromCents: num(p.from_cents), toCents: num(p.to_cents)})),
      rejections: rejections.map(r => ({at: num(r.created_at), kind: str(r.kind), reason: str(r.reason)})),
    };
    return {
      book,
      meta: {ownerId: str(row.owner_id), title: str(row.title), brief: str(row.brief), productUrl: str(row.product_url), imageUrl: str(row.image_url ?? ''), demo: num(row.demo) === 1, version: num(row.version)},
      links: Object.fromEntries(links.map(l => [str(l.creator_id), str(l.id)])),
    };
  }

  async require(id: string): Promise<StoredCampaign> {
    const s = await this.load(id);
    if (!s) throw new StoreError('NOT_FOUND', 'No such campaign.');
    return s;
  }

  async list(options: {status?: 'open' | 'closed'; limit?: number} = {}) {
    const limit = Math.min(Math.max(1, options.limit ?? 50), 200);
    const rows = options.status
      ? await this.all('SELECT * FROM campaigns WHERE status=? ORDER BY created_at DESC LIMIT ?', options.status, limit)
      : await this.all('SELECT * FROM campaigns ORDER BY created_at DESC LIMIT ?', limit);
    return rows.map(r => ({
      id: str(r.id), title: str(r.title), ownerId: str(r.owner_id), status: str(r.status),
      goalCount: num(r.goal_count), budgetCents: num(r.budget_cents), maxCacCents: num(r.max_cac_cents),
      currentPriceCents: num(r.current_price_cents), deadline: num(r.deadline), imageUrl: str(r.image_url ?? ''), demo: num(r.demo) === 1, createdAt: num(r.created_at),
    }));
  }

  async events(campaignId: string, afterSequence = 0, limit = 200): Promise<CampaignEvent[]> {
    const rows = await this.all('SELECT * FROM campaign_events WHERE campaign_id=? AND sequence>? ORDER BY sequence LIMIT ?', campaignId, afterSequence, Math.min(Math.max(1, limit), 1000));
    return rows.map(r => ({
      sequence: num(r.sequence), campaignId: str(r.campaign_id), kind: str(r.kind), actor: str(r.actor),
      summary: str(r.summary), data: JSON.parse(str(r.data_json)) as Record<string, unknown>, createdAt: num(r.created_at),
    }));
  }

  /** The newest events, oldest first. */
  async recentEvents(campaignId: string, limit = 200): Promise<CampaignEvent[]> {
    const rows = await this.all('SELECT * FROM (SELECT * FROM campaign_events WHERE campaign_id=? ORDER BY sequence DESC LIMIT ?) ORDER BY sequence', campaignId, Math.min(Math.max(1, limit), 1000));
    return rows.map(r => ({
      sequence: num(r.sequence), campaignId: str(r.campaign_id), kind: str(r.kind), actor: str(r.actor),
      summary: str(r.summary), data: JSON.parse(str(r.data_json)) as Record<string, unknown>, createdAt: num(r.created_at),
    }));
  }

  /** The newest event's sequence, for one campaign or across all of them; 0 when there are none. */
  async latestSequence(campaignId?: string): Promise<number> {
    const r = campaignId
      ? await this.db.prepare('SELECT COALESCE(MAX(sequence),0) AS s FROM campaign_events WHERE campaign_id=?').bind(campaignId).first<{s: number}>()
      : await this.db.prepare('SELECT COALESCE(MAX(sequence),0) AS s FROM campaign_events').first<{s: number}>();
    return num(r?.s ?? 0);
  }

  async ledger(campaignId: string): Promise<LedgerEntry[]> {
    const rows = await this.all('SELECT * FROM ledger_entries WHERE campaign_id=? ORDER BY seq', campaignId);
    return rows.map(r => ({conversionId: str(r.conversion_id), seq: num(r.seq), creatorId: str(r.creator_id), channel: str(r.channel) as LedgerEntry['channel'], amountCents: num(r.amount_cents)}));
  }

  async link(campaignId: string, creatorId: string): Promise<CampaignLink | null> {
    const r = await this.db.prepare('SELECT * FROM campaign_links WHERE campaign_id=? AND creator_id=?').bind(campaignId, creatorId).first<Row>();
    return r ? toLink(r) : null;
  }

  async linkByToken(token: string): Promise<CampaignLink | null> {
    const r = await this.db.prepare('SELECT * FROM campaign_links WHERE token=?').bind(token).first<Row>();
    return r ? toLink(r) : null;
  }

  async creator(userId: string): Promise<CreatorProfile | null> {
    const r = await this.db.prepare('SELECT * FROM creator_profiles WHERE user_id=?').bind(userId).first<Row>();
    return r ? toProfile(r) : null;
  }

  async creators(): Promise<CreatorProfile[]> {
    return (await this.all('SELECT * FROM creator_profiles ORDER BY handle')).map(toProfile);
  }

  /** Lifetime verified conversions: the seeded track record plus every verified conversion on this platform (C5). */
  async creatorVerifiedTotal(userId: string): Promise<number> {
    const r = await this.db.prepare(
      "SELECT COALESCE((SELECT prior_verified FROM creator_profiles WHERE user_id=?),0) + (SELECT COUNT(*) FROM conversions WHERE creator_id=? AND status='verified') AS total",
    ).bind(userId, userId).first<{total: number}>();
    return num(r?.total ?? 0);
  }

  // -------------------------------------------------------------------------
  // The platform clock. Real time plus a stored offset, so a demo can run the
  // platform ahead (sim/campaign-days.ts) and every process reading this
  // database, the pages and both owners' MCP servers, sees the same time.
  // -------------------------------------------------------------------------

  async now(): Promise<number> {
    const r = await this.db.prepare('SELECT offset_ms FROM platform_clock WHERE id=1').first<{offset_ms: number}>();
    return Date.now() + num(r?.offset_ms ?? 0);
  }

  /** Moves the platform's time to `at`. The clock never goes back unless `allowBack` (a demo reset). */
  async setClock(at: number, allowBack = false): Promise<void> {
    const current = await this.now();
    if (at < current && !allowBack) return;
    const real = Date.now();
    await this.db.prepare('INSERT INTO platform_clock(id,offset_ms,updated_at) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET offset_ms=excluded.offset_ms, updated_at=excluded.updated_at')
      .bind(Math.round(at - real), real).run();
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  async ensureUser(id: string, name: string, now: number) {
    await this.db.prepare('INSERT INTO users(id,name,created_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').bind(id, name, now).run();
  }

  /** Validates through the core (a missing deadline throws MISSING_DEADLINE) and posts the campaign. */
  async createCampaign(input: NewCampaign): Promise<StoredCampaign> {
    const id = input.id ?? newId('cmp');
    const book = coreCreateCampaign({id, goalCount: input.goalCount, budgetCents: input.budgetCents, maxCacCents: input.maxCacCents, deadline: input.deadline, now: input.now});
    const c = book.campaign;
    const title = input.title.trim().slice(0, 200) || 'Untitled campaign';
    await this.db.batch([
      this.db.prepare('INSERT INTO users(id,name,created_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').bind(input.ownerId, input.ownerName ?? input.ownerId, input.now),
      this.db.prepare(`INSERT INTO campaigns(id,owner_id,title,brief,product_url,image_url,goal_count,budget_cents,max_cac_cents,start_price_cents,step_cents,current_price_cents,deadline,status,next_seq,version,demo,created_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`)
        .bind(id, input.ownerId, title, input.brief.slice(0, 4000), input.productUrl.slice(0, 500), safeImageUrl(input.imageUrl ?? ''), c.goalCount, c.budgetCents, c.maxCacCents, c.startPriceCents, c.stepCents, c.currentPriceCents, c.deadline, c.status, book.nextSeq, input.demo ? 1 : 0, input.now),
      this.eventStatement(id, {
        kind: 'campaign.posted', actor: 'founder-agent',
        summary: `${title}: ${c.goalCount} sign-ups wanted, budget ${dollars(c.budgetCents)}, up to ${dollars(c.maxCacCents)} each. Starting price ${dollars(c.startPriceCents)}.`,
        data: {goalCount: c.goalCount, budgetCents: c.budgetCents, maxCacCents: c.maxCacCents, startPriceCents: c.startPriceCents, deadline: c.deadline},
      }, input.now),
    ]);
    return this.require(id);
  }

  // -------------------------------------------------------------------------
  // Questions from creators (DEMO-FLOW beat 4). No money moves here: a
  // question pauses one creator's join until the founder answers in their
  // own words; the answer becomes the wording that creator may use.
  // -------------------------------------------------------------------------

  async askQuestion(campaignId: string, creatorId: string, question: string, now: number): Promise<CampaignQuestion> {
    const {book} = await this.require(campaignId);
    if (book.campaign.status !== 'open' || now >= book.campaign.deadline) throw new StoreError('CAMPAIGN_CLOSED', 'The campaign is not accepting creators.');
    const profile = await this.creator(creatorId);
    if (!profile) throw new StoreError('NO_PROFILE', 'Only creators with a profile can ask.');
    const text = question.trim().slice(0, 600);
    if (!text) throw new StoreError('INVALID_MUTATION', 'The question is empty.');
    const open = (await this.questions(campaignId, 'pending')).find(q => q.creatorId === creatorId);
    if (open) return open;
    const q: CampaignQuestion = {id: newId('q'), campaignId, creatorId, question: text, status: 'pending', answer: '', createdAt: now, answeredAt: null};
    await this.db.batch([
      this.db.prepare('INSERT INTO campaign_questions(id,campaign_id,creator_id,question,status,answer,created_at) VALUES(?,?,?,?,?,?,?)').bind(q.id, campaignId, creatorId, text, 'pending', '', now),
      this.eventStatement(campaignId, {kind: 'clarification.asked', actor: profile.handle, summary: `${profile.handle} asked the founder: “${text}”`, data: {creatorId, questionId: q.id}}, now),
    ]);
    return q;
  }

  async questions(campaignId: string, status?: 'pending' | 'answered'): Promise<CampaignQuestion[]> {
    const rows = status
      ? await this.all('SELECT * FROM campaign_questions WHERE campaign_id=? AND status=? ORDER BY created_at', campaignId, status)
      : await this.all('SELECT * FROM campaign_questions WHERE campaign_id=? ORDER BY created_at', campaignId);
    return rows.map(toQuestion);
  }

  async question(id: string): Promise<CampaignQuestion | null> {
    const r = await this.db.prepare('SELECT * FROM campaign_questions WHERE id=?').bind(id).first<Row>();
    return r ? toQuestion(r) : null;
  }

  /** Records the founder's answer, then the creator joins with it as their approved wording. Answering twice is refused. */
  async answerQuestion(id: string, answer: string, now: number): Promise<{question: CampaignQuestion; link: CampaignLink}> {
    const q = await this.question(id);
    if (!q) throw new StoreError('NOT_FOUND', 'No such question.');
    if (q.status !== 'pending') throw new StoreError('CONFLICT', 'This question has already been answered.');
    const text = answer.trim().slice(0, 600);
    if (!text) throw new StoreError('INVALID_MUTATION', 'The answer is empty.');
    const handle = (await this.creator(q.creatorId))?.handle ?? q.creatorId;
    // The conditional update is the claim: of two racing answers, only one changes a row.
    const update = await this.db.prepare("UPDATE campaign_questions SET status='answered', answer=?, answered_at=? WHERE id=? AND status='pending'").bind(text, now, id).run();
    if (!update.meta.changes) throw new StoreError('CONFLICT', 'This question has already been answered.');
    await this.addEvent(q.campaignId, {kind: 'clarification.answered', actor: 'founder', summary: `The founder answered ${handle}: “${text}”`, data: {creatorId: q.creatorId, questionId: id}}, now);
    const link = await this.join(q.campaignId, q.creatorId, now, `using the founder's wording: “${text}”`);
    return {question: {...q, status: 'answered', answer: text, answeredAt: now}, link};
  }

  // -------------------------------------------------------------------------
  // Private negotiations (DEMO-FLOW beat 6). core/negotiation.ts judges every
  // move. Each side's private limit is passed in by that side's own agent for
  // the move it is making and is never stored, so the platform cannot show it
  // to the other side. Only an agreement touches the campaign, as a Deal.
  // -------------------------------------------------------------------------

  /** A creator opens a negotiation; the creator moves first. An open one for the same creator is returned as is. */
  async openNegotiation(campaignId: string, creatorId: string, now: number): Promise<StoredNegotiation> {
    const {book} = await this.require(campaignId);
    const profile = await this.creator(creatorId);
    if (!profile) throw new StoreError('NO_PROFILE', 'Only creators with a profile can negotiate.');
    const open = (await this.negotiations(campaignId, 'open')).find(n => n.creatorId === creatorId);
    if (open) return open;
    let n: Negotiation;
    try {
      n = coreOpenNegotiation(book, {id: newId('neg'), creatorId, creatorVerifiedTotal: await this.creatorVerifiedTotal(creatorId)});
    } catch (e) {
      if (e instanceof NegotiationError) throw new StoreError(e.code, e.message);
      throw e;
    }
    await this.db.batch([
      this.db.prepare('INSERT INTO campaign_negotiations(id,campaign_id,creator_id,status,state_json,turns,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
        .bind(n.id, campaignId, creatorId, 'open', JSON.stringify(n), 0, now, now),
      this.eventStatement(campaignId, {kind: 'deal.negotiation_opened', actor: profile.handle, summary: `${profile.handle} opened a private deal negotiation with the founder.`, data: {creatorId, negotiationId: n.id}}, now),
    ]);
    return {negotiation: n, campaignId, creatorId, createdAt: now, updatedAt: now};
  }

  async negotiation(id: string): Promise<StoredNegotiation | null> {
    const r = await this.db.prepare('SELECT * FROM campaign_negotiations WHERE id=?').bind(id).first<Row>();
    return r ? toNegotiation(r) : null;
  }

  async negotiations(campaignId: string, status?: Negotiation['status']): Promise<StoredNegotiation[]> {
    const rows = status
      ? await this.all('SELECT * FROM campaign_negotiations WHERE campaign_id=? AND status=? ORDER BY created_at', campaignId, status)
      : await this.all('SELECT * FROM campaign_negotiations WHERE campaign_id=? ORDER BY created_at', campaignId);
    return rows.map(toNegotiation);
  }

  /**
   * One move by `side`, judged by the core against that side's own limit. A refused
   * move changes nothing. An agreement records the Deal and the negotiation in one
   * step: the negotiation row is claimed first, and released again if the core
   * refuses the deal.
   */
  async negotiationMove(id: string, side: Side, move: unknown, own: CreatorMandate | FounderMandate, now: number): Promise<StepResult> {
    const stored = await this.negotiation(id);
    if (!stored) throw new StoreError('NOT_FOUND', 'No such negotiation.');
    const before = stored.negotiation;
    const {book} = await this.require(stored.campaignId);
    // The other side's limit is not known here and not needed: the core checks only the mover's own.
    const mandates: Mandates = side === 'creator'
      ? {creator: own as CreatorMandate, founder: {maxPriceCents: Number.MAX_SAFE_INTEGER, maxVolume: Number.MAX_SAFE_INTEGER}}
      : {creator: {minPriceCents: 0}, founder: own as FounderMandate};
    const r = step(book, before, side, move, mandates, now);
    if (!r.ok) return r;
    const n = r.negotiation;
    const claim = await this.db.prepare('UPDATE campaign_negotiations SET status=?, state_json=?, turns=?, updated_at=? WHERE id=? AND turns=?')
      .bind(n.status, JSON.stringify(n), n.history.length, now, id, before.history.length).run();
    if (!claim.meta.changes) throw new StoreError('CONFLICT', 'The negotiation changed in the meantime; read it again.');
    const handle = (await this.creator(stored.creatorId))?.handle ?? stored.creatorId;
    if (n.status === 'failed') {
      await this.addEvent(stored.campaignId, {kind: 'deal.negotiation_ended', actor: side === 'creator' ? handle : 'founder', summary: `No private deal with ${handle}; they stay on the public price.`, data: {creatorId: stored.creatorId, negotiationId: id}}, now);
    } else if (n.status === 'agreed' && n.agreed) {
      const terms = n.agreed;
      try {
        await this.mutate(stored.campaignId, s => ({
          book: settleNegotiation(s.book, n, now), result: undefined,
          events: [{kind: 'deal.created', actor: side === 'creator' ? handle : 'founder', summary: `Private deal: at least ${dollars(terms.priceCents)} per sign-up for ${handle}'s next ${terms.volumeCap}. The public price stays ${dollars(s.book.campaign.currentPriceCents)}.`, data: {creatorId: stored.creatorId, negotiationId: id, priceCents: terms.priceCents, volumeCap: terms.volumeCap}}],
        }), now, side === 'creator' ? handle : 'founder');
      } catch (e) {
        await this.db.prepare('UPDATE campaign_negotiations SET status=?, state_json=?, turns=?, updated_at=? WHERE id=?')
          .bind(before.status, JSON.stringify(before), before.history.length, now, id).run();
        throw e;
      }
      // A deal only pays through a tracked link, so the creator joins if they have not yet.
      await this.join(stored.campaignId, stored.creatorId, now, 'private deal agreed').catch(() => undefined);
    }
    return r;
  }

  /** Metadata only (no money), so it is not a Book mutation. */
  async setImage(campaignId: string, imageUrl: string) {
    const url = safeImageUrl(imageUrl);
    if (imageUrl && !url) throw new StoreError('INVALID_MUTATION', 'The image must be an http(s) URL or a path on this site.');
    const r = await this.db.prepare('UPDATE campaigns SET image_url=? WHERE id=?').bind(url, campaignId).run();
    if (!r.meta.changes) throw new StoreError('NOT_FOUND', 'No such campaign.');
  }

  async upsertCreator(p: CreatorProfile & {name?: string; now: number}) {
    await this.db.batch([
      this.db.prepare('INSERT INTO users(id,name,created_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').bind(p.userId, p.name ?? p.handle, p.now),
      this.db.prepare(`INSERT INTO creator_profiles(user_id,handle,platform,niche,audience,followers,prior_verified,demo,created_at) VALUES(?,?,?,?,?,?,?,?,?)
                       ON CONFLICT(user_id) DO UPDATE SET handle=excluded.handle,platform=excluded.platform,niche=excluded.niche,audience=excluded.audience,followers=excluded.followers,prior_verified=excluded.prior_verified,demo=excluded.demo`)
        .bind(p.userId, p.handle, p.platform, p.niche, p.audience, p.followers, p.priorVerified, p.demo ? 1 : 0, p.now),
    ]);
  }

  /** A creator joins and gets a tracked link. Joining twice returns the same link. */
  async join(campaignId: string, creatorId: string, now: number, note?: string): Promise<CampaignLink> {
    const existing = await this.link(campaignId, creatorId);
    if (existing) return existing;
    const {book} = await this.require(campaignId);
    if (book.campaign.status !== 'open' || now >= book.campaign.deadline) throw new StoreError('CAMPAIGN_CLOSED', 'The campaign is not accepting creators.');
    const profile = await this.creator(creatorId);
    if (!profile) throw new StoreError('NO_PROFILE', 'Only creators with a profile can join.');
    const link: CampaignLink = {id: newId('lnk'), campaignId, creatorId, token: newId('t'), createdAt: now};
    try {
      await this.db.batch([
        this.db.prepare('INSERT INTO campaign_links(id,campaign_id,creator_id,token,created_at) VALUES(?,?,?,?,?)').bind(link.id, campaignId, creatorId, link.token, now),
        this.eventStatement(campaignId, {kind: 'creator.joined', actor: profile.handle, summary: `${profile.handle} joined${note ? `: ${note}` : '.'}`, data: {creatorId, ...(note ? {note} : {})}}, now),
      ]);
    } catch (e) {
      const raced = await this.link(campaignId, creatorId);
      if (raced) return raced;
      throw e;
    }
    return link;
  }

  async decline(campaignId: string, creatorId: string, reason: string, now: number) {
    const profile = await this.creator(creatorId);
    await this.require(campaignId);
    const handle = profile?.handle ?? creatorId;
    await this.addEvent(campaignId, {kind: 'creator.declined', actor: handle, summary: `${handle} declined: ${reason}`, data: {creatorId, reason}}, now);
  }

  async addEvent(campaignId: string, event: EventInput, now: number) {
    await this.eventStatement(campaignId, event, now).run();
  }

  /** A sign-up through a tracked link. Unfunded conversions are recorded but never paid (S6). */
  async recordConversion(token: string, externalUserId: string, now: number): Promise<Conversion> {
    const link = await this.linkByToken(token);
    if (!link) throw new StoreError('UNKNOWN_LINK', 'No such tracked link.');
    const id = newId('cnv');
    const handle = (await this.creator(link.creatorId))?.handle ?? link.creatorId;
    return this.mutate(link.campaignId, ({book}) => {
      const next = coreRecordConversion(book, {id, creatorId: link.creatorId, externalUserId, now});
      const c = next.conversions[next.conversions.length - 1];
      return {
        book: next, result: c,
        events: [{kind: c.status === 'unfunded' ? 'conversion.unfunded' : 'conversion.recorded', actor: 'platform',
          summary: c.status === 'unfunded' ? 'A sign-up arrived after the budget was fully committed; it will not be paid.' : `Sign-up #${c.seq} via ${handle}${c.channel === 'deal' ? ' (deal)' : ''}.`,
          data: {conversionId: c.id, creatorId: c.creatorId, seq: c.seq, status: c.status, channel: c.channel}}],
      };
    }, now);
  }

  async verifyConversion(campaignId: string, conversionId: string, now: number) {
    return this.mutate(campaignId, ({book}) => ({book: coreVerify(book, conversionId), result: undefined}), now);
  }

  async rejectConversion(campaignId: string, conversionId: string, now: number) {
    return this.mutate(campaignId, ({book}) => ({
      book: coreReject(book, conversionId), result: undefined,
      events: [{kind: 'conversion.rejected', actor: 'platform', summary: 'A sign-up failed verification; its budget was released.', data: {conversionId}}],
    }), now);
  }

  /**
   * An agent proposal, validated by the core. For a deal, the creator's track
   * record comes from the database, never from the proposal.
   */
  async applyProposal(campaignId: string, proposal: unknown, now: number, actor: string): Promise<ProposalResult> {
    let input = proposal;
    let dealHandle: string | undefined;
    const p = proposal as {kind?: unknown; creatorId?: unknown} | null;
    if (p && typeof p === 'object' && p.kind === 'create_deal' && typeof p.creatorId === 'string') {
      input = {...p, creatorVerifiedTotal: await this.creatorVerifiedTotal(p.creatorId)};
      dealHandle = (await this.creator(p.creatorId))?.handle;
    }
    const rationale = typeof (proposal as {rationale?: unknown})?.rationale === 'string' ? String((proposal as {rationale: string}).rationale).slice(0, 2000) : undefined;
    return this.mutate(campaignId, ({book}) => {
      const r = applyAgentProposal(book, input, now);
      const events: EventInput[] = [];
      if (!r.accepted) {
        events.push({kind: 'proposal.refused', actor, summary: `Refused: ${r.reason}`, data: {proposalKind: r.book.rejections.at(-1)?.kind ?? 'unknown', reason: r.reason}});
      } else if (r.decision) {
        events.push({kind: 'price.raised', actor, summary: `Price raised from ${dollars(r.decision.fromCents)} to ${dollars(r.decision.toCents)} for every sign-up, including earlier ones.`, data: {...r.decision, rationale}});
      } else {
        const deal = Object.values(r.book.deals).find(d => !book.deals[d.creatorId]);
        if (deal) events.push({kind: 'deal.created', actor, summary: `Private deal: at least ${dollars(deal.priceCents)} per sign-up for ${dealHandle ?? deal.creatorId}'s next ${deal.volumeCap}.`, data: {...deal}});
      }
      return {book: r.book, events, result: r, priceRationale: rationale};
    }, now, actor);
  }

  /** Close the campaign and write its payouts. Idempotent: a second call writes nothing and returns the same ledger (A5). */
  async closeAndSettle(campaignId: string, now: number): Promise<LedgerEntry[]> {
    const stored = await this.require(campaignId);
    if (stored.book.campaign.status === 'closed') return this.ledger(campaignId);
    await this.mutate(campaignId, ({book}) => {
      const closed = closeCampaign(book);
      const entries = settle(closed);
      const paid = entries.reduce((s, e) => s + e.amountCents, 0);
      return {
        book: closed, result: undefined,
        events: [{kind: 'campaign.settled', actor: 'platform', summary: `Campaign closed: ${entries.length} verified sign-ups, ${dollars(paid)} paid of ${dollars(book.campaign.budgetCents)}.`, data: {verified: entries.length, paidCents: paid, finalPriceCents: closed.campaign.currentPriceCents}}],
        extra: db => entries.map(e => db.prepare('INSERT INTO ledger_entries(id,campaign_id,conversion_id,creator_id,seq,channel,amount_cents,created_at) VALUES(?,?,?,?,?,?,?,?)')
          .bind(`led_${e.conversionId}`, campaignId, e.conversionId, e.creatorId, e.seq, e.channel, e.amountCents, now)),
      };
    }, now);
    return this.ledger(campaignId);
  }

  /**
   * The one write path for a campaign's Book. `fn` must derive the new Book with
   * core/campaign.ts functions; the store persists exactly the difference.
   */
  mutate<T>(campaignId: string, fn: (s: StoredCampaign) => MutationOutcome<T>, now: number, actor = 'founder-agent'): Promise<T> {
    return serialize(this.db, campaignId, () => this.mutateNow(campaignId, fn, now, actor));
  }

  private async mutateNow<T>(campaignId: string, fn: (s: StoredCampaign) => MutationOutcome<T>, now: number, actor: string): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const before = await this.require(campaignId);
      const out = fn(before);
      try {
        await this.db.batch(this.diff(before, out, now, actor));
        return out.result;
      } catch (e) {
        if (isVersionConflict(e) && attempt < MAX_ATTEMPTS) continue;
        if (isVersionConflict(e)) throw new StoreError('CONFLICT', 'The campaign kept changing; try again.');
        throw e;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private diff<T>(before: StoredCampaign, out: MutationOutcome<T>, now: number, actor: string): D1PreparedStatement[] {
    const db = this.db;
    const a = before.book, b = out.book, id = a.campaign.id;
    if (b.campaign.id !== id) throw new StoreError('INVALID_MUTATION', 'A mutation cannot change the campaign id.');
    for (const k of ['goalCount', 'budgetCents', 'maxCacCents', 'startPriceCents', 'stepCents', 'deadline', 'createdAt'] as const) {
      if (a.campaign[k] !== b.campaign[k]) throw new StoreError('INVALID_MUTATION', `A mutation cannot change ${k}.`);
    }
    const v = before.meta.version;
    // The guard comes first: if another writer already claimed v+1, the batch fails before touching anything.
    const stmts: D1PreparedStatement[] = [
      db.prepare('INSERT INTO campaign_commits(campaign_id,version,created_at) VALUES(?,?,?)').bind(id, v + 1, now),
      db.prepare('UPDATE campaigns SET current_price_cents=?, status=?, next_seq=?, version=? WHERE id=? AND version=?')
        .bind(b.campaign.currentPriceCents, b.campaign.status, b.nextSeq, v + 1, id, v),
    ];

    const old = new Map(a.conversions.map(c => [c.id, c]));
    if (b.conversions.length < a.conversions.length) throw new StoreError('INVALID_MUTATION', 'Conversions are never deleted.');
    for (const c of b.conversions) {
      const prev = old.get(c.id);
      if (!prev) {
        const linkId = before.links[c.creatorId];
        if (!linkId) throw new StoreError('NO_LINK', `Creator ${c.creatorId} has not joined this campaign.`);
        stmts.push(db.prepare('INSERT INTO conversions(id,campaign_id,link_id,creator_id,external_user_id,seq,status,channel,deal_price_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
          .bind(c.id, id, linkId, c.creatorId, c.externalUserId, c.seq, c.status, c.channel, c.dealPriceCents, c.createdAt, now));
        continue;
      }
      if (prev.seq !== c.seq || prev.creatorId !== c.creatorId || prev.externalUserId !== c.externalUserId || prev.channel !== c.channel || prev.dealPriceCents !== c.dealPriceCents) {
        throw new StoreError('INVALID_MUTATION', 'Only a conversion\'s status can change.');
      }
      if (prev.status !== c.status) stmts.push(db.prepare('UPDATE conversions SET status=?, updated_at=? WHERE id=? AND campaign_id=?').bind(c.status, now, c.id, id));
    }

    for (const [creatorId, d] of Object.entries(b.deals)) {
      const prev = a.deals[creatorId];
      if (!prev) {
        stmts.push(db.prepare('INSERT INTO campaign_deals(campaign_id,creator_id,price_cents,volume_cap,created_at) VALUES(?,?,?,?,?)').bind(id, creatorId, d.priceCents, d.volumeCap, d.createdAt));
      } else if (prev.priceCents !== d.priceCents || prev.volumeCap !== d.volumeCap) {
        throw new StoreError('INVALID_MUTATION', 'A deal cannot be changed once recorded.');
      }
    }
    if (Object.keys(a.deals).some(k => !b.deals[k])) throw new StoreError('INVALID_MUTATION', 'Deals are never deleted.');

    if (b.priceHistory.length < a.priceHistory.length) throw new StoreError('INVALID_MUTATION', 'Price history is append-only.');
    for (const p of b.priceHistory.slice(a.priceHistory.length)) {
      stmts.push(db.prepare('INSERT INTO price_changes(campaign_id,from_cents,to_cents,rationale,created_at) VALUES(?,?,?,?,?)').bind(id, p.fromCents, p.toCents, out.priceRationale ?? null, p.at));
    }
    if (b.rejections.length < a.rejections.length) throw new StoreError('INVALID_MUTATION', 'Rejections are append-only.');
    for (const r of b.rejections.slice(a.rejections.length)) {
      stmts.push(db.prepare('INSERT INTO proposal_rejections(campaign_id,actor,kind,reason,created_at) VALUES(?,?,?,?,?)').bind(id, actor, r.kind, r.reason, r.at));
    }
    for (const e of out.events ?? []) stmts.push(this.eventStatement(id, e, now));
    if (out.extra) stmts.push(...out.extra(db));
    return stmts;
  }

  private eventStatement(campaignId: string, e: EventInput, now: number) {
    return this.db.prepare('INSERT INTO campaign_events(campaign_id,kind,actor,summary,data_json,created_at) VALUES(?,?,?,?,?,?)')
      .bind(campaignId, e.kind.slice(0, 60), e.actor.slice(0, 200), e.summary.slice(0, 1000), JSON.stringify(e.data ?? {}), now);
  }

  private async all(sql: string, ...values: (string | number)[]): Promise<Row[]> {
    return (await this.db.prepare(sql).bind(...values).all<Row>()).results;
  }
}

function toLink(r: Row): CampaignLink {
  return {id: str(r.id), campaignId: str(r.campaign_id), creatorId: str(r.creator_id), token: str(r.token), createdAt: num(r.created_at)};
}

function toProfile(r: Row): CreatorProfile {
  return {userId: str(r.user_id), handle: str(r.handle), platform: str(r.platform), niche: str(r.niche), audience: str(r.audience), followers: num(r.followers), priorVerified: num(r.prior_verified), demo: num(r.demo) === 1};
}
