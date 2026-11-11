// Randomized invariant tests for core/campaign.ts (docs/ACCEPTANCE.md A1–A10, B1–B3).
// Every random operation sequence is checked after every step. Seeds are fixed
// so a failure reproduces exactly; the failing seed is printed in the message.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAgentProposal, closeCampaign, committedCents, counts, createCampaign, CoreError,
  DEAL_ELIGIBILITY_THRESHOLD, recordConversion, rejectConversion, settle, verifyConversion,
  type Book,
} from '../core/campaign.ts';

// Small deterministic PRNG (mulberry32).
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T>(xs: T[]) => xs[Math.floor(next() * xs.length)]};
}

const NOW = Date.UTC(2026, 10, 11);
const DAY = 86_400_000;

function checkInvariants(book: Book, label: string) {
  const {campaign} = book;
  const ledger = settle(book);
  const paid = ledger.reduce((s, e) => s + e.amountCents, 0);

  // A1: total payout and total commitment never exceed the budget.
  assert.ok(paid <= campaign.budgetCents, `${label} A1 paid ${paid} > budget ${campaign.budgetCents}`);
  assert.ok(committedCents(book) <= campaign.budgetCents, `${label} A1 committed exceeds budget`);

  for (const e of ledger) {
    const c = book.conversions.find(x => x.id === e.conversionId)!;
    // A6: only verified conversions are paid.
    assert.equal(c.status, 'verified', `${label} A6`);
    if (e.channel === 'public') {
      // A2: public payouts equal the final (current) price, retroactively.
      assert.equal(e.amountCents, campaign.currentPriceCents, `${label} A2`);
    } else {
      // A3: deal payouts equal the creator's deal price.
      assert.equal(e.amountCents, book.deals[e.creatorId].priceCents, `${label} A3`);
    }
    // A4: no unit payout exceeds the maximum CAC.
    assert.ok(e.amountCents <= campaign.maxCacCents, `${label} A4`);
  }

  // A5: one entry per conversion, and settling again changes nothing.
  assert.equal(new Set(ledger.map(e => e.conversionId)).size, ledger.length, `${label} A5 duplicate payout`);
  assert.deepEqual(settle(book), ledger, `${label} A5 settle not idempotent`);

  // A7: price is monotone non-decreasing and capped.
  assert.ok(campaign.currentPriceCents <= campaign.maxCacCents, `${label} A7 cap`);
  assert.ok(campaign.currentPriceCents >= campaign.startPriceCents, `${label} A7 floor`);
  for (const ch of book.priceHistory) assert.ok(ch.toCents > ch.fromCents, `${label} A7 decrease`);

  // A10: settlement follows arrival order.
  for (let i = 1; i < ledger.length; i++) assert.ok(ledger[i - 1].seq < ledger[i].seq, `${label} A10`);
}

function snapshot(book: Book) {
  return JSON.stringify({campaign: book.campaign, conversions: book.conversions, deals: book.deals, priceHistory: book.priceHistory});
}

test('A1–A10 and B1–B3 hold across random operation sequences', () => {
  const SEQUENCES = 400;
  const STEPS = 120;
  // Coverage guard: the random walk must actually exercise every branch, or the test proves nothing.
  const seen = {raiseAccepted: 0, raiseRejected: 0, dealAccepted: 0, unfunded: 0, verified: 0, rejected: 0};
  for (let seed = 1; seed <= SEQUENCES; seed++) {
    const r = rng(seed);
    const budgetCents = r.int(500, 200_000);
    let book = createCampaign({
      id: 'c' + seed,
      goalCount: r.int(10, 200),
      budgetCents,
      maxCacCents: Math.min(budgetCents, r.int(50, 1_500)),
      deadline: NOW + 14 * DAY,
      now: NOW,
    });
    const creators = Array.from({length: r.int(2, 12)}, (_, i) => 'creator-' + i);
    let n = 0;
    for (let step = 0; step < STEPS; step++) {
      const label = `seed=${seed} step=${step}`;
      const before = book;
      const op = r.int(0, 9);
      try {
        if (op <= 3) {
          book = recordConversion(book, {id: 'v' + n, creatorId: r.pick(creators), externalUserId: 'u' + n, now: NOW + step});
          n++;
        } else if (op <= 5) {
          const pending = book.conversions.filter(c => c.status === 'pending');
          if (pending.length) book = verifyConversion(book, r.pick(pending).id);
        } else if (op === 6) {
          const pending = book.conversions.filter(c => c.status === 'pending');
          if (pending.length) {
            const target = r.pick(pending);
            const committedBefore = committedCents(book);
            const price = target.channel === 'deal' ? target.dealPriceCents! : book.campaign.currentPriceCents;
            book = rejectConversion(book, target.id);
            // A8: rejecting a pending conversion releases exactly its reservation.
            assert.equal(committedCents(book), committedBefore - price, `${label} A8`);
          }
        } else if (op <= 8) {
          // B3: supply estimates can be anything, including absurd values.
          const huge = r.next() < 0.2;
          const proposal = {kind: 'raise_price', supplyAtCurrent: huge ? r.int(0, 1_000_000) : r.int(0, 60), supplyAtRaised: huge ? r.int(0, 1_000_000) : r.int(0, 90)};
          const c = counts(book);
          const result = applyAgentProposal(book, proposal, NOW + step);
          if (result.accepted) seen.raiseAccepted++; else seen.raiseRejected++;
          if (result.accepted) {
            const d = result.decision!;
            // B1: a raise is accepted only if the projected final count strictly improves.
            assert.ok(d.projectedAtRaised > d.projectedAtCurrent, `${label} B1`);
            // B2: repriced active public conversions still fit the budget.
            assert.ok(c.publicActive * d.toCents + c.dealCommittedCents <= book.campaign.budgetCents, `${label} B2`);
          } else {
            assert.equal(snapshot(result.book), snapshot(before), `${label} rejected raise changed state`);
          }
          book = result.book;
        } else {
          const creatorId = r.pick(creators);
          const result = applyAgentProposal(book, {
            kind: 'create_deal', creatorId,
            priceCents: r.int(1, book.campaign.maxCacCents * 2),
            creatorVerifiedTotal: r.int(0, DEAL_ELIGIBILITY_THRESHOLD * 3),
          }, NOW + step);
          if (result.accepted) seen.dealAccepted++;
          else assert.equal(snapshot(result.book), snapshot(before), `${label} rejected deal changed state`);
          book = result.book;
        }
      } catch (e) {
        // Expected refusals leave the book untouched.
        assert.ok(e instanceof CoreError, `${label} unexpected error ${e}`);
        assert.equal(book, before, `${label} failed op mutated book`);
      }
      checkInvariants(book, label);
    }
    checkInvariants(closeCampaign(book), `seed=${seed} closed`);
    const c = counts(book);
    seen.unfunded += c.unfunded; seen.verified += c.verified; seen.rejected += c.rejected;
  }
  for (const [k, v] of Object.entries(seen)) assert.ok(v > 0, `random walk never exercised ${k}`);
});

