// The creators of the live demo (DEMO-FLOW beats 3–6). ALL SIMULATED except Yi.
//
// The platform stores only what is public (handle, platform, niche, audience,
// followers, track record). Each creator's floor and their instructions to
// their own agent are private, so they live here, where only that creator's
// agent reads them, and never in the platform's database.

import type {CampaignStore} from '../db/campaign-store.ts';

export interface DemoCreator {
  userId: string;
  handle: string;
  platform: string;
  niche: string;
  audience: string;
  followers: number;
  /** Lifetime verified sign-ups from before this deployment (labeled demo data). */
  priorVerified: number;
  /** Private: the lowest price per verified sign-up the owner accepts. */
  floorCents: number;
  /** Private: what the owner told their agent, beyond the floor. */
  note?: string;
}

type Row = [handle: string, platform: string, niche: string, audience: string, followers: number, floorCents: number, note?: string];

// Fit is deliberately mixed: about half the niches suit a product for founders and creators.
const ROWS: Row[] = [
  ['@growthwithmaya', 'YouTube', 'growth marketing for startups', 'early-stage founders', 48_000, 300,
    'My audience is very price-sensitive. Before promoting anything I must be able to tell them plainly whether it is free to use. If a campaign does not say, ask the founder first instead of joining or declining.'],
  ['@indiehackerdan', 'X', 'indie hacking and bootstrapped SaaS', 'solo founders', 21_000, 250],
  ['@shipitsara', 'newsletter', 'launching side projects', 'makers shipping their first product', 12_500, 300],
  ['@nocode_nina', 'YouTube', 'no-code building', 'non-technical founders', 64_000, 450],
  ['@devtools_dev', 'X', 'developer tools and open source', 'software engineers', 33_000, 400],
  ['@promptpriya', 'TikTok', 'AI tools and prompt engineering', 'AI-curious professionals', 210_000, 600],
  ['@saasmetrics', 'LinkedIn', 'SaaS metrics and pricing', 'SaaS founders and operators', 18_000, 500],
  ['@creatoreconomyco', 'newsletter', 'freelancing and the creator economy', 'creators monetizing an audience', 27_000, 300],
  ['@bootstrapbea', 'YouTube', 'bootstrapped businesses', 'first-time founders', 9_800, 250],
  ['@launchweekly', 'newsletter', 'product launches', 'founders and early adopters', 15_000, 350],
  ['@uxwithomar', 'Instagram', 'UI/UX design', 'designers', 52_000, 700],
  ['@techcareers_li', 'LinkedIn', 'tech career advice', 'job seekers in tech', 76_000, 650],
  ['@productivitypete', 'YouTube', 'productivity and note-taking apps', 'knowledge workers', 120_000, 800],
  ['@aiweekly_ari', 'X', 'AI news', 'AI builders', 44_000, 500],
  ['@growthloops', 'X', 'growth loops and referral marketing', 'marketers at startups', 16_000, 300],
  ['@makerlogkim', 'X', 'building in public', 'indie makers', 8_200, 250],
  ['@founderfriday', 'podcast', 'founder interviews', 'aspiring founders', 31_000, 550],
  ['@agentbuilders', 'YouTube', 'building AI agents', 'developers building with LLMs', 58_000, 450],
  ['@marketingmo', 'TikTok', 'small-business marketing', 'local business owners', 95_000, 400],
  ['@weeknightchef', 'TikTok', 'home cooking', 'busy home cooks', 310_000, 500],
  ['@runwithrae', 'Instagram', 'fitness and running', 'amateur runners', 140_000, 600],
  ['@moneymindedmia', 'YouTube', 'personal finance', 'young professionals saving money', 230_000, 900],
  ['@wanderwithwes', 'YouTube', 'travel vlogging', 'budget travelers', 180_000, 800],
  ['@pixelplays', 'Twitch', 'gaming', 'PC gamers', 260_000, 700],
  ['@parentinghacks', 'Instagram', 'parenting', 'new parents', 88_000, 500],
  ['@plantmomlu', 'TikTok', 'houseplants', 'plant lovers', 120_000, 400],
  ['@studywithsol', 'YouTube', 'study tips for students', 'university students', 99_000, 450],
  ['@vintagevibes', 'Instagram', 'vintage fashion', 'thrift shoppers', 67_000, 500],
  ['@homegymhal', 'YouTube', 'home workouts', 'home fitness beginners', 72_000, 550],
  ['@cryptocal', 'X', 'crypto trading', 'retail crypto traders', 150_000, 800],
];

const slug = (handle: string) => 'demo-' + handle.replace(/[^a-z0-9]+/gi, '').toLowerCase();

export const DEMO_CREATORS: DemoCreator[] = ROWS.map(([handle, platform, niche, audience, followers, floorCents, note]) => ({
  userId: slug(handle), handle, platform, niche, audience, followers, priorVerified: 0, floorCents, note,
}));

/** Yi, the real top creator. His agent is his own Claude; only his public profile is seeded here. */
export const YI = {userId: 'yi', handle: '@yi.builds', name: 'Yi', platform: 'YouTube', niche: 'AI tools and building with Claude', audience: 'developers and indie founders', followers: 120_000, priorVerified: 200};

/** Writes the public profiles. Idempotent. */
export async function seedCreators(store: CampaignStore, now: number) {
  for (const c of DEMO_CREATORS) {
    await store.upsertCreator({userId: c.userId, handle: c.handle, platform: c.platform, niche: c.niche, audience: c.audience, followers: c.followers, priorVerified: c.priorVerified, demo: true, now});
  }
  await store.upsertCreator({...YI, demo: false, now});
}
