// Replay Claude creators' decisions without calling the API, so a Claude run can
// be compared fairly with other pricing strategies on the SAME supply.
//
// Claude creator agents decline poor-fit campaigns even above their floor, so a
// market of Claude creators is thinner than the threshold rule's. Comparing a
// Claude run against the plain heuristic simulator would mix two effects (the
// founder agent's pricing and the creators' fit judgments). Replaying the
// recorded decisions holds supply fixed and isolates pricing.

import type {AgentLogEntry} from './run.ts';
import type {CreatorDecision, CreatorDecisionInput, CreatorPolicy} from './policy.ts';

export class ReplayPolicy implements CreatorPolicy {
  readonly name = 'replay';
  /** creatorId → lowest price at which that creator's agent joined; absent means it never joined. */
  readonly joinPrice = new Map<string, number>();

  /**
   * @param log the agent log of a recorded run
   * @param priceAt the public price in force at a given time in that run
   */
  constructor(log: AgentLogEntry[], priceAt: (at: number) => number) {
    for (const e of log) {
      if (e.actor === 'founder' || e.kind !== 'join') continue;
      const price = priceAt(e.at);
      const prev = this.joinPrice.get(e.actor);
      if (prev === undefined || price < prev) this.joinPrice.set(e.actor, price);
    }
  }

  async decide({profile, offer}: CreatorDecisionInput): Promise<CreatorDecision> {
    const p = this.joinPrice.get(profile.id);
    const join = p !== undefined && offer.priceCents >= p;
    return {join, rationale: join ? 'Replayed: joined at this price in the recorded run.' : 'Replayed: declined.'};
  }
}

/** Price in force at time `at`, from a start price and a price history. */
export function priceAtFrom(startPriceCents: number, history: {at: number; toCents: number}[]) {
  return (at: number) => {
    let price = startPriceCents;
    for (const h of history) if (h.at <= at) price = h.toCents;
    return price;
  };
}
