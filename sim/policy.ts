// How a creator decides whether to promote a campaign at its current price.
// The simulator asks only creators who have not joined yet, and only when the
// price changes; with a price that never falls, a creator who joins stays in.

import type {CreatorProfile} from './market.ts';

export interface CampaignOffer {
  productName: string;
  productPitch: string;
  priceCents: number;
  maxCacCents: number;
  remainingBudgetCents: number;
  hoursLeft: number;
}

export interface CreatorDecisionInput {
  profile: CreatorProfile;
  /** The creator's private floor, known only to their own agent. */
  minTakeHomeCents: number;
  offer: CampaignOffer;
}

export interface CreatorDecision {
  join: boolean;
  rationale: string;
  /** True when the agent could not answer and the simulator used the threshold rule instead. */
  fellBack?: boolean;
}

export interface CreatorPolicy {
  readonly name: string;
  decide(input: CreatorDecisionInput): Promise<CreatorDecision>;
}

/** The rule the heuristic simulator uses: join once the price meets your floor. */
export class ThresholdPolicy implements CreatorPolicy {
  readonly name = 'threshold';
  async decide({minTakeHomeCents, offer}: CreatorDecisionInput): Promise<CreatorDecision> {
    const join = offer.priceCents >= minTakeHomeCents;
    return {join, rationale: join ? 'Price meets my floor.' : 'Price is below my floor.'};
  }
}

/** The campaign the demo runs: Dealoop promoting itself (SPEC §11). */
export const DEALOOP_SEED_PRODUCT = {
  productName: 'Dealoop',
  productPitch: 'A marketplace where founders post a promotion goal and creators get paid for every verified sign-up '
    + 'they bring. Built for indie founders launching digital products and for creators who want performance deals '
    + 'without negotiating each one.',
};
