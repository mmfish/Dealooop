// The negotiation channel: the platform's market rules (C1–C4 in docs/ACCEPTANCE.md),
// the simulated agents' own guardrails (agents/own-limits.ts), and S8–S10.
// (tests/negotiation.test.ts is the inherited Muse offer engine.)

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyAgentProposal, createCampaign, recordConversion, settle, verifyConversion, type Book} from '../core/campaign.ts';
import {MAX_TURNS, openNegotiation, options, step, type Move} from '../core/negotiation.ts';
import {ownLimitProblem, privateNumbers, type Mandates} from '../agents/own-limits.ts';
import {RuleNegotiator, runNegotiation, type NegotiationView, type Negotiator} from '../sim/negotiation-run.ts';
import {ClaudeNegotiator} from '../agents/negotiator.ts';
import {emptyUsage, type JsonClient, type JsonRequest, type JsonResult} from '../agents/claude.ts';
import {createRng} from '../sim/market.ts';
import {DEALOOP_SEED_PRODUCT} from '../sim/policy.ts';

const NOW = Date.UTC(2026, 10, 12);
const DAY = 86_400_000;
const product = DEALOOP_SEED_PRODUCT;
const creatorY = {id: 'creator-y', handle: '@growth_y', niche: 'growth marketing for startups', platform: 'YouTube', followers: 84_000, verifiedTotal: 200};

/** A campaign whose public price has been raised to `publicCents`. */
function campaignAt(publicCents: number): Book {
  let book = createCampaign({id: 'c', goalCount: 100, budgetCents: 100_000, maxCacCents: 1_000, deadline: NOW + 14 * DAY, now: NOW});
  while (book.campaign.currentPriceCents < publicCents) {
    book = applyAgentProposal(book, {kind: 'raise_price', supplyAtCurrent: 0, supplyAtRaised: 50}, NOW).book;
  }
  return book;
}

const run = (book: Book, mandates: Mandates, creatorAgent: Negotiator = new RuleNegotiator(), founderAgent: Negotiator = new RuleNegotiator()) =>
  runNegotiation({book, id: 'n1', creator: creatorY, product, mandates, creatorAgent, founderAgent, now: NOW});

test('S8: a top creator negotiates a deal; the public price is untouched', async () => {
  const book = campaignAt(500);
  const out = await run(book, {creator: {minPriceCents: 650}, founder: {maxPriceCents: 750, maxVolume: 50}});
  assert.equal(out.negotiation.status, 'agreed');
  const deal = out.book.deals[creatorY.id];
  assert.ok(deal, 'a deal is recorded');
  assert.ok(deal.priceCents >= 650 && deal.priceCents <= 750, `C2 price ${deal.priceCents}`);
  assert.ok(deal.volumeCap <= 50, 'C2 volume');
  assert.equal(out.book.campaign.currentPriceCents, 500, 'public price unchanged');
  let b = recordConversion(out.book, {id: 'y1', creatorId: creatorY.id, externalUserId: 'u1', now: NOW + 1});
  b = recordConversion(b, {id: 'p1', creatorId: 'someone-else', externalUserId: 'u2', now: NOW + 1});
  b = verifyConversion(verifyConversion(b, 'y1'), 'p1');
  assert.deepEqual(settle(b).map(e => e.amountCents), [deal.priceCents, 500]);
});

test('S9 and C4: when no terms fit both mandates, there is no deal and nothing changes', async () => {
  const book = campaignAt(500);
  // The creator's floor is above the campaign's max CAC: no legal proposal exists.
  const out = await run(book, {creator: {minPriceCents: 1_200}, founder: {maxPriceCents: 800, maxVolume: 50}});
  assert.equal(out.negotiation.status, 'failed');
  assert.equal(out.book, book, 'C4: the campaign is returned unchanged');
  assert.deepEqual(out.book.deals, {});
  assert.ok(out.events.some(e => e.fellBack), 'the runner rejected on the creator\'s behalf after refused attempts');
});

test('any creator may negotiate, and an agreed deal needs no track record', () => {
  const book = campaignAt(500);
  let n = openNegotiation(book, {id: 'n', creatorId: 'new-creator', creatorVerifiedTotal: 0});
  n = (step(book, n, 'creator', {action: 'propose', terms: {priceCents: 600, volumeCap: 20}, message: 'New here; $6 for 20.'}, NOW) as {negotiation: typeof n}).negotiation;
  const done = step(book, n, 'founder', {action: 'accept', message: 'Deal.'}, NOW);
  assert.ok(done.ok && done.negotiation.status === 'agreed');
});

