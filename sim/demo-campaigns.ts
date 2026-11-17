// Sample campaigns for the homepage, so the list looks like a live marketplace
// (npm run demo:seed). ALL SIMULATED: the founders, their apps, the creators who
// joined and the sign-ups are demo data, labeled as such on every card. Some use
// the platform's cartoon picture, others a photo "uploaded" by the founder
// (public/images). Idempotent: a campaign already there is left alone.

import {DAY_MS} from '../db/campaign-view.ts';
import type {CampaignStore} from '../db/campaign-store.ts';
import {DEMO_CREATORS, seedCreators} from './demo-creators.ts';
import {createRng} from './market.ts';

interface Sample {
  id: string;
  founder: [id: string, name: string];
  title: string;
  url: string;
  description: string;
  brief: string;
  /** A founder's photo, or null for the platform's cartoon picture. */
  photo: string | null;
  goal: number;
  budget: number;
  max: number;
  /** Days ago it was posted, and how long it runs. */
  age: number;
  days: number;
  creators: string[];
  signUps: number;
  /** Close and settle it (its deadline has passed). */
  closed?: boolean;
}

const SAMPLES: Sample[] = [
  {id: 'cmp_demo_pawpal', founder: ['demo-founder-nora', 'Nora'], title: 'PawPal', url: 'https://pawpal.example', photo: null,
    description: 'A pet care app for dog and cat owners: vet reminders, walk tracking and a feeding log the whole family shares.',
    brief: 'We want sign-ups from pet owners, especially new puppy and kitten parents. Show how the reminders work in a real day with your pet.',
    goal: 150, budget: 1200, max: 9, age: 3, days: 21, creators: ['@parentinghacks', '@marketingmo', '@creatoreconomyco'], signUps: 34},
  {id: 'cmp_demo_rallyup', founder: ['demo-founder-marcus', 'Marcus'], title: 'RallyUp', url: 'https://rallyup.example', photo: null,
    description: 'Find tennis partners at your level nearby: match by rating and schedule, book a court, and keep score.',
    brief: 'Promote RallyUp to recreational tennis and pickleball players. Sign-ups count once a player sets their level and availability.',
    goal: 80, budget: 600, max: 8, age: 5, days: 14, creators: ['@runwithrae', '@homegymhal'], signUps: 21},
  {id: 'cmp_demo_strum', founder: ['demo-founder-lena', 'Lena'], title: 'StrumSchool', url: 'https://strumschool.example', photo: null,
    description: 'Learn guitar, ukulele or piano in ten minutes a day, with songs you already know and feedback on every chord.',
    brief: 'Looking for adult beginners who always wanted to play. A short clip of you trying the first lesson works great.',
    goal: 200, budget: 1500, max: 7.5, age: 1, days: 30, creators: ['@productivitypete', '@studywithsol'], signUps: 9},
  {id: 'cmp_demo_chapter', founder: ['demo-founder-ivy', 'Ivy'], title: 'ChapterClub', url: 'https://chapterclub.example', photo: '/images/books.jpg',
    description: 'Book clubs that fit your week: read a few chapters, discuss with a small group, never fall behind.',
    brief: 'We want readers who have drifted away from reading and want a reason to come back. Mention the free first month.',
    goal: 120, budget: 800, max: 6, age: 6, days: 21, creators: ['@studywithsol', '@creatoreconomyco', '@launchweekly'], signUps: 47},
  {id: 'cmp_demo_shutter', founder: ['demo-founder-kai', 'Kai'], title: 'Shutterly', url: 'https://shutterly.example', photo: '/images/camera.jpg',
    description: 'Edit like a pro on your phone: one-tap film looks, sky and light fixes, and presets made by working photographers.',
    brief: 'For hobby photographers and creators who shoot on phones and cameras. Before-and-after edits convert best.',
    goal: 250, budget: 2000, max: 8, age: 8, days: 30, creators: ['@uxwithomar', '@promptpriya', '@vintagevibes'], signUps: 88},
  {id: 'cmp_demo_bean', founder: ['demo-founder-sofia', 'Sofia'], title: 'BeanScout', url: 'https://beanscout.example', photo: '/images/coffee.jpg',
    description: 'Find great independent cafés near you, see what is on the menu today, and collect stamps across shops.',
    brief: 'Coffee lovers and remote workers looking for a place to sit. Local creators welcome.',
    goal: 90, budget: 450, max: 5, age: 4, days: 14, creators: ['@wanderwithwes', '@makerlogkim'], signUps: 26},
  {id: 'cmp_demo_snack', founder: ['demo-founder-grace', 'Grace'], title: 'SnackTrack', url: 'https://snacktrack.example', photo: null,
    description: 'Plan family meals and snacks in minutes, with a shared grocery list and recipes kids actually eat.',
    brief: 'Busy parents who cook for small kids. This campaign has ended.',
    goal: 60, budget: 400, max: 6, age: 16, days: 14, creators: ['@weeknightchef', '@parentinghacks'], signUps: 52, closed: true},
];

const HANDLES = new Map(DEMO_CREATORS.map(c => [c.handle, c]));

export async function seedDemoCampaigns(store: CampaignStore, now = Date.now()): Promise<string[]> {
  await seedCreators(store, now, false);
  const made: string[] = [];
  const rng = createRng(42);
  for (const x of SAMPLES) {
    if (await store.load(x.id)) continue;
    const posted = now - x.age * DAY_MS - 3 * 3_600_000;
    await store.createCampaign({
      id: x.id, ownerId: x.founder[0], ownerName: x.founder[1], title: x.title, brief: x.brief, productUrl: x.url, productDescription: x.description,
      imageUrl: x.photo ?? `/campaigns/${x.id}/art.svg`, goalCount: x.goal, budgetCents: x.budget * 100, maxCacCents: Math.round(x.max * 100),
      deadline: posted + x.days * DAY_MS, now: posted, demo: true,
    });
    const links = [];
    for (const [i, handle] of x.creators.entries()) {
      const c = HANDLES.get(handle)!;
      links.push(await store.join(x.id, c.userId, posted + (i + 1) * 3_600_000, 'good fit for my audience (simulated decision)'));
    }
    // Sign-ups spread over the campaign's life so far; most are verified a day later.
    const span = Math.max(1, Math.min(x.age, x.days)) * DAY_MS;
    const times = Array.from({length: x.signUps}, () => posted + 6 * 3_600_000 + Math.floor(rng.next() * (span - 6 * 3_600_000))).sort((a, b) => a - b);
    for (const [n, at] of times.entries()) {
      const link = links[Math.floor(rng.next() * links.length)];
      const c = await store.recordConversion(link.token, `sim-${x.id}-${n}@example.test`, Math.min(at, posted + x.days * DAY_MS - 1));
      if (c.status !== 'pending') continue;
      if (x.closed || at + DAY_MS < now) {
        if (rng.next() < 0.04) await store.rejectConversion(x.id, c.id, at + DAY_MS);
        else await store.verifyConversion(x.id, c.id, Math.min(at + DAY_MS, now));
      }
    }
    if (x.closed) await store.closeAndSettle(x.id, posted + x.days * DAY_MS + DAY_MS);
    made.push(x.title);
  }
  return made;
}
