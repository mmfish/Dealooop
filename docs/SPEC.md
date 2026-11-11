# Dealoop MVP Specification (one page)

Version: 2026-11-11 · Target: hackathon submission on 11/19

## 1. What it is

A promotion marketplace that pays per verified conversion. A founder states a goal in one
sentence, and the platform turns it into a public campaign. Creators' agents join on their
own and promote with tracked links. Every verified conversion is settled immediately.

The MVP proves one thing: **spend the budget within the maximum CAC, and get more users than a
fixed price would.**

## 2. Why agents

Each transaction is tiny (around $5) and there are many of them (tens to hundreds of creators).
A human platform can therefore only handle standardized, large-grained deals, so long-tail
micro-promotion never happens. Agents bring the cost of each transaction close to zero, which
is what makes these transactions exist at all.

Agents make judgments; they do not keep the books. See §7.

## 3. Roles

| Role | Controlled by | What it does |
|---|---|---|
| Founder agent | Founder | Turns a one-sentence goal into a campaign; estimates supply for pricing |
| Creator agent | Creator | Decides whether to join; gets a tracked link; top creators may negotiate |
| Platform | Deterministic code | Attribution, budget, settlement, state machine, invariants |

## 4. Core flow

1. The founder says: "Help my app get 100 new sign-ups, the more the better. Budget $1000, CAC no more than $10."
2. The founder agent parses this into a campaign. **The deadline is required**; if it is missing the agent must ask, never guess.
3. The campaign enters the public pool at its starting price.
4. Creator agents see the current unit price, remaining budget and deadline, decide whether to join, and get a tracked link.
5. A user signs up through the link → a `pending` conversion is recorded.
6. Verification passes → the conversion becomes `verified` and is owed at the **current public price**.
7. The price is recalculated every tick (6 hours). It only goes up, and a raise **applies retroactively to every verified conversion**.
8. The campaign closes at the deadline or when the budget runs out, and settles at the final price.

## 5. Data model

Implemented in `db/schema.ts` (migration `drizzle/0008_campaigns.sql`):

```
campaigns            id, owner_id, title, brief, product_url, goal_count, budget_cents,
                     max_cac_cents, start_price_cents, step_cents, current_price_cents,
                     deadline, status, next_seq
campaign_links       id, campaign_id, creator_id, token
conversions          id, campaign_id, link_id, creator_id, external_user_id, seq,
                     status (pending|verified|rejected|unfunded), channel (public|deal),
                     deal_price_cents
campaign_deals       campaign_id, creator_id, price_cents, offer_id   # private negotiation channel
price_changes        campaign_id, from_cents, to_cents, rationale
proposal_rejections  campaign_id, actor, kind, reason               # shown in the UI
ledger_entries       id, campaign_id, conversion_id (unique), creator_id, seq, channel, amount_cents
```

`conversions.seq` increases within a campaign, and **settlement follows it**.

## 6. Pricing algorithm (the core of the MVP)

Constants (configurable):

- `start_price = round(0.3 × max_cac)`
- `step = round(0.1 × max_cac)`
- `tick = 6 hours` (originally 1 day; see the simulator sensitivity results in §10: 24 hours climbs too slowly in thin markets, 2 hours lets noise push the price too high)

Every tick:

1. Estimate `supply(p, d)`: how many more conversions the campaign will get at price p over the remaining time d. **The agent does this step.** Its input is the conversion history; its output is an estimate.
2. Compute the expected final user count for both choices:

   ```
   projected(p) = min(current_count + supply(p, d),  budget / p)
   ```

3. Raise the price only if `projected(p + step) > projected(p)`.
4. Before raising, the budget must still hold:

   ```
   (verified_count + pending_count) × (p + step) ≤ budget
   ```

   If it does not, the price stays.

5. The price is always `≤ max_cac` and **never decreases**.

**Why a retroactive uniform price**: because the price only rises and everyone gets the same
price, creators who join early are never worse off for moving first, so nobody has a reason to
wait for a raise. The cost is that a raise also spends budget on conversions that already
happened, which is why the check in step 4 cannot be skipped. (In practice step 3 already
implies step 4; the explicit check stays as a guard. See `core/campaign.ts`.)

## 7. Where the agent ends and the ledger begins

| Given to Claude | Given to deterministic code |
|---|---|
| One sentence → campaign fields | Attribution (link → creator) |
| Estimating `supply(p, d)` | The final decision to raise or not (§6 steps 3 and 4) |
| The creator's "should I join, is it worth it" judgment | Budget commitment and settlement |
| Concession strategy and wording in negotiation | Validating and storing the deal |

**Agents never write to the ledger.** They only produce proposals, which code validates before
acting on them. A proposal that fails validation is refused, and the reason is recorded (the
demo shows this).

## 8. How pending conversions hold budget

Pending conversions hold budget at the **current price**, and count in the §6 step 4 check
just like verified ones.

- pending → verified: the hold becomes an amount owed.
- pending → rejected: the hold is released.

This prevents over-issuing during the verification window, which would otherwise overspend at
settlement.