test('C1: turns alternate, a message keeps the terms, and the last allowed move must close', () => {
  const book = campaignAt(500);
  let n = openNegotiation(book, {id: 'n', creatorId: creatorY.id, creatorVerifiedTotal: 200});
  assert.deepEqual(options(n, 'founder'), [], 'the creator moves first');
  const go = (side: 'creator' | 'founder', move: Move) => {
    const r = step(book, n, side, move, NOW);
    assert.ok(r.ok, (r as {reason?: string}).reason);
    n = r.negotiation;
  };
  go('creator', {action: 'propose', terms: {priceCents: 800, volumeCap: 60}, message: '$8 for 60.'});
  go('founder', {action: 'message', message: 'What is your audience like?'});
  assert.deepEqual(n.onTable, {priceCents: 800, volumeCap: 60}, 'a message leaves the terms on the table');
  assert.equal(n.proposedBy, 'creator');
  go('creator', {action: 'message', message: 'Indie founders, mostly.'});
  assert.deepEqual(options(n, 'founder'), ['propose', 'message', 'accept', 'reject']);
  while (n.history.length < MAX_TURNS - 1) go(n.turn, {action: 'message', message: 'Still thinking.'});
  assert.deepEqual(options(n, n.turn), n.proposedBy === n.turn ? ['reject'] : ['accept', 'reject']);
  assert.equal(step(book, n, n.turn, {action: 'message', message: 'One more?'}, NOW).ok, false);
});

test('C2: the platform applies the market rules and nothing about the owners\' limits', () => {
  const book = campaignAt(500);
  let n = openNegotiation(book, {id: 'n', creatorId: creatorY.id, creatorVerifiedTotal: 200});
  assert.equal(step(book, n, 'creator', {action: 'propose', terms: {priceCents: 1_100, volumeCap: 40}, message: 'Pricey.'}, NOW).ok, false, 'above the campaign\'s maximum');
  assert.equal(step(book, n, 'founder', {action: 'propose', terms: {priceCents: 600, volumeCap: 40}, message: 'Me first.'}, NOW).ok, false, 'out of turn');
  const cheap = step(book, n, 'creator', {action: 'propose', terms: {priceCents: 100, volumeCap: 40}, message: 'Whatever you like.'}, NOW);
  assert.ok(cheap.ok, 'a low price is the creator agent\'s choice, not the platform\'s');
  n = cheap.negotiation;
  assert.equal(step(book, n, 'creator', {action: 'accept', message: 'Yes.'}, NOW).ok, false, 'nobody accepts their own terms');
  assert.ok(step(book, n, 'founder', {action: 'accept', message: 'Yes.'}, NOW).ok);
});

test('an agent\'s own guardrail keeps it inside its owner\'s limit and stops it revealing the limit', () => {
  const mandates: Mandates = {creator: {minPriceCents: 640}, founder: {maxPriceCents: 760, maxVolume: 40}};
  const propose = (priceCents: number, message: string): Move => ({action: 'propose', terms: {priceCents, volumeCap: 40}, message});
  assert.match(ownLimitProblem('creator', propose(900, 'I can go as low as $6.40.'), null, [], mandates.creator)!, /private limit/);
  assert.equal(ownLimitProblem('creator', propose(900, 'Others got $16.40 elsewhere.'), null, [], mandates.creator), null, '$16.40 is not $6.40');
  assert.equal(ownLimitProblem('creator', propose(640, 'I propose $6.40 for 40.'), null, [], mandates.creator), null, 'stating your own terms is not a leak');
  assert.match(ownLimitProblem('creator', propose(600, 'Cheap.'), null, [], mandates.creator)!, /below/);
  assert.match(ownLimitProblem('founder', {action: 'accept', message: 'Yes.'}, {priceCents: 800, volumeCap: 40}, [], mandates.founder)!, /above/);
  assert.ok(privateNumbers('founder', mandates.founder).includes('$7.60'));
});

