// Creator agent: decides, on its owner's behalf, whether to promote a campaign
// at the price on offer. It knows its own owner's private floor (the mandate)
// and audience; it never sees other creators' information or the founder's.

import {z} from 'zod';
import {creatorModel, type Effort, type JsonClient} from './claude.ts';
import {ThresholdPolicy, type CreatorDecision, type CreatorDecisionInput, type CreatorPolicy} from '../sim/policy.ts';

const SYSTEM = `You are a creator's personal agent. You work only for your owner, the creator. Dealoop is the marketplace where campaigns are listed; it pays creators a fixed price for every verified sign-up they bring to a product. You are not part of Dealoop, even when the product in a campaign is Dealoop itself.
Your owner has authorized you to accept or decline campaigns on their behalf within one rule: never accept a price below their minimum take-home per sign-up.
Above that floor, use judgment as your owner would: accept when the product is a credible fit for the audience, because promoting irrelevant products costs the owner their audience's trust. Decline a poor fit even if the price is good.
Prices on Dealoop only go up, and everyone who joins is paid the final price, so there is no advantage in waiting for a raise.
Answer with whether to join and a one-sentence rationale written to your owner.`;

const jsonSchema = {
  type: 'object',
  properties: {join: {type: 'boolean'}, rationale: {type: 'string'}},
  required: ['join', 'rationale'],
  additionalProperties: false,
};
const validate = z.object({join: z.boolean(), rationale: z.string().max(600)});

export function buildCreatorPrompt({profile, minTakeHomeCents, offer}: CreatorDecisionInput): string {
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  return [
    `Your owner: ${profile.handle} on ${profile.platform}, ${profile.followers.toLocaleString('en-US')} followers, about ${profile.niche}.`,
    `Your owner's minimum take-home: ${dollars(minTakeHomeCents)} per verified sign-up.`,
    '',
    `Campaign: ${offer.productName}. ${offer.productPitch}`,
    `Price on offer: ${dollars(offer.priceCents)} per verified sign-up (it can rise to at most ${dollars(offer.maxCacCents)}).`,
    `Budget remaining: ${dollars(offer.remainingBudgetCents)}. Time left: ${offer.hoursLeft.toFixed(0)} hours.`,
  ].join('\n');
}

export interface ClaudeCreatorOptions {
  model?: string;
  effort?: Effort;
}

export class ClaudeCreatorPolicy implements CreatorPolicy {
  readonly name = 'claude';
  private readonly fallback = new ThresholdPolicy();

  constructor(private readonly client: JsonClient, private readonly options: ClaudeCreatorOptions = {}) {}

  async decide(input: CreatorDecisionInput): Promise<CreatorDecision> {
    const result = await this.client.json({
      purpose: 'creator.decide',
      model: this.options.model ?? creatorModel(),
      effort: this.options.effort ?? 'low',
      system: SYSTEM,
      user: buildCreatorPrompt(input),
      jsonSchema,
      validate,
      maxTokens: 4000,
    });
    if (!result.ok) {
      const d = await this.fallback.decide(input);
      return {...d, rationale: `Agent unavailable (${result.error}); used the floor rule. ${d.rationale}`, fellBack: true};
    }
    // The mandate is a hard rule, enforced here as well as in the prompt: an agent that
    // says yes below its owner's floor is overruled.
    if (result.value.join && input.offer.priceCents < input.minTakeHomeCents) {
      return {join: false, rationale: `Overruled: the agent tried to accept below the owner's floor. (${result.value.rationale})`};
    }
    return {join: result.value.join, rationale: result.value.rationale};
  }
}