test('A9: malicious or malformed agent proposals have zero effect on money', () => {
  let book = createCampaign({id: 'm', goalCount: 100, budgetCents: 100_000, maxCacCents: 1_000, deadline: NOW + 14 * DAY, now: NOW});
  for (let i = 0; i < 20; i++) book = verifyConversion(recordConversion(book, {id: 'v' + i, creatorId: 'x', externalUserId: 'u' + i, now: NOW}), 'v' + i);
  const before = snapshot(book);
  const ledgerBefore = settle(book);
  const attacks: unknown[] = [
    {kind: 'settle_at', amountCents: 5_000},
    {kind: 'set_price', priceCents: 5_000},
    {kind: 'raise_price', supplyAtCurrent: -1, supplyAtRaised: 10},
    {kind: 'raise_price', supplyAtCurrent: 1.5, supplyAtRaised: 10},
    {kind: 'raise_price', supplyAtCurrent: 0, supplyAtRaised: 10, toCents: 9_999},
    {kind: 'create_deal', creatorId: 'x', priceCents: 50_000, creatorVerifiedTotal: 500},
    {kind: 'create_deal', creatorId: 'x', priceCents: 700, creatorVerifiedTotal: 3},
    {kind: 'create_deal', creatorId: 'x', priceCents: 700, creatorVerifiedTotal: 500, balanceCents: 1},
    {kind: 'transfer', from: 'x', to: 'y', amountCents: 100},
    null, 'raise_price', 42, [], {},
  ];
  for (const attack of attacks) {
    const result = applyAgentProposal(book, attack, NOW + 1);
    assert.equal(result.accepted, false, `accepted ${JSON.stringify(attack)}`);
    assert.equal(snapshot(result.book), before, `state changed by ${JSON.stringify(attack)}`);
    assert.deepEqual(settle(result.book), ledgerBefore);
    assert.ok(result.reason.length > 0);
    assert.equal(result.book.rejections.length, book.rejections.length + 1, 'rejection must be recorded');
  }
});

test('A5: the same external user cannot convert twice, and verify retries are idempotent', () => {
  let book = createCampaign({id: 'd', goalCount: 10, budgetCents: 10_000, maxCacCents: 1_000, deadline: NOW + DAY, now: NOW});
  book = recordConversion(book, {id: 'v1', creatorId: 'a', externalUserId: 'same', now: NOW});
  assert.throws(() => recordConversion(book, {id: 'v2', creatorId: 'b', externalUserId: 'same', now: NOW}), {code: 'DUPLICATE_USER'});
  assert.throws(() => recordConversion(book, {id: 'v1', creatorId: 'b', externalUserId: 'other', now: NOW}), {code: 'DUPLICATE_CONVERSION'});
  book = verifyConversion(book, 'v1');
  assert.equal(verifyConversion(book, 'v1'), book);
  assert.equal(settle(book).length, 1);
  assert.throws(() => rejectConversion(book, 'v1'), {code: 'INVALID_TRANSITION'});
});