test('C1/C2 property: random mandates with rule negotiators never break the rules', async () => {
  const r = createRng(99);
  let agreed = 0;
  for (let i = 0; i < 300; i++) {
    const publicCents = r.int(3, 9) * 100;
    const book = campaignAt(publicCents);
    const mandates: Mandates = {creator: {minPriceCents: r.int(200, 1_300)}, founder: {maxPriceCents: r.int(publicCents, 1_000), maxVolume: r.int(5, 100)}};
    const out = await run(book, mandates);
    assert.ok(out.negotiation.history.length <= 8);
    if (out.negotiation.status === 'agreed') {
      agreed++;
      const t = out.negotiation.agreed!;
      assert.ok(t.priceCents >= mandates.creator.minPriceCents && t.priceCents <= mandates.founder.maxPriceCents && t.priceCents <= 1_000);
      assert.ok(t.volumeCap <= mandates.founder.maxVolume);
      assert.ok(out.book.deals[creatorY.id]);
    } else {
      assert.equal(out.book, book, 'C4');
    }
  }
  assert.ok(agreed > 30 && agreed < 270, `both outcomes exercised (${agreed} agreed of 300)`);
});

// --- Claude negotiator with a fake client ----------------------------------

class FakeClient implements JsonClient {
  readonly usage = emptyUsage();
  readonly prompts: string[] = [];
  constructor(private readonly reply: (req: JsonRequest<unknown>, n: number) => unknown) {}
  async json<T>(req: JsonRequest<T>): Promise<JsonResult<T>> {
    this.prompts.push(`${req.purpose}\n${req.user}`);
    const checked = req.validate.safeParse(this.reply(req as JsonRequest<unknown>, this.prompts.length));
    return checked.success ? {ok: true, value: checked.data, model: 'fake'} : {ok: false, error: 'output failed validation'};
  }
}

test('S10: Claude negotiators never see the other side\'s limits, and a leaking message is retried', async () => {
  const book = campaignAt(500);
  const mandates: Mandates = {creator: {minPriceCents: 640}, founder: {maxPriceCents: 770, maxVolume: 45}};
  let leaked = false;
  const client = new FakeClient((req) => {
    if (req.purpose === 'negotiate.creator') {
      // First attempt leaks the floor; after feedback it does not.
      if (!leaked) { leaked = true; return {action: 'propose', price_cents: 900, volume_cap: 45, message: 'My floor is $6.40, but I want $9.'}; }
      return {action: 'propose', price_cents: 720, volume_cap: 45, message: 'I can do $7.20 for 45 sign-ups given my track record.'};
    }
    return {action: 'accept', price_cents: 0, volume_cap: 0, message: 'Deal.'};
  });
  const agent = new ClaudeNegotiator(client);
  const out = await run(book, mandates, agent, agent);
  assert.equal(out.negotiation.status, 'agreed');
  assert.ok(out.events.some(e => e.side === 'creator' && e.refused && /private limit/.test(e.refused)), 'leak refused');
  const creatorPrompts = client.prompts.filter(p => p.startsWith('negotiate.creator'));
  const founderPrompts = client.prompts.filter(p => p.startsWith('negotiate.founder'));
  for (const p of creatorPrompts) assert.ok(!p.includes('$7.70') && !p.includes('45 sign-ups from one creator'), 'creator never sees the founder\'s limits');
  for (const p of founderPrompts) assert.ok(!p.includes('$6.40'), 'founder never sees the creator\'s floor');
  assert.ok(creatorPrompts.some(p => p.includes('was refused')), 'the retry carries the reason');
  for (const t of out.negotiation.history) assert.ok(!t.message.includes('$6.40'), 'no accepted message reveals the floor');
});

test('a Claude negotiator that is unavailable falls back to the rules', async () => {
  const down: JsonClient = {usage: emptyUsage(), json: async () => ({ok: false, error: 'connection error'})};
  const agent = new ClaudeNegotiator(down);
  const mandates: Mandates = {creator: {minPriceCents: 650}, founder: {maxPriceCents: 750, maxVolume: 50}};
  const viaClaude = await run(campaignAt(500), mandates, agent, agent);
  const viaRules = await run(campaignAt(500), mandates);
  assert.deepEqual(viaClaude.negotiation.agreed, viaRules.negotiation.agreed);
});

// Keep the view type in use so a change to it shows up here.
const _view: Partial<NegotiationView> = {side: 'creator'};
void _view;
