// Synthetic creator market for the simulator. ALL DATA HERE IS SYNTHETIC
// (CLAUDE.md rule 5): the distributions are assumptions chosen before looking
// at results, not measurements of real creators.

export interface Rng {
  next(): number;
  int(lo: number, hi: number): number;
  uniform(lo: number, hi: number): number;
  poisson(mean: number): number;
}

/** Seeded PRNG (mulberry32) so every run is reproducible from its seed. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    uniform: (lo, hi) => lo + next() * (hi - lo),
    // Knuth's method; means here stay small (well under 30).
    poisson(mean) {
      if (mean <= 0) return 0;
      const limit = Math.exp(-mean);
      let k = 0;
      let p = 1;
      do { k++; p *= next(); } while (p > limit);
      return k - 1;
    },
  };
}

/** A creator's private economics. The platform and the founder agent never see these fields. */
export interface SyntheticCreator {
  id: string;
  /** Lowest per-conversion price at which this creator bothers to promote. Hidden. */
  minPriceCents: number;
  /** Expected verified-or-not conversions per day while promoting. Hidden. */
  dailyRate: number;
  /** Most conversions this creator's audience can produce in the campaign. Hidden. */
  capacity: number;
  /** Lifetime verified conversions on the platform (public), for deal eligibility. */
  verifiedTotal: number;
}

export interface MarketSpec {
  name: string;
  creators: number;
  minPriceCents: [number, number];
  dailyRate: [number, number];
  capacity: [number, number];
}

/**
 * Market presets. `baseline` is the S2 setup (30 creators, hidden prices $3–$12).
 * `thin` and `thick` exist to show where the mechanism helps and where it does not.
 */
export const MARKETS: Record<string, MarketSpec> = {
  baseline: {name: 'baseline', creators: 30, minPriceCents: [300, 1200], dailyRate: [0.2, 1.2], capacity: [5, 30]},
  thin: {name: 'thin', creators: 12, minPriceCents: [500, 1400], dailyRate: [0.1, 0.6], capacity: [3, 15]},
  thick: {name: 'thick', creators: 80, minPriceCents: [200, 1000], dailyRate: [0.3, 1.5], capacity: [10, 40]},
};

export function generateMarket(spec: MarketSpec, rng: Rng): SyntheticCreator[] {
  return Array.from({length: spec.creators}, (_, i) => ({
    id: `creator-${String(i + 1).padStart(2, '0')}`,
    minPriceCents: rng.int(spec.minPriceCents[0], spec.minPriceCents[1]),
    dailyRate: rng.uniform(spec.dailyRate[0], spec.dailyRate[1]),
    capacity: rng.int(spec.capacity[0], spec.capacity[1]),
    verifiedTotal: rng.int(0, 120),
  }));
}
