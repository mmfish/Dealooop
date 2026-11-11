// Deterministic campaign core: budget, conversions, pricing and settlement.
//
// This module is the only place that decides money. Agents never call these
// functions with authority of their own: they submit proposals through
// applyAgentProposal(), which validates them and records a rejection reason
// when they fail. All amounts are integer cents. Functions are pure: they take
// a Book and return a new Book, so a failed operation leaves the input intact.
//
// Spec: docs/SPEC.md §4, §6, §8, §9. Invariants: docs/ACCEPTANCE.md A, B, C5.

import {z} from 'zod';

export type Cents = number;

/** Minimum lifetime verified conversions before a creator may negotiate a private deal (SPEC §9, C5). */
export const DEAL_ELIGIBILITY_THRESHOLD = 50;

export type CampaignStatus = 'open' | 'closed';
export type ConversionStatus = 'pending' | 'verified' | 'rejected' | 'unfunded';
export type Channel = 'public' | 'deal';

export interface Campaign {
  id: string;
  goalCount: number;
  budgetCents: Cents;
  maxCacCents: Cents;
  startPriceCents: Cents;
  stepCents: Cents;
  currentPriceCents: Cents;
  deadline: number;
  status: CampaignStatus;
  createdAt: number;
}

export interface Conversion {
  id: string;
  seq: number;
  creatorId: string;
  externalUserId: string;
  status: ConversionStatus;
  channel: Channel;
  /** Fixed price for deal-channel conversions; null for the public channel, which follows the current price. */
  dealPriceCents: Cents | null;
  createdAt: number;
}

export interface Deal {
  creatorId: string;
  priceCents: Cents;
  createdAt: number;
}

export interface PriceChange {
  at: number;
  fromCents: Cents;
  toCents: Cents;
}

export interface Rejection {
  at: number;
  kind: string;
  reason: string;
}

export interface Book {
  campaign: Campaign;
  conversions: Conversion[];
  deals: Record<string, Deal>;
  nextSeq: number;
  priceHistory: PriceChange[];
  rejections: Rejection[];
}

export interface LedgerEntry {
  conversionId: string;
  seq: number;
  creatorId: string;
  channel: Channel;
  amountCents: Cents;
}

export class CoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'CoreError';
  }
}

const isPositiveInt = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;

// ---------------------------------------------------------------------------
// Campaign creation
// ---------------------------------------------------------------------------

export interface CampaignInput {
  id: string;
  goalCount: number;
  budgetCents: Cents;
  maxCacCents: Cents;
  /** Required. A brief without a deadline must be sent back to the founder, never guessed (SPEC §4 step 2). */
  deadline?: number | null;
  now: number;
  /**
   * Optional starting price. Defaults to 30% of max CAC (SPEC §6). Used by the
   * simulator's fixed-price baselines; must be between 1 cent and max CAC.
   */
  startPriceCents?: Cents;
}

export function createCampaign(input: CampaignInput): Book {
  if (!input.id) throw new CoreError('INVALID_ID', 'Campaign id is required.');
  if (!isPositiveInt(input.goalCount)) throw new CoreError('INVALID_GOAL', 'goalCount must be a positive integer.');
  if (!isPositiveInt(input.budgetCents)) throw new CoreError('INVALID_BUDGET', 'budgetCents must be a positive integer.');
  if (!isPositiveInt(input.maxCacCents)) throw new CoreError('INVALID_MAX_CAC', 'maxCacCents must be a positive integer.');
  if (input.maxCacCents > input.budgetCents) throw new CoreError('INVALID_MAX_CAC', 'maxCacCents cannot exceed the budget.');
  if (input.deadline == null) throw new CoreError('MISSING_DEADLINE', 'A deadline is required; ask the founder for one.');
  if (!Number.isSafeInteger(input.deadline) || input.deadline <= input.now) {
    throw new CoreError('INVALID_DEADLINE', 'The deadline must be in the future.');
  }
  if (input.startPriceCents !== undefined && !(isPositiveInt(input.startPriceCents) && input.startPriceCents <= input.maxCacCents)) {
    throw new CoreError('INVALID_START_PRICE', 'startPriceCents must be a positive integer no greater than max CAC.');
  }
  const startPriceCents = input.startPriceCents ?? Math.max(1, Math.round(0.3 * input.maxCacCents));
  const stepCents = Math.max(1, Math.round(0.1 * input.maxCacCents));
  return {
    campaign: {
      id: input.id,
      goalCount: input.goalCount,
      budgetCents: input.budgetCents,
      maxCacCents: input.maxCacCents,
      startPriceCents,
      stepCents,
      currentPriceCents: startPriceCents,
      deadline: input.deadline,
      status: 'open',
      createdAt: input.now,
    },
    conversions: [],
    deals: {},
    nextSeq: 1,
    priceHistory: [],
    rejections: [],
  };
}

