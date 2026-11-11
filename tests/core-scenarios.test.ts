// Acceptance scenarios from docs/ACCEPTANCE.md that the deterministic core owns:
// S1 (deadline required), S4, S5, S6, S7 and C5. S2/S3 need the simulator and
// S8–S10 need the negotiation channel; they live with those modules.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAgentProposal, committedCents, counts, createCampaign, DEAL_ELIGIBILITY_THRESHOLD,
  recordConversion, settle, verifyConversion, type Book,
} from '../core/campaign.ts';

const NOW = Date.UTC(2026, 10, 11);
const DAY = 86_400_000;

// The founder's brief: 100 users, $1000 budget, CAC at most $10.
const brief = {id: 'dealoop-launch', goalCount: 100, budgetCents: 100_000, maxCacCents: 1_000, now: NOW};

function convert(book: Book, n: number, creatorId: string, from = 0, verify = true) {
  for (let i = from; i < from + n; i++) {
    book = recordConversion(book, {id: `${creatorId}-${i}`, creatorId, externalUserId: `${creatorId}-user-${i}`, now: NOW + i});
    if (verify && book.conversions.at(-1)!.status === 'pending') book = verifyConversion(book, `${creatorId}-${i}`);
  }
  return book;
}

test('S1: the brief parses into the expected campaign, and a missing deadline is refused', () => {
  assert.throws(() => createCampaign({...brief}), {code: 'MISSING_DEADLINE'});
  assert.throws(() => createCampaign({...brief, deadline: null}), {code: 'MISSING_DEADLINE'});
  assert.throws(() => createCampaign({...brief, deadline: NOW - 1}), {code: 'INVALID_DEADLINE'});
  const {campaign} = createCampaign({...brief, deadline: NOW + 14 * DAY});
  assert.equal(campaign.goalCount, 100);
  assert.equal(campaign.budgetCents, 100_000);
  assert.equal(campaign.maxCacCents, 1_000);
  assert.equal(campaign.startPriceCents, 300, 'start price is 30% of max CAC');
  assert.equal(campaign.stepCents, 100, 'step is 10% of max CAC');
  assert.equal(campaign.currentPriceCents, 300);
});

test('S4: a raise that would overdraw the budget is refused, with a visible reason', () => {
  // Push the price to the $10 cap first, then fill 95 verified users ($950).
  let book = createCampaign({...brief, deadline: NOW + 14 * DAY});
  for (let i = 0; i < 7; i++) {
    const r = applyAgentProposal(book, {kind: 'raise_price', supplyAtCurrent: 0, supplyAtRaised: 50}, NOW + i);
    assert.ok(r.accepted, r.reason);
    book = r.book;
  }
  assert.equal(book.campaign.currentPriceCents, 1_000);
  book = convert(book, 95, 'a');
  const before = book.campaign.currentPriceCents;
  const r = applyAgentProposal(book, {kind: 'raise_price', supplyAtCurrent: 0, supplyAtRaised: 1_000}, NOW + DAY);
  assert.equal(r.accepted, false);
  assert.equal(r.book.campaign.currentPriceCents, before);
  assert.match(r.reason, /maximum CAC/);
  assert.equal(r.book.rejections.at(-1)!.reason, r.reason, 'the reason is recorded for the UI');

  // Below the cap, the budget guard is what refuses: 300 active users at $3 cannot be repriced to $4.
  let full = createCampaign({...brief, budgetCents: 100_000, deadline: NOW + 14 * DAY});
  full = convert(full, 300, 'b');
  const blocked = applyAgentProposal(full, {kind: 'raise_price', supplyAtCurrent: 0, supplyAtRaised: 500}, NOW + DAY);
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.book.campaign.currentPriceCents, 300);
});

test('S5: a price raise applies retroactively to conversions already verified', () => {
  let book = createCampaign({...brief, deadline: NOW + 14 * DAY});
  book = convert(book, 10, 'x'); // 10 users at $3
  for (let i = 0; i < 3; i++) {
    const r = applyAgentProposal(book, {kind: 'raise_price', supplyAtCurrent: 5, supplyAtRaised: 40}, NOW + DAY + i);
    assert.ok(r.accepted, r.reason);
    book = r.book;
  }
  assert.equal(book.campaign.currentPriceCents, 600);
  const ledger = settle(book);
  assert.equal(ledger.length, 10);
  for (const entry of ledger) assert.equal(entry.amountCents, 600, 'paid at $6, not the $3 price at arrival');
  assert.deepEqual(book.priceHistory.map(h => h.toCents), [400, 500, 600]);
});