**Admission control**: when a new conversion is recorded, if "budget already held + this
conversion's unit price > budget", it is marked `unfunded` at that moment and never paid
(`recordConversion` in `core/campaign.ts`).

## 9. Private negotiation channel (P0-lite, may drop to P1)

A creator with `verified_conversion_total ≥ 50` may have their agent open a negotiation:

- Issues: unit price, guaranteed volume, deadline, tiered bonuses
- At most 2 rounds; each side carries a mandate (the creator's minimum take-home, the founder's price flexibility), hidden from the other side
- The agreed price is `≤ max_cac` and becomes a `Deal`; that creator is then paid at the deal price, and the public price is unaffected
- Neither side's private constraints may be revealed (there are tests for this)

## 10. Simulator and comparison

The code is in `sim/`; run it with `npm run sim`. Each seed generates a synthetic market: every
creator has a hidden minimum price, a daily conversion rate and a capacity. A creator's rule is
"promote once the current price meets my minimum" (with a retroactive uniform price, waiting
gains nothing). Verification lags 24 hours and rejects 5%. Every strategy faces the same markets
and the same random arrivals, so differences come from pricing alone.

**All of this data is synthetic.** The distributions are assumptions set in advance, not
measurements of real creators.

Results as of 2026-11-11 (100 seeds; brief: 100 users / $1000 / max CAC $10 / 14 days; 6-hour tick):

| Market | Strategy | Mean users | Avg CAC | Goal met | Beats fixed $10 |
|---|---|---|---|---|---|
| baseline (30 creators, $3–$12) | **Dynamic** | **114.5** | $8.70 | 100% | 82% |
| | Fixed $10 | 100.0 | $10.00 | 100% | — |
| | Fixed $8 (best in hindsight; a founder cannot know this in advance) | 117.9 | $8.00 | 87% | 87% |
| thick (80 creators, $2–$10) | **Dynamic** | **210.3** | $4.74 | 100% | 100% |
| | Fixed $4 (best in hindsight) | 212.7 | $4.00 | 100% | 100% |
| thin (12 creators, $5–$14) | Dynamic | 25.5 | $10.00 | 0% | 23% |
| | Fixed $10 (best in hindsight) | 27.2 | $10.00 | 0% | — |

How to read this table:

- **The dynamic price needs no knowledge of the market** and still comes close to the best fixed price, which is only knowable in hindsight. In the baseline market it also meets the goal more reliably (fixed $8 reaches 100 users in only 87% of runs; dynamic does in 100%). This is the pitch, not "14% more than $10".
- **In a thin market the dynamic price does slightly worse than offering $10 from the start**: the first day or two go into climbing, and this market cannot reach 100 users even at $10. The mechanism cannot create supply out of nothing. The pitch should say this up front.
- The price only rises, so an early raise caused by noise cannot be undone. With a very short tick (2 hours) this makes the baseline result worse.

Supply estimation currently uses a transparent heuristic (`HeuristicEstimator` in
`sim/estimator.ts`: it measures the conversion rate over the last 48 hours and **assumes** a
price elasticity of 1.5). A Claude-backed estimator implements the same interface; see §7.

### 10.1 The simulator with Claude agents

`npm run sim:claude` runs one campaign where Claude plays two roles, through the same interfaces
the heuristic simulator uses:

- **Founder agent, pricing analyst** (`agents/founder-estimator.ts`). Every 6-hour tick it gets
  only what the platform observes (sign-ups per price level, distinct creators, time and budget
  left) and forecasts supply at the current price and one step up. The core decides.
- **Creator agents** (`agents/creator-agent.ts`). Each knows its own owner's profile and private
  floor, and decides whether to join at each new price level. Above the floor it judges audience
  fit, as a creator would. A "yes" below the floor is overruled in code.

Both ask for JSON through structured outputs, validated again with zod. A failed, refused or
invalid answer falls back to the heuristic or the floor rule and is marked in the log. Models
default to `claude-opus-5-5` with server-side refusal fallbacks; tests use a fake client and never
call the network.

**First full run, 2026-11-11** (seed 1, baseline market, 30 creators, 14 days): 258 calls, none
failed, about $1.47 at list price, 5½ minutes.

| Strategy | Users | Avg CAC |
|---|---|---|
| Claude founder + Claude creators | 100 | $10.00 |
| Heuristic founder + threshold creators (the plain simulator) | 111 | $9.00 |
| Fixed $10 + threshold creators | 100 | $10.00 |

That first comparison is misleading. **Claude creators declined poor-fit campaigns even above
their floor** (a home-cooking or gaming audience does not suit Dealoop), so only 15 of 30 ever
joined, against 21 under the threshold rule. The market itself was thinner. `sim/replay.ts`
replays the recorded creator decisions without API calls, which holds supply fixed and isolates
pricing:

