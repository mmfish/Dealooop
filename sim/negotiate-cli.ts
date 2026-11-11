// npm run negotiate -- [--public 5] [--floor 6.5] [--ceiling 7.5] [--volume 50] [--rules]
//
// One private negotiation between a top creator's agent and the founder's agent,
// in dollars. With Claude (the default) this makes a handful of API calls, a few
// cents. --rules uses the rule-based negotiators and calls nothing.
// Rehearsal for Act 2: there, each owner talks to their own Claude window instead.

import {mkdirSync, writeFileSync} from 'node:fs';
import {applyAgentProposal, createCampaign} from '../core/campaign.ts';
import type {Mandates} from '../core/negotiation.ts';
import {AnthropicJsonClient, creatorModel, estimateCostUsd, founderModel} from '../agents/claude.ts';
import {ClaudeNegotiator} from '../agents/negotiator.ts';
import {RuleNegotiator, runNegotiation} from './negotiation-run.ts';
import {DEALOOP_SEED_PRODUCT} from './policy.ts';

const args = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const cents = (d: string) => Math.round(Number(d) * 100);
const publicCents = cents(flag('public', '5'));
const mandates: Mandates = {
  creator: {minPriceCents: cents(flag('floor', '6.5'))},
  founder: {maxPriceCents: cents(flag('ceiling', '7.5')), maxVolume: Number(flag('volume', '50'))},
};
const useRules = args.includes('--rules');
const dollars = (c: number) => '$' + (c / 100).toFixed(2);

const NOW = Date.UTC(2026, 10, 15);
let book = createCampaign({id: 'dealoop-launch', goalCount: 100, budgetCents: 100_000, maxCacCents: 1_000, deadline: NOW + 9 * 86_400_000, now: NOW - 5 * 86_400_000});
while (book.campaign.currentPriceCents < publicCents) book = applyAgentProposal(book, {kind: 'raise_price', supplyAtCurrent: 0, supplyAtRaised: 50}, NOW).book;

const creator = {id: 'creator-y', handle: '@growth_y', niche: 'growth marketing for startups', platform: 'YouTube', followers: 84_000, verifiedTotal: 200};
const client = new AnthropicJsonClient();
const agent = useRules ? new RuleNegotiator() : new ClaudeNegotiator(client);

console.log(`Private negotiation · ${creator.handle} (${creator.verifiedTotal} verified sign-ups) and the Dealoop founder`);
console.log(`Public price ${dollars(book.campaign.currentPriceCents)} · max CAC ${dollars(book.campaign.maxCacCents)} · agents: ${useRules ? 'rules' : `${creatorModel()} / ${founderModel()}`}`);
console.log(`Private mandates (each agent sees only its own): creator floor ${dollars(mandates.creator.minPriceCents)}; founder ceiling ${dollars(mandates.founder.maxPriceCents)} for up to ${mandates.founder.maxVolume} sign-ups\n`);

const out = await runNegotiation({book, id: 'neg-1', creator, product: DEALOOP_SEED_PRODUCT, mandates, creatorAgent: agent, founderAgent: agent, now: NOW});

for (const e of out.events) {
  const who = e.side === 'creator' ? 'Creator agent' : 'Founder agent';
  const terms = e.move.action === 'propose' ? ` ${dollars(e.move.terms.priceCents)} × ${e.move.terms.volumeCap}` : '';
  console.log(`${who.padEnd(14)} ${e.move.action.toUpperCase()}${terms}${e.refused ? '   ✗ refused by the core' : e.fellBack ? '   (runner, after refusals)' : ''}`);
  console.log(`               “${e.move.message}”`);
  if (e.refused) console.log(`               core: ${e.refused}`);
}

const deal = out.book.deals[creator.id];
console.log(`\nOutcome: ${out.negotiation.status.toUpperCase()}${deal ? ` — deal recorded: at least ${dollars(deal.priceCents)} per sign-up for ${creator.handle}'s next ${deal.volumeCap} sign-ups; public price stays ${dollars(out.book.campaign.currentPriceCents)}` : ' — no deal; the creator stays on the public price'}`);
if (!useRules) {
  const cost = estimateCostUsd(client.usage, founderModel());
  console.log(`API usage: ${client.usage.calls} calls, ${client.usage.failures} failed${cost !== null && founderModel() === creatorModel() ? `, about $${cost.toFixed(2)}` : ''}`);
}

mkdirSync('data/negotiations', {recursive: true});
const file = `data/negotiations/negotiation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(file, JSON.stringify({mandates, publicCents: book.campaign.currentPriceCents, creator, agents: useRules ? 'rules' : {creator: creatorModel(), founder: founderModel()}, negotiation: out.negotiation, events: out.events, deal: deal ?? null}, null, 2));
console.log(`Saved to ${file}`);
