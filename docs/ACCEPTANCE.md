# Invariants and Acceptance Scenarios

Every invariant has at least one test. **Write these tests first, then the implementation.**

Status as of 2026-11-11: A1–A10, B1–B3, C5, S1–S7 are tested (`tests/core-*.test.ts`,
`tests/db-campaigns.test.ts`, `tests/sim.test.ts`). C1–C4 and S8–S10 wait for the negotiation
channel.

## A. Ledger invariants (must hold after any sequence of operations)

| # | Invariant | What the test checks |
|---|---|---|
| A1 | A campaign's total payout ≤ `budget_cents` | Asserted after thousands of random conversion and pricing sequences |
| A2 | Every public-channel payout = the campaign's final price | Old conversions must also equal the new price after a raise |
| A3 | Every payout to a creator with a `Deal` = the deal price | |
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

| # | Invariant |
|---|---|
| C1 | At most 2 rounds |
| C2 | The agreed price is within both sides' mandates |
| C3 | Neither agent's output contains the other side's private constraints (minimum take-home / price flexibility) |
| C4 | If no deal is reached, the creator falls back to the public price with no side effects |
| C5 | Only creators with `verified_conversion_total ≥ 50` may open a negotiation |

---

## Acceptance scenarios

### S1 · Campaign from one sentence
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
**When** Y's agent negotiates and reaches $7 with a 50-user guarantee within 2 rounds
**Then** a `Deal` is created, Y is paid $7, the public price stays $5, and C1–C4 hold.

### S9 · Negotiation fails
**Given** creator Y's minimum take-home is $12 > `max_cac` $10
**When** 2 rounds of negotiation run
**Then** there is no deal, Y falls back to the public price and may choose not to join, and the campaign is unaffected.

### S10 · Private constraints do not leak
**Given** every agent output across the whole negotiation
**When** the text is checked
**Then** it contains neither side's minimum take-home nor price flexibility values.
