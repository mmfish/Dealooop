// The private negotiation channel: C1–C5 and S8–S10 from docs/ACCEPTANCE.md.
// (tests/negotiation.test.ts is the inherited Muse offer engine.)

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyAgentProposal, createCampaign, recordConversion, settle, verifyConversion, type Book} from '../core/campaign.ts';
import {openNegotiation, privateNumbers, step, NegotiationError, type Mandates, type Move} from '../core/negotiation.ts';
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

/** A negotiator that plays a fixed script of moves, one per call. */
class Script implements Negotiator {
  readonly name = 'script';
  calls = 0;
  constructor(private readonly moves: Move[]) {}
  async move(): Promise<Move> { return this.moves[Math.min(this.calls++, this.moves.length - 1)]; }
}

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

test('C5: creators below the threshold cannot open a negotiation', () => {
  assert.throws(() => openNegotiation(campaignAt(500), {id: 'n', creatorId: 'small', creatorVerifiedTotal: 49}), (e: unknown) => e instanceof NegotiationError && e.code === 'NOT_ELIGIBLE');
});

test('C1: at most two rounds, and the founder cannot counter in the last one', async () => {
  const book = campaignAt(500);
  const mandates: Mandates = {creator: {minPriceCents: 600}, founder: {maxPriceCents: 900, maxVolume: 80}};
  const creator = new Script([
    {action: 'propose', terms: {priceCents: 900, volumeCap: 80}, message: 'Opening.'},
    {action: 'propose', terms: {priceCents: 850, volumeCap: 80}, message: 'Counter.'},
  ]);
  // The founder keeps trying to counter; in round 2 that is refused, and the runner rejects for it.
  const founder = new Script([{action: 'propose', terms: {priceCents: 700, volumeCap: 60}, message: 'Counter.'}]);
  const out = await run(book, mandates, creator, founder);
  const accepted = out.negotiation.history;
  assert.ok(accepted.length <= 4, `C1: ${accepted.length} moves`);
  assert.ok(accepted.every(t => t.round <= 2));
  const refused = out.events.filter(e => e.refused);
  assert.ok(refused.some(e => e.side === 'founder' && /last round/.test(e.refused!)), 'round-2 counter refused');
  assert.equal(out.negotiation.status, 'failed');
});

test('C2: agents cannot propose or accept outside their own owner\'s mandate', () => {
  const book = campaignAt(500);
  const mandates: Mandates = {creator: {minPriceCents: 700}, founder: {maxPriceCents: 750, maxVolume: 40}};
  let n = openNegotiation(book, {id: 'n', creatorId: creatorY.id, creatorVerifiedTotal: 200});
  const below = step(book, n, 'creator', {action: 'propose', terms: {priceCents: 650, volumeCap: 40}, message: 'Cheap.'}, mandates, NOW);
  assert.equal(below.ok, false);
  const overCac = step(book, n, 'creator', {action: 'propose', terms: {priceCents: 1_100, volumeCap: 40}, message: 'Pricey.'}, mandates, NOW);
  assert.equal(overCac.ok, false);
  const ok = step(book, n, 'creator', {action: 'propose', terms: {priceCents: 800, volumeCap: 60}, message: 'Fair.'}, mandates, NOW);
  assert.ok(ok.ok);
  n = ok.negotiation;
  const tooHigh = step(book, n, 'founder', {action: 'accept', message: 'Yes.'}, mandates, NOW);
  assert.equal(tooHigh.ok, false, 'founder cannot accept $8 above its $7.50 ceiling, nor 60 sign-ups above 40');
  const outOfTurn = step(book, n, 'creator', {action: 'accept', message: 'Yes.'}, mandates, NOW);
  assert.equal(outOfTurn.ok, false);
});

test('C3: a message that reveals the sender\'s own limit is refused; disclosed terms are fine', () => {
  const book = campaignAt(500);
  const mandates: Mandates = {creator: {minPriceCents: 640}, founder: {maxPriceCents: 760, maxVolume: 40}};
  const n = openNegotiation(book, {id: 'n', creatorId: creatorY.id, creatorVerifiedTotal: 200});
  const leak = step(book, n, 'creator', {action: 'propose', terms: {priceCents: 900, volumeCap: 40}, message: 'I can go as low as $6.40.'}, mandates, NOW);
  assert.equal(leak.ok, false);
  assert.match((leak as {reason: string}).reason, /private limit/);
  const nearMiss = step(book, n, 'creator', {action: 'propose', terms: {priceCents: 900, volumeCap: 40}, message: 'Others got $16.40 elsewhere.'}, mandates, NOW);
  assert.ok(nearMiss.ok, '$16.40 is not $6.40');
  const disclosed = step(book, n, 'creator', {action: 'propose', terms: {priceCents: 640, volumeCap: 40}, message: 'I propose $6.40 for 40.'}, mandates, NOW);
  assert.ok(disclosed.ok, 'stating the terms you propose is not a leak, even if they equal your limit');
  assert.ok(privateNumbers('founder', mandates).includes('$7.60'));
});

test('C1/C2 property: random mandates with rule negotiators never break the rules', async () => {
  const r = createRng(99);
  let agreed = 0;
  for (let i = 0; i < 300; i++) {
    const publicCents = r.int(3, 9) * 100;
    const book = campaignAt(publicCents);
    const mandates: Mandates = {creator: {minPriceCents: r.int(200, 1_300)}, founder: {maxPriceCents: r.int(publicCents, 1_000), maxVolume: r.int(5, 100)}};
    const out = await run(book, mandates);
    assert.ok(out.negotiation.history.length <= 4);
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
  const client = new FakeClient((req, n) => {
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
  assert.ok(creatorPrompts.some(p => p.includes('refused by the platform')), 'the retry carries the core\'s reason');
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
