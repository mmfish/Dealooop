// Negotiation between a creator's agent and a founder's agent on a campaign.
//
// Dealoop is the platform, not a party: it keeps the conversation and enforces
// the rules of the market, and nothing about how either agent works with its
// owner. Each agent decides on its own when to look, what to offer, and when
// to ask its owner; the platform never sees an owner's limits or instructions.
//
// Platform rules (docs/ACCEPTANCE.md C1–C4):
//  C1 parties take turns; the creator moves first; every move carries a message,
//     and the whole conversation is kept on the platform
//  C2 a proposal is its author's agreement to those exact terms, and only the
//     other side can accept them; terms must be within the campaign's maximum price
//  C3 an agreement is recorded once, atomically, as a Deal; nothing else changes the campaign
//  C4 a negotiation ends by acceptance or rejection, or at MAX_TURNS (a backstop, not a tactic)

import {z} from 'zod';
import {createDeal, MAX_DEAL_VOLUME, type Book, type Cents} from './campaign.ts';

export type Side = 'creator' | 'founder';

export interface Terms {
  /** Price per verified sign-up for this creator (paid at least the public price anyway). */
  priceCents: Cents;
  /** How many of the creator's sign-ups the price covers. */
  volumeCap: number;
}

/** Most moves in one negotiation. The last allowed move must accept or reject. */
export const MAX_TURNS = 30;

export type Move =
  | {action: 'propose'; terms: Terms; message: string}
  | {action: 'message'; message: string}
  | {action: 'accept'; message: string}
  | {action: 'reject'; message: string};

export interface Turn {
  seq: number;
  round: number;
  side: Side;
  action: Move['action'];
  terms?: Terms;
  message: string;
  at: number;
}

export interface Negotiation {
  id: string;
  campaignId: string;
  creatorId: string;
  /** The creator's verified sign-ups on the platform when it opened: public information for the founder's agent. */
  creatorVerifiedTotal: number;
  status: 'open' | 'agreed' | 'failed';
  turn: Side;
  /** One creator move and the founder's reply make a round. */
  round: number;
  /** Terms currently on the table and who put them there. */
  onTable: Terms | null;
  proposedBy: Side | null;
  history: Turn[];
  agreed: Terms | null;
}

export class NegotiationError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'NegotiationError';
  }
}

export type StepResult = {ok: true; negotiation: Negotiation} | {ok: false; reason: string; negotiation: Negotiation};

const message = z.string().trim().min(1).max(2000);
const moveSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('propose'),
    terms: z.object({priceCents: z.number().int().positive(), volumeCap: z.number().int().min(1).max(MAX_DEAL_VOLUME)}).strict(),
    message,
  }).strict(),
  z.object({action: z.literal('message'), message}).strict(),
  z.object({action: z.literal('accept'), message}).strict(),
  z.object({action: z.literal('reject'), message}).strict(),
]);

/** Open a negotiation for a creator. The creator moves first. */
export function openNegotiation(book: Book, input: {id: string; creatorId: string; creatorVerifiedTotal: number}): Negotiation {
  if (book.campaign.status !== 'open') throw new NegotiationError('CAMPAIGN_CLOSED', 'The campaign is closed.');
  if (book.deals[input.creatorId]) throw new NegotiationError('DEAL_EXISTS', 'This creator already has a deal for this campaign.');
  return {
    id: input.id, campaignId: book.campaign.id, creatorId: input.creatorId, creatorVerifiedTotal: Math.max(0, input.creatorVerifiedTotal | 0),
    status: 'open', turn: 'creator', round: 1, onTable: null, proposedBy: null, history: [], agreed: null,
  };
}

/** May `side` make a move that keeps the negotiation going (propose or message)? */
export function canContinue(n: Negotiation, side: Side): boolean {
  return n.status === 'open' && n.turn === side && n.history.length < MAX_TURNS - 1;
}

/** What `side` may do now. */
export function options(n: Negotiation, side: Side): Move['action'][] {
  if (n.status !== 'open' || n.turn !== side) return [];
  return [
    ...(canContinue(n, side) ? ['propose', 'message'] as const : []),
    ...(n.onTable && n.proposedBy !== side ? ['accept'] as const : []),
    'reject',
  ];
}

/**
 * Apply one move by `side`. An illegal move is refused with a reason and leaves the
 * negotiation unchanged.
 */
export function step(book: Book, n: Negotiation, side: Side, input: unknown, now: number): StepResult {
  const refuse = (reason: string): StepResult => ({ok: false, reason, negotiation: n});
  if (n.status !== 'open') return refuse('The negotiation is over.');
  if (n.turn !== side) return refuse(`It is the ${n.turn}'s turn.`);
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return refuse('The move is malformed.');
  const move = parsed.data;

  const nextTurn: Side = side === 'creator' ? 'founder' : 'creator';
  const nextRound = side === 'founder' ? n.round + 1 : n.round;
  const record = (patch: Partial<Negotiation>, terms?: Terms): StepResult => ({
    ok: true,
    negotiation: {
      ...n, ...patch,
      history: [...n.history, {seq: n.history.length + 1, round: n.round, side, action: move.action, ...(terms ? {terms} : {}), message: move.message, at: now}],
    },
  });

  if (move.action === 'reject') return record({status: 'failed', onTable: null});

  if (move.action === 'accept') {
    if (!n.onTable || n.proposedBy === side) return refuse('There are no terms from the other side to accept.');
    if (book.campaign.status !== 'open') return refuse('The campaign is closed.');
    return record({status: 'agreed', agreed: n.onTable});
  }

  if (!canContinue(n, side)) return refuse(`This negotiation has reached ${MAX_TURNS} moves: accept the terms on the table or reject.`);
  if (move.action === 'message') return record({turn: nextTurn, round: nextRound});

  const terms = move.terms;
  if (terms.priceCents > book.campaign.maxCacCents) return refuse('The price is above the campaign\'s maximum price per sign-up.');
  return record({onTable: terms, proposedBy: side, turn: nextTurn, round: nextRound}, terms);
}

/** Record an agreed negotiation as a deal in the campaign (no change for any other outcome). */
export function settleNegotiation(book: Book, n: Negotiation, now: number): Book {
  if (n.status !== 'agreed' || !n.agreed) return book;
  return createDeal(book, {creatorId: n.creatorId, priceCents: n.agreed.priceCents, volumeCap: n.agreed.volumeCap, creatorVerifiedTotal: n.creatorVerifiedTotal, negotiated: true, now});
}
