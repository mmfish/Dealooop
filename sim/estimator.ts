// Supply estimation: the one judgment the founder agent contributes to pricing
// (SPEC §6 step 1, §7). The estimator only predicts; core/campaign.ts decides.
//
// HeuristicEstimator is a transparent stand-in so the simulator runs without a
// model. A Claude-backed estimator implements the same interface (agents/).
// It sees only what the platform sees: recorded conversions over time. It never
// sees creators' hidden prices, rates or capacities.

import type {Book} from '../core/campaign.ts';

export interface SupplyEstimate {
  /** Expected further public conversions until the deadline at the current price. */
  supplyAtCurrent: number;
  /** Expected further public conversions until the deadline at one step higher. */
  supplyAtRaised: number;
  rationale: string;
}

export interface SupplyEstimator {
  readonly name: string;
  estimate(book: Book, now: number): SupplyEstimate | Promise<SupplyEstimate>;
}

const HOUR = 3_600_000;

export interface HeuristicOptions {
  /** How far back to measure the current conversion rate. */
  windowHours?: number;
  /** Assumed % increase in supply for each % increase in price. An assumption, not a measurement. */
  elasticity?: number;
  /** Prior used before any conversions exist: conversions/hour expected at one step higher. */
  coldStartPerHour?: number;
}

export class HeuristicEstimator implements SupplyEstimator {
  readonly name = 'heuristic';
  private readonly windowHours: number;
  private readonly elasticity: number;
  private readonly coldStartPerHour: number;

  constructor(options: HeuristicOptions = {}) {
    this.windowHours = options.windowHours ?? 48;
    this.elasticity = options.elasticity ?? 1.5;
    this.coldStartPerHour = options.coldStartPerHour ?? 0.25;
  }

  estimate(book: Book, now: number): SupplyEstimate {
    const {campaign} = book;
    const hoursLeft = Math.max(0, (campaign.deadline - now) / HOUR);
    const elapsedHours = Math.max(1, (now - campaign.createdAt) / HOUR);
    // Only conversions recorded since the last price change reflect the current price.
    const lastChange = book.priceHistory.at(-1)?.at ?? campaign.createdAt;
    const since = Math.max(lastChange, now - this.windowHours * HOUR);
    const observedHours = Math.max(1, Math.min(elapsedHours, (now - since) / HOUR));
    const recent = book.conversions.filter(c => c.channel === 'public' && c.createdAt >= since && c.status !== 'unfunded').length;
    const ratePerHour = recent / observedHours;
    const supplyAtCurrent = Math.round(ratePerHour * hoursLeft);
    const priceLift = campaign.stepCents / campaign.currentPriceCents;
    const raisedRate = ratePerHour > 0 ? ratePerHour * (1 + this.elasticity * priceLift) : this.coldStartPerHour;
    const supplyAtRaised = Math.round(raisedRate * hoursLeft);
    return {
      supplyAtCurrent,
      supplyAtRaised,
      rationale: `Observed ${recent} conversions in ${observedHours.toFixed(0)}h at $${(campaign.currentPriceCents / 100).toFixed(2)} `
        + `(${ratePerHour.toFixed(2)}/h). Assuming elasticity ${this.elasticity}, a ${(priceLift * 100).toFixed(0)}% raise `
        + `lifts that to ${raisedRate.toFixed(2)}/h over the remaining ${hoursLeft.toFixed(0)}h.`,
    };
  }
}