test('S5b: a raise that would not bring more users in total is refused', () => {
  let book = createCampaign({...brief, deadline: NOW + 14 * DAY});
  book = convert(book, 10, 'x');
  const r = applyAgentProposal(book, {kind: 'raise_price', supplyAtCurrent: 40, supplyAtRaised: 40}, NOW + DAY);
  assert.equal(r.accepted, false);
  assert.match(r.reason, /not expected to bring more users/);
});

test('S6: conversions beyond the budget are recorded as unfunded and never paid', () => {
  // $1000 at $3 funds 333 users. Send 345.
  let book = createCampaign({...brief, deadline: NOW + 14 * DAY});
  book = convert(book, 345, 'flood', 0, false);
  const c = counts(book);
  assert.equal(c.pending, 333);
  assert.equal(c.unfunded, 12);
  for (const conv of book.conversions.filter(x => x.status === 'pending')) book = verifyConversion(book, conv.id);
  const ledger = settle(book);
  assert.equal(ledger.length, 333);
  assert.equal(ledger.reduce((s, e) => s + e.amountCents, 0), 99_900);
  assert.ok(committedCents(book) <= book.campaign.budgetCents);
  // Funded conversions are the earliest arrivals.
  assert.deepEqual(ledger.map(e => e.seq), Array.from({length: 333}, (_, i) => i + 1));
});

test('S7: a tampered agent output asking to settle at $50 is refused with no ledger change', () => {
  let book = createCampaign({...brief, deadline: NOW + 14 * DAY});
  book = convert(book, 5, 'x');
  const ledger = settle(book);
  const r = applyAgentProposal(book, {kind: 'settle', conversionId: 'x-0', amountCents: 5_000}, NOW + 1);
  assert.equal(r.accepted, false);
  assert.deepEqual(settle(r.book), ledger);
  assert.equal(r.book.rejections.length, 1);
  assert.equal(r.book.rejections[0].kind, 'settle');
});

test('C5 and §9: only creators with enough verified conversions get a deal, and deal prices stay fixed', () => {
  let book = createCampaign({...brief, deadline: NOW + 14 * DAY});
  const tooNew = applyAgentProposal(book, {kind: 'create_deal', creatorId: 'small', priceCents: 700, volumeCap: 50, creatorVerifiedTotal: DEAL_ELIGIBILITY_THRESHOLD - 1}, NOW);
  assert.equal(tooNew.accepted, false);
  const overCap = applyAgentProposal(book, {kind: 'create_deal', creatorId: 'top', priceCents: 1_001, volumeCap: 50, creatorVerifiedTotal: 200}, NOW);
  assert.equal(overCap.accepted, false);
  const ok = applyAgentProposal(book, {kind: 'create_deal', creatorId: 'top', priceCents: 700, volumeCap: 50, creatorVerifiedTotal: 200}, NOW);
  assert.ok(ok.accepted, ok.reason);
  book = convert(ok.book, 4, 'top');
  book = convert(book, 4, 'public');
  const raised = applyAgentProposal(book, {kind: 'raise_price', supplyAtCurrent: 0, supplyAtRaised: 30}, NOW + DAY);
  assert.ok(raised.accepted, raised.reason);
  const ledger = settle(raised.book);
  assert.deepEqual(ledger.filter(e => e.creatorId === 'top').map(e => e.amountCents), [700, 700, 700, 700], 'deal price unaffected by public raises');
  assert.deepEqual(ledger.filter(e => e.creatorId === 'public').map(e => e.amountCents), [400, 400, 400, 400]);
});

test('§9: a deal covers only its volume, and never pays less than the public price', async () => {
  let book = createCampaign({...brief, deadline: NOW + 14 * DAY});
  const deal = applyAgentProposal(book, {kind: 'create_deal', creatorId: 'top', priceCents: 500, volumeCap: 3, creatorVerifiedTotal: 200}, NOW);
  assert.ok(deal.accepted, deal.reason);
  book = convert(deal.book, 5, 'top');
  assert.deepEqual(book.conversions.map(c => c.channel), ['deal', 'deal', 'deal', 'public', 'public'], 'conversions past the cap use the public price');
  // Push the public price above the deal price: deal conversions follow it up.
  for (let i = 0; i < 4; i++) {
    const r = applyAgentProposal(book, {kind: 'raise_price', supplyAtCurrent: 0, supplyAtRaised: 50}, NOW + DAY + i);
    assert.ok(r.accepted, r.reason);
    book = r.book;
  }
  assert.equal(book.campaign.currentPriceCents, 700);
  assert.deepEqual(settle(book).map(e => e.amountCents), [700, 700, 700, 700, 700], 'a $5 deal pays $7 once the public price is $7');
});