// ---------------------------------------------------------------------------
// Budget accounting
// ---------------------------------------------------------------------------

const isActive = (c: Conversion) => c.status === 'pending' || c.status === 'verified';

/** The price a conversion is worth right now: its deal price, or the current public price (retroactive). */
export function unitPrice(book: Book, c: Conversion): Cents {
  return c.channel === 'deal' ? (c.dealPriceCents as Cents) : book.campaign.currentPriceCents;
}

/** Budget held by pending and verified conversions at today's prices (SPEC §8). */
export function committedCents(book: Book): Cents {
  return book.conversions.filter(isActive).reduce((sum, c) => sum + unitPrice(book, c), 0);
}

export function remainingCents(book: Book): Cents {
  return book.campaign.budgetCents - committedCents(book);
}

export interface Counts {
  pending: number;
  verified: number;
  rejected: number;
  unfunded: number;
  publicActive: number;
  dealActive: number;
  dealCommittedCents: Cents;
}

export function counts(book: Book): Counts {
  const out: Counts = {pending: 0, verified: 0, rejected: 0, unfunded: 0, publicActive: 0, dealActive: 0, dealCommittedCents: 0};
  for (const c of book.conversions) {
    out[c.status] += 1;
    if (!isActive(c)) continue;
    if (c.channel === 'deal') {
      out.dealActive += 1;
      out.dealCommittedCents += c.dealPriceCents as Cents;
    } else {
      out.publicActive += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

export interface ConversionInput {
  id: string;
  creatorId: string;
  externalUserId: string;
  now: number;
}

/**
 * Record a conversion arriving through a creator's link. It reserves budget at
 * today's unit price. If the budget cannot cover it, it is recorded as
 * `unfunded` and never paid, so pending conversions can never overdraw the
 * budget (SPEC §8, ACCEPTANCE S6).
 */
export function recordConversion(book: Book, input: ConversionInput): Book {
  const {campaign} = book;
  if (campaign.status !== 'open') throw new CoreError('CAMPAIGN_CLOSED', 'The campaign is closed.');
  if (input.now >= campaign.deadline) throw new CoreError('PAST_DEADLINE', 'The campaign deadline has passed.');
  if (!input.id || !input.creatorId || !input.externalUserId) throw new CoreError('INVALID_CONVERSION', 'id, creatorId and externalUserId are required.');
  if (book.conversions.some(c => c.id === input.id)) throw new CoreError('DUPLICATE_CONVERSION', 'This conversion id is already recorded.');
  if (book.conversions.some(c => c.externalUserId === input.externalUserId)) {
    throw new CoreError('DUPLICATE_USER', 'This user has already converted for this campaign.');
  }
  const deal = book.deals[input.creatorId];
  const channel: Channel = deal ? 'deal' : 'public';
  const price = deal ? deal.priceCents : campaign.currentPriceCents;
  const funded = committedCents(book) + price <= campaign.budgetCents;
  const conversion: Conversion = {
    id: input.id,
    seq: book.nextSeq,
    creatorId: input.creatorId,
    externalUserId: input.externalUserId,
    status: funded ? 'pending' : 'unfunded',
    channel,
    dealPriceCents: deal ? deal.priceCents : null,
    createdAt: input.now,
  };
  return {...book, conversions: [...book.conversions, conversion], nextSeq: book.nextSeq + 1};
}

function transition(book: Book, id: string, to: 'verified' | 'rejected'): Book {
  const index = book.conversions.findIndex(c => c.id === id);
  if (index < 0) throw new CoreError('NOT_FOUND', 'No such conversion.');
  const current = book.conversions[index];
  if (current.status === to) return book; // idempotent retry
  if (current.status !== 'pending') {
    throw new CoreError('INVALID_TRANSITION', `Cannot move a ${current.status} conversion to ${to}.`);
  }
  const conversions = book.conversions.slice();
  conversions[index] = {...current, status: to};
  return {...book, conversions};
}

export const verifyConversion = (book: Book, id: string) => transition(book, id, 'verified');
export const rejectConversion = (book: Book, id: string) => transition(book, id, 'rejected');

// ---------------------------------------------------------------------------
// Pricing (SPEC §6)
// ---------------------------------------------------------------------------

/** Expected final users if the public price were `priceCents`, given an estimate of further public conversions. */
export function projectedFinal(book: Book, priceCents: Cents, additionalPublic: number): number {
  const c = counts(book);
  const publicCapacity = Math.max(0, Math.floor((book.campaign.budgetCents - c.dealCommittedCents) / priceCents));
  return c.dealActive + Math.min(c.publicActive + additionalPublic, publicCapacity);
}

export interface PriceDecision {
  accepted: boolean;
  reason: string;
  fromCents: Cents;
  toCents: Cents;
  projectedAtCurrent: number;
  projectedAtRaised: number;
}

/**
 * Decide a one-step price raise from the agent's supply estimates. The agent
 * only estimates supply; this function makes the decision. Rules:
 *  - the price never exceeds maxCac and never falls (A7);
 *  - raise only if the projected final count strictly improves (B1);
 *  - raise only if every active public conversion, repriced, still fits the budget (B2).
 */
export function decidePriceRaise(book: Book, supplyAtCurrent: number, supplyAtRaised: number): PriceDecision {
  const {campaign} = book;
  const from = campaign.currentPriceCents;
  const to = Math.min(from + campaign.stepCents, campaign.maxCacCents);
  const atCurrent = projectedFinal(book, from, supplyAtCurrent);
  const atRaised = projectedFinal(book, to, supplyAtRaised);
  const base = {fromCents: from, toCents: to, projectedAtCurrent: atCurrent, projectedAtRaised: atRaised};
  if (campaign.status !== 'open') return {...base, accepted: false, reason: 'The campaign is closed.'};
  if (from >= campaign.maxCacCents) return {...base, toCents: from, accepted: false, reason: 'The price is already at the maximum CAC.'};
  const c = counts(book);
  // B2. Mathematically the B1 check below already implies this (an over-budget
  // reprice caps projectedAtRaised below the current active count), so mutation
  // tests cannot fail on it alone. It stays as an explicit, readable guard.
  if (c.publicActive * to + c.dealCommittedCents > campaign.budgetCents) {
    return {...base, accepted: false, reason: 'Repricing existing conversions at the higher price would exceed the budget.'};
  }
  if (atRaised <= atCurrent) {
    return {...base, accepted: false, reason: 'A higher price is not expected to bring more users in total.'};
  }
  return {...base, accepted: true, reason: 'A higher price is expected to bring more users within budget.'};
}

function raisePrice(book: Book, toCents: Cents, now: number): Book {
  return {
    ...book,
    campaign: {...book.campaign, currentPriceCents: toCents},
    priceHistory: [...book.priceHistory, {at: now, fromCents: book.campaign.currentPriceCents, toCents}],
  };
}

// ---------------------------------------------------------------------------
// Private deals (SPEC §9)
// ---------------------------------------------------------------------------

export interface DealInput {
  creatorId: string;
  priceCents: Cents;
  /** Creator's lifetime verified conversions on the platform, supplied by the caller. */
  creatorVerifiedTotal: number;
  now: number;
}

function dealProblem(book: Book, input: DealInput): string | null {
  if (book.campaign.status !== 'open') return 'The campaign is closed.';
  if (!input.creatorId) return 'creatorId is required.';
  if (!isPositiveInt(input.priceCents)) return 'The deal price must be a positive integer number of cents.';
  if (input.priceCents > book.campaign.maxCacCents) return 'The deal price exceeds the maximum CAC.';
  if (!(Number.isSafeInteger(input.creatorVerifiedTotal) && input.creatorVerifiedTotal >= DEAL_ELIGIBILITY_THRESHOLD)) {
    return `Private deals need at least ${DEAL_ELIGIBILITY_THRESHOLD} verified conversions.`;
  }
  if (book.deals[input.creatorId]) return 'This creator already has a deal for this campaign.';
  return null;
}

/** Fix a creator's price for conversions recorded from now on. Earlier conversions keep their channel. */
export function createDeal(book: Book, input: DealInput): Book {
  const problem = dealProblem(book, input);
  if (problem) throw new CoreError('INVALID_DEAL', problem);
  return {...book, deals: {...book.deals, [input.creatorId]: {creatorId: input.creatorId, priceCents: input.priceCents, createdAt: input.now}}};
}

// ---------------------------------------------------------------------------
// Agent proposals (A9): the only door agents have into the core
// ---------------------------------------------------------------------------

const proposalSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('raise_price'),
    supplyAtCurrent: z.number().int().min(0).max(1_000_000),
    supplyAtRaised: z.number().int().min(0).max(1_000_000),
    rationale: z.string().max(2000).optional(),
  }).strict(),
  z.object({
    kind: z.literal('create_deal'),
    creatorId: z.string().min(1).max(200),
    priceCents: z.number().int().positive(),
    creatorVerifiedTotal: z.number().int().min(0),
  }).strict(),
]);

