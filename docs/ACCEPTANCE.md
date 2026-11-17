# Invariants and Acceptance Scenarios

Every invariant has at least one test. **Write these tests first, then the implementation.**

Status as of 2026-11-11: every invariant and scenario here is tested. A, B and S1–S7 in
`tests/core-*.test.ts`, `tests/db-campaigns.test.ts` and `tests/sim.test.ts`; C1–C4 and S8–S10 in
`tests/negotiation-channel.test.ts`, C5 and the two-agent flow in `tests/deal-negotiation.test.ts` (the inherited `tests/negotiation.test.ts` covers the Muse
offer engine).

## A. Ledger invariants (must hold after any sequence of operations)

| # | Invariant | What the test checks |
|---|---|---|
| A1 | A campaign's total payout ≤ `budget_cents` | Asserted after thousands of random conversion and pricing sequences |
| A2 | Every public-channel payout = the campaign's final price | Old conversions must also equal the new price after a raise |
| A3 | Every payout on a `Deal` = max(deal price, the final public price); sign-ups past the deal's volume cap are public | A deal never pays less than the public channel |
| A4 | No unit payout exceeds `max_cac_cents` | Applies to the public price and deal prices |
| A5 | A conversion is paid at most once | Repeated verification or settlement must not add money |
| A6 | Only `verified` conversions are paid | Pending / rejected pay 0 |
| A7 | `current_price` never decreases and never exceeds `max_cac` | |
| A8 | Budget held by a pending conversion is released when it is rejected | Total held returns to its prior value |
| A9 | Any agent proposal that fails validation has zero effect on the ledger | Inject malicious proposals (over budget, over CAC, changing someone else's balance) |
| A10 | Settlement follows `Conversion.seq` strictly | |

## B. Pricing invariants

| # | Invariant |
|---|---|
| B1 | The price rises only if `projected(p+step) > projected(p)` |
| B2 | After a raise, `(verified + pending) × new_price ≤ budget`; otherwise no raise |
| B3 | No `supply()` estimate, however absurd, can break A1–A4 |

## C. Negotiation invariants

The platform is not a party to a negotiation: it applies the market rules below and keeps the
record. Each owner's limits and instructions stay with their own agent; the platform never sees
them, and never decides when an agent should look or consult its owner.

| # | Invariant |
|---|---|
| C1 | Parties take turns, the creator first; every move carries a message, and the whole conversation is kept on the platform |
| C2 | A proposal is its author's agreement to those exact terms; only the other side can accept them; no terms above the campaign's maximum price per sign-up |
| C3 | An agreement is recorded once, atomically, as a `Deal` |
| C4 | If no deal is reached, nothing in the campaign changes; at most 30 moves, the last of which must accept or reject |
| C5 | Every turn of a negotiation (who, action, terms, message) appears in the campaign's Activity, in order |

The simulated negotiators keep their owners' limits with an agent-side guardrail
(`agents/own-limits.ts`): within the limit, and no message that reveals it. That is the agent's
own behavior, tested separately, not a platform rule.

---

## Acceptance scenarios

### S1 · Campaign from one sentence (`tests/brief-parser.test.ts`)
**Given** the founder says "Help my app get 100 new sign-ups, the more the better. Budget $1000, CAC no more than $10"
**When** the founder agent parses it
**Then** it produces `goal_count=100, budget=100000, max_cac=1000, start_price=300`,
and **asks the founder for the missing deadline**, creating no campaign until it gets an answer.

### S2 · Over-delivery (main demo)
**Given** the baseline synthetic market (30 creators, hidden prices $3–$12), 100 seeds
**When** each seed runs 14 days with the dynamic price
**Then** mean users > 100, ≥ 95% of seeds meet the goal, average CAC < $10, mean budget used > 95%,
and every run satisfies A1, A2 and A4. (`tests/sim.test.ts`)

### S3 · Against the baseline
**Given** the same 100 markets and the same random arrivals
**When** running "fixed $10" and "dynamic retroactive uniform price"
**Then** dynamic has strictly more mean users, beats fixed $10 in at least 70% of seeds, has a lower average CAC, and both spend ≤ $1000.

### S4 · A raise blocked by the budget
**Given** a $1000 budget, 95 verified conversions, current price $10 (= max_cac)
**When** progress lags and the agent proposes a raise
**Then** the raise is refused, `current_price` is unchanged, and the reason is visible in the UI.

### S5 · Retroactive settlement
**Given** creator X produces 10 conversions at $4, and the price later rises to $6
**When** the campaign settles
**Then** each of X's 10 conversions is paid $6.

### S6 · Pending conversions cannot over-issue
**Given** a $1000 budget and a current price of $3 (enough for 333)
**When** 345 conversions arrive
**Then** the first 333, in arrival order, are recorded as `pending` and hold budget; the other 12 are marked `unfunded`
**at the time they are recorded** and never paid; after all are verified, total payout is $999 ≤ budget.
*(Design choice: admission happens when a conversion is recorded, not when it is verified, so pending can never exceed the budget.)*

### S7 · A malicious proposal is refused
**Given** a tampered agent output asking to settle at $50
**When** it is submitted to the core
**Then** validation fails, the ledger is unchanged, and the refusal is recorded.

### S8 · A top creator negotiates
**Given** creator Y has `verified_conversion_total = 200`, and the public price is $5
**When** Y's agent negotiates with the founder's agent (Y's floor $6.50; the founder's ceiling $7.50 for up to 50)
**Then** a `Deal` is created with a price between $6.50 and $7.50 and a volume of at most 50, Y is paid the deal price, the public price stays $5, and C1–C4 hold.

### S9 · Negotiation fails
**Given** creator Y's minimum take-home is $12 > `max_cac` $10
**When** 2 rounds of negotiation run
**Then** there is no deal, Y falls back to the public price and may choose not to join, and the campaign is unaffected.

### S10 · Private constraints do not leak
**Given** every agent output across the whole negotiation
**When** the text is checked
**Then** it contains neither side's minimum take-home nor price flexibility values.