| Same supply (Claude creators' decisions replayed) | Users |
|---|---|
| Claude founder | **100** |
| Heuristic founder | 91 |
| Fixed $9 (best fixed in hindsight) | 103 |
| Fixed $10 | 100 |

On the same supply the Claude founder beat the heuristic founder (100 vs 91) and came within 3
users of the best fixed price in hindsight. **This is one seed**; it is an example, not evidence.
Two observations worth keeping:

- With no data, both founders raise at every early tick. Claude says so plainly ("low-confidence
  priors"), which reads well in the demo, but it does not climb any faster or slower.
- Creator fit judgments change the economics: a realistic market has fewer willing creators at
  every price than the threshold model assumes. The §10 numbers are optimistic for that reason.

Prompt fix after the first run: with Dealoop as the seed product, two creator agents described a
"conflict of interest" because they took themselves to be part of Dealoop. The system prompt now
says the agent works only for the creator. A later small run showed no such lines.

## 11. Demo: two acts

**Act 1 · Scale (simulator).** Headless Claude agents drive about 30 synthetic creators on a
compressed timeline, running 14 days in a few minutes. A dashboard shows users, average CAC,
budget used, and the comparison with fixed $10 (§10). The argument: with near-zero
transaction costs, long-tail micro-deals become viable.

**Act 2 · Human-in-the-loop negotiation (Claude windows).** This reuses the format of the
Muse demo: a few Claude windows (the founder and a top creator). Each owner authorizes their
agent in natural language; the agent acts on its own within its mandate, and **goes back to
its owner when something falls outside the mandate** (for example, "They want $7, which is
above your floor. Accept?"). Once confirmed, it becomes a `Deal` (§9). This act connects to the
platform's MCP through Claude.ai / Claude Desktop custom connectors; see §15 for the
requirements.

- The seed campaign is **promoting Dealoop itself** (which also answers the cold-start question)
- About 30 creator agents, one of whom meets the negotiation threshold
- In Act 2 the founder and the creator are two separate Claude sessions, each connected to their own account

**The Act 1 dashboard** is at `/sim` (`app/sim/`, data from `sim/dashboard-data.ts`). It plays a
recorded Claude run (or a heuristic run for seeds 1–5) tick by tick: sign-ups against the goal and
the price per sign-up, each against fixed $10, as two charts on a shared time axis (no dual axis);
KPI tiles at the playhead; the agents' decisions with filters; and the final comparison against
fixed prices on the same supply. It never calls the API. Chart colors are the dataviz reference
palette's first two slots, validated for colorblind separation and contrast in light and dark.
Every value shown in a tooltip is also in the table view.

## 12. Preconditions (state these in the pitch)

- The platform has already solved cold start; both sides have enough participants
- Anti-fraud verification of conversions already exists
- Settlement and compliance (money movement, tax, ad disclosure) already exist

## 13. Out of scope

Explicitly not built, but mentioned in the pitch as directions for expansion:

- Batches / reservations / quota claiming
- Referral and dispatch overrides (their right home is **the platform's own growth campaign**, not a founder's campaign)
- Surplus sharing, quality bonuses
- Platform fee model (fixed at 0 in the MVP)
- Founders with a hard cap on quantity (the MVP treats every founder as "the more the better")
- Blacklists, enforcement, dispute resolution
- Real social-platform API integration (the roster is fake data)
- Real payments and payouts

## 14. Still open

- The hackathon's submission requirements and judging criteria
- How Act 2 gets a public address (tunnel or deployment), which decides `DEALOOP_ORIGIN`

## 15. Claude connector requirements (Act 2)

From Claude's official documentation,
[Authentication for connectors](https://claude.com/docs/connectors/building/authentication),
checked 2026-11-11:

| Requirement | Current state (inherited from Muse) |
|---|---|
| Callback `https://claude.ai/api/mcp/auth_callback` (shared by web, Desktop, mobile); the docs say it may move to `https://claude.com/api/mcp/auth_callback`, so allow both | **Not met**: `backend/oauth.ts` only accepts the hard-coded Muse callback; registration requires `redirect_uris` to equal it exactly |
| Dynamic Client Registration (DCR) or CIMD | DCR exists (`/oauth/register`) but is tied to the previous row |
| PKCE S256; the token endpoint accepts `application/x-www-form-urlencoded` | S256 exists; the tests call `/oauth/token` form-encoded, so this is met |
| Authorization requests carry `resource`, which must exactly match the MCP URL the user entered (path included) | Resource binding exists |
| Unauthenticated requests get `401` with `WWW-Authenticate: Bearer resource_metadata=...` | Met (checked against the running service): an unauthenticated `/mcp` returns `401` with `WWW-Authenticate: Bearer resource_metadata=...`, and the metadata's `resource` is the `/mcp` URL |
| Refresh tokens rotate; an invalid one returns `invalid_grant` | Rotation and `invalid_grant` exist |
| Discovery, registration and token endpoints answer within 10 seconds; refresh within 30 | Local SQLite; expected to be met |
| The service must be **public HTTPS**, must not redirect to another host, and must not resolve to a private address | **Not met**: it only runs on localhost today |
| If allowlisting by IP, Anthropic's egress range is `160.79.104.0/21` | Not needed yet |
| Claude Code uses a loopback callback (`http://localhost:<port>/callback`) on any port | Not required for Act 2; support it while we are there |

`DEALOOP_ORIGIN` must equal the public address the user enters in Claude, or the `resource`
check fails.