export type AgentProposal = z.infer<typeof proposalSchema>;

export interface ProposalResult {
  book: Book;
  accepted: boolean;
  reason: string;
  decision?: PriceDecision;
}

function reject(book: Book, kind: string, reason: string, now: number): ProposalResult {
  return {book: {...book, rejections: [...book.rejections, {at: now, kind, reason}]}, accepted: false, reason};
}

/**
 * Validate and apply an untrusted agent proposal. Anything malformed, unknown
 * or outside the rules is rejected with a recorded reason and no change to the
 * campaign, conversions, deals or price (A9).
 */
export function applyAgentProposal(book: Book, input: unknown, now: number): ProposalResult {
  const parsed = proposalSchema.safeParse(input);
  const kind = typeof (input as {kind?: unknown})?.kind === 'string' ? String((input as {kind: string}).kind).slice(0, 60) : 'unknown';
  if (!parsed.success) return reject(book, kind, 'The proposal is malformed or not an allowed action.', now);
  const proposal = parsed.data;
  if (proposal.kind === 'raise_price') {
    const decision = decidePriceRaise(book, proposal.supplyAtCurrent, proposal.supplyAtRaised);
    if (!decision.accepted) return {...reject(book, proposal.kind, decision.reason, now), decision};
    return {book: raisePrice(book, decision.toCents, now), accepted: true, reason: decision.reason, decision};
  }
  const problem = dealProblem(book, {...proposal, now});
  if (problem) return reject(book, proposal.kind, problem, now);
  return {book: createDeal(book, {...proposal, now}), accepted: true, reason: 'Deal recorded.'};
}

// ---------------------------------------------------------------------------
// Close and settle
// ---------------------------------------------------------------------------

export function closeCampaign(book: Book): Book {
  if (book.campaign.status === 'closed') return book;
  return {...book, campaign: {...book.campaign, status: 'closed'}};
}

/**
 * Payouts for every verified conversion, in arrival order, at the final
 * public price or the creator's deal price. Pure: settling twice gives the
 * same entries, so a retry can never pay twice (A5).
 */
export function settle(book: Book): LedgerEntry[] {
  return book.conversions
    .filter(c => c.status === 'verified')
    .sort((a, b) => a.seq - b.seq)
    .map(c => ({conversionId: c.id, seq: c.seq, creatorId: c.creatorId, channel: c.channel, amountCents: unitPrice(book, c)}));
}
