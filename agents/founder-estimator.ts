// Founder agent, pricing role: estimate supply at the current price and one
// step higher (SPEC §6 step 1). Claude only estimates; core/campaign.ts decides
// whether to raise, so a wrong or wild estimate cannot break a money invariant (B3).
//
// Privacy: the prompt is built only from what the platform observes (counts,
// times, prices). It never includes creators' hidden floors, rates or capacities.

import {z} from 'zod';
import {counts, type Book} from '../core/campaign.ts';
import {HeuristicEstimator, type SupplyEstimate, type SupplyEstimator} from '../sim/estimator.ts';
import {founderModel, type Effort, type JsonClient} from './claude.ts';

const HOUR = 3_600_000;

const SYSTEM = `You are the pricing analyst for a founder's promotion campaign on Dealoop.
Creators are paid a uniform price per verified sign-up. The platform may raise that price one step at a time; it never lowers it, and a raise also applies to every sign-up already counted.
Your only job is to forecast supply. A separate rule decides whether to raise, using your forecast and the budget.

Forecast two numbers for the time left until the deadline:
- supply_at_current: further sign-ups expected if the price stays where it is
- supply_at_raised: further sign-ups expected if the price goes up one step now

Reason from the observations you are given: how the sign-up rate responded to earlier price levels, how many distinct creators are producing, and how recent the data is. Early on there is little data; say so in your rationale rather than inventing precision. Higher prices attract creators whose floor was above the old price, so supply_at_raised is usually at least supply_at_current, but the size of the effect is what you must judge.
Keep the rationale to two sentences.`;

const jsonSchema = {
  type: 'object',
  properties: {
    supply_at_current: {type: 'integer'},
    supply_at_raised: {type: 'integer'},
    rationale: {type: 'string'},
  },
  required: ['supply_at_current', 'supply_at_raised', 'rationale'],
  additionalProperties: false,
};

const validate = z.object({
  supply_at_current: z.number().int().min(0).max(1_000_000),
  supply_at_raised: z.number().int().min(0).max(1_000_000),
  rationale: z.string().max(1200),
});

export interface PriceSegment {
  priceCents: number;
  hours: number;
  signups: number;
  creators: number;
}

/** What the platform can observe: sign-ups grouped by the price level they arrived under. */
export function observeSegments(book: Book, now: number): PriceSegment[] {
  const bounds = [{at: book.campaign.createdAt, price: book.campaign.startPriceCents}, ...book.priceHistory.map(h => ({at: h.at, price: h.toCents}))];
  return bounds.map((b, i) => {
    const end = i + 1 < bounds.length ? bounds[i + 1].at : now;
    const inSegment = book.conversions.filter(c => c.channel === 'public' && c.status !== 'unfunded' && c.createdAt >= b.at && c.createdAt < end);
    return {priceCents: b.price, hours: Math.max(0, (end - b.at) / HOUR), signups: inSegment.length, creators: new Set(inSegment.map(c => c.creatorId)).size};
  });
}

export function buildFounderPrompt(book: Book, now: number): string {
  const {campaign} = book;
  const c = counts(book);
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  const segments = observeSegments(book, now);
  const lines = segments.map(s => `- ${dollars(s.priceCents)} for ${s.hours.toFixed(0)}h: ${s.signups} sign-ups from ${s.creators} creators`);
  return [
    `Campaign goal: ${campaign.goalCount} sign-ups. Budget ${dollars(campaign.budgetCents)}. Maximum price ${dollars(campaign.maxCacCents)}.`,
    `Current price ${dollars(campaign.currentPriceCents)}; one step higher would be ${dollars(Math.min(campaign.currentPriceCents + campaign.stepCents, campaign.maxCacCents))}.`,
    `Elapsed ${((now - campaign.createdAt) / HOUR).toFixed(0)}h, ${Math.max(0, (campaign.deadline - now) / HOUR).toFixed(0)}h left.`,
    `So far: ${c.verified} verified, ${c.pending} awaiting verification, ${c.rejected} rejected, ${c.unfunded} beyond budget.`,
    'Sign-ups by price level:',
    ...lines,
  ].join('\n');
}

export interface ClaudeEstimatorOptions {
  model?: string;
  effort?: Effort;
  /** Called with every estimate, including fallbacks, for the agent log. */
  onEstimate?: (at: number, estimate: SupplyEstimate & {fellBack: boolean}) => void;
}

export class ClaudeSupplyEstimator implements SupplyEstimator {
  readonly name = 'claude';
  private readonly fallback = new HeuristicEstimator();

  constructor(private readonly client: JsonClient, private readonly options: ClaudeEstimatorOptions = {}) {}

  async estimate(book: Book, now: number): Promise<SupplyEstimate> {
    const result = await this.client.json({
      purpose: 'founder.estimate',
      model: this.options.model ?? founderModel(),
      effort: this.options.effort ?? 'medium',
      system: SYSTEM,
      user: buildFounderPrompt(book, now),
      jsonSchema,
      validate,
      maxTokens: 8000,
    });
    if (!result.ok) {
      const heuristic = this.fallback.estimate(book, now);
      const estimate = {...heuristic, rationale: `Claude unavailable (${result.error}); used the heuristic. ${heuristic.rationale}`};
      this.options.onEstimate?.(now, {...estimate, fellBack: true});
      return estimate;
    }
    const estimate = {supplyAtCurrent: result.value.supply_at_current, supplyAtRaised: result.value.supply_at_raised, rationale: result.value.rationale};
    this.options.onEstimate?.(now, {...estimate, fellBack: false});
    return estimate;
  }
}
