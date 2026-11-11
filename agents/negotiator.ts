// Claude negotiators for the private deal channel (SPEC §9). One class, two
// roles: the creator's agent and the founder's agent. Each sees the public
// campaign facts, the conversation so far, and only its own owner's limits.
// core/negotiation.ts judges every move; a refused move comes back as feedback.

import {z} from 'zod';
import {creatorModel, founderModel, type Effort, type JsonClient} from './claude.ts';
import type {CreatorMandate, FounderMandate, Move} from '../core/negotiation.ts';
import {RuleNegotiator, type NegotiationView, type Negotiator} from '../sim/negotiation-run.ts';

const dollars = (c: number) => '$' + (c / 100).toFixed(2);

const COMMON = `Dealoop pays creators per verified sign-up. Every creator is paid the campaign's public price, which only rises. A top creator may negotiate a private deal: a price floor per sign-up that covers a set number of their sign-ups. A deal never pays less than the public price, so a deal only matters if its price is above the public price.

The negotiation has at most two rounds. The creator moves first. A proposal means you agree to those exact terms. The founder replies; if the founder counters, the creator gets one more move, and then the founder can only accept or reject.

Your owner's limits are private. Never state them, hint at them, or say how close an offer is to them. Negotiate in good faith: be brief, concrete and polite, and give a reason for your position grounded in the public facts (audience size and fit, track record, the public price, time and budget left).`;

const ROLE: Record<'creator' | 'founder', string> = {
  creator: `You are a creator's personal agent, working only for the creator. Get the best deal you can for your owner, but never propose or accept a price below your owner's minimum. A deal that is barely above the public price is still worth taking if it is above your owner's minimum.`,
  founder: `You are the founder's agent, working only for the founder. Top creators are worth more than the public price because they convert reliably, but every cent above the public price costs the founder. Never propose or accept a price above your owner's maximum deal price, or a volume above your owner's maximum. Reject rather than overpay.`,
};

const jsonSchema = {
  type: 'object',
  properties: {
    action: {type: 'string', enum: ['propose', 'accept', 'reject']},
    price_cents: {type: 'integer'},
    volume_cap: {type: 'integer'},
    message: {type: 'string'},
  },
  required: ['action', 'price_cents', 'volume_cap', 'message'],
  additionalProperties: false,
};

const validate = z.object({
  action: z.enum(['propose', 'accept', 'reject']),
  price_cents: z.number().int().min(0).max(1_000_000),
  volume_cap: z.number().int().min(0).max(1_000_000),
  message: z.string().min(1).max(1200),
});

export function buildNegotiationPrompt(v: NegotiationView): string {
  const c = v.campaign;
  const lines = [
    `Campaign: ${c.productName}. ${c.productPitch}`,
    `Public price now: ${dollars(c.publicPriceCents)} per verified sign-up; it can rise to at most ${dollars(c.maxCacCents)}. Goal ${c.goalCount} sign-ups, ${dollars(c.remainingBudgetCents)} of budget left, ${c.hoursLeft.toFixed(0)} hours left.`,
    `Creator: ${v.creator.handle} on ${v.creator.platform}, ${v.creator.followers.toLocaleString('en-US')} followers, about ${v.creator.niche}; ${v.creator.verifiedTotal} verified sign-ups delivered on Dealoop so far.`,
    '',
    v.side === 'creator'
      ? `Your owner's minimum deal price: ${dollars((v.mandate as CreatorMandate).minPriceCents)} per sign-up. (Private.)`
      : `Your owner's maximum deal price: ${dollars((v.mandate as FounderMandate).maxPriceCents)} per sign-up, for at most ${(v.mandate as FounderMandate).maxVolume} sign-ups from one creator. (Private.)`,
    '',
    'Conversation so far:',
    ...(v.history.length
      ? v.history.map(t => `- ${t.side === v.side ? 'You' : t.side === 'creator' ? 'Creator' : 'Founder'} (${t.action}${t.terms ? ` ${dollars(t.terms.priceCents)} for ${t.terms.volumeCap} sign-ups` : ''}): ${t.message}`)
      : ['- (nothing yet; you open)']),
    '',
    `Round ${v.round} of 2. Your options: ${[v.canPropose ? 'propose terms' : null, v.onTable && v.proposedBy !== v.side ? 'accept the terms on the table' : null, 'reject'].filter(Boolean).join(', ')}.`,
    'Give price_cents and volume_cap for a proposal; for accept or reject, send 0 for both.',
  ];
  if (v.feedback) lines.push('', `Your previous attempt was refused by the platform: ${v.feedback} Try again.`);
  return lines.join('\n');
}

export class ClaudeNegotiator implements Negotiator {
  readonly name = 'claude';
  private readonly fallback = new RuleNegotiator();

  constructor(private readonly client: JsonClient, private readonly options: {model?: string; effort?: Effort} = {}) {}

  async move(v: NegotiationView): Promise<Move> {
    const result = await this.client.json({
      purpose: `negotiate.${v.side}`,
      model: this.options.model ?? (v.side === 'creator' ? creatorModel() : founderModel()),
      effort: this.options.effort ?? 'medium',
      system: `${COMMON}\n\n${ROLE[v.side]}`,
      user: buildNegotiationPrompt(v),
      jsonSchema,
      validate,
      maxTokens: 8000,
    });
    if (!result.ok) return this.fallback.move(v);
    const r = result.value;
    if (r.action === 'propose') return {action: 'propose', terms: {priceCents: r.price_cents, volumeCap: r.volume_cap}, message: r.message};
    return {action: r.action, message: r.message};
  }
}
