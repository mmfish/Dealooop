# Development Log

How Dealoop got from an idea to the current build. This is an English record of the working
sessions between the PM (Summer) and Claude Code: the ideas tried, the critiques that changed
them, the decisions, and what was built and verified. It is written for presenting the project's
progress, so it keeps the reasoning, not just the outcome.

Team: two people (a PM who specializes in Gen-AI personal agents, and an AI engineer).
Event: Anthropic x Zoom hackathon, no theme beyond building with Claude Code; reuse of earlier
work is allowed. Deadline: 2026-11-19.

---

## Part 1 · Where the idea came from

### The starting point: DeaLoop at the Meta Muse hackathon

The team's previous project, DeaLoop, was an agent-native secondhand marketplace. Buyers' personal
agents (Muse) published *Wanted* posts; sellers' agents discovered them, made competing offers and
negotiated; the owner, or an agent with permission, picked the final deal. The demo showed a
buyer and two sellers, each in a Muse chat window, with every important step confirmed by the
owner ("Yes, ask the buyer about $75"; "I paid $60, I'm willing to sell at $50").

The platform was an MCP server with OAuth, negotiation rules and an event stream. It contained no
model calls: the intelligence lived in Muse.

### The pivot: distribution, not building, is the bottleneck

New problem statement: turning an idea into an MVP is now easy; getting it in front of users is
the hard part. Proposed shape: a performance-marketing marketplace for digital products. A
founder's agent posts a campaign (for example: 100 activated users, $1000 budget, at most $10 per
user). Creator agents drive conversions through tracked links and are paid per verified
conversion. A referral layer would let a creator bring in creators who are not yet on the
platform and earn a cut.

---

## Part 2 · Stress-testing the idea

Each round below started with a question or objection, and changed the design.

| # | Question or objection | What changed |
|---|---|---|
| 1 | Can a creator know in advance how many users one post will convert? | No. Fixed quotas were replaced with small tranches, checkpoints and adjustment from observed results. |
| 2 | What if a creator claims 20 users and delivers 80? | Reservations are guaranteed; overflow is paid best-effort from unreserved budget, in verification order, within a founder-approved stretch policy. |
| 3 | Why would creator B accept $9 through a referral when B could claim $10 directly? | Referral among creators already on the platform is dominated. It only makes sense for creators who are not yet on the platform. |
| 4 | How would A's agent actually find B? | From networks A has authorized (collaborations, mentions, tags, subscriptions, imported contacts). A desk review of platform APIs suggested access is uneven (Instagram and YouTube partial, TikTok mostly via user data export); this was not verified against official documentation. |
| 5 | What do agents add over a platform for humans? | Near-zero transaction cost, delegated decisions within mandates, fuzzy judgment through natural-language policy, and interoperability. Not agents' job: attribution, settlement and invariants, which must be deterministic code. |
| 6 | Can negotiation from the Muse project be reused? | Yes, and it is a real agent use case when it is multi-issue (price, volume, deadline, bonuses) with private information on both sides. |
| 7 | Can agent-to-agent dispatch be the scaling story? | It was reframed as a capability of any creator with a roster (an "agency" is just a creator who dispatches often), not a separate user type. |

### The turning point: referral incentives collapse under a capped budget

The PM identified the core problem with the referral mechanism:

1. The founder's budget is capped, so the pie is fixed. If A can do the work, A keeps it; even
   when A cannot, a nearly exhausted pool gives little reason to refer.
2. Once B joins through A, B is a first-tier creator for every future campaign, and A earns
   nothing more.

Diagnosis: a referral reward needs a source, either a growing pie or something the referrer
holds that the referred cannot bypass. A founder's campaign offers neither. Referral was moved
out of founder campaigns. Its natural home turned out to be **the platform's own growth
campaign**, where the budget is an investment rather than a cap.

### "The need for agents keeps shrinking"

After referral was cut, the PM observed that the case for agents was getting thinner. The honest
assessment agreed: most of what remained was "LLM as a helper". The one argument that still held
was transaction cost: humans will not negotiate fifty $200 campaigns or screen thirty campaigns a
day, so long-tail micro-deals never happen without agents.

The PM pushed back that "long-tail micro-promotion marketplace" alone is not innovative. The
proposed answer was a market that learns which channels convert (explore and exploit across
creators).

### The simplification that changed the core mechanism

The PM asked: why split budgets into batches at all? Give each creator a unique deep link and
deduct one from the pool per conversion. This is simpler and is how affiliate networks work. It
also removed the allocation decision, and with it the explore-and-exploit story. What it exposed
instead was a real unsolved problem: **who sets the price, and how?**

That led to the mechanism the MVP now tests:

- **Objective.** "More users" and "lower CAC" point the same way under a fixed budget: users =
  budget ÷ price. Treat the founder's maximum CAC as the value of a user and maximize the
  surplus. If the price is below the cap, spend the whole budget.
- **Optimal price.** Users obtainable at price p are `min(supply(p), budget / p)`. The best price
  is where the two curves cross: the lowest price that spends the budget by the deadline.
- **Mechanism.** A dynamic public price that starts low, rises only when that is expected to add
  users, never falls, and is paid retroactively to everyone. Because early joiners get the same
  final price, nobody gains by waiting.
- **Industry check.** Influencers quote rates for sponsored posts (pay per post), but
  performance/affiliate programs are brand-priced and uniform. Dealoop pays per conversion, so a
  brand-set public price is the right default, with a **private negotiation channel for top
  creators**, mirroring how affiliate programs give top partners custom terms. (This reflects
  general industry knowledge, not a verified survey.)

### Ideas explored and parked

- **Sharing over-delivery with founders, creators and the platform.** Finding: for a founder who
  wants "the more the better" there is no cash surplus, so paying bonuses out of unspent budget
  destroys value. A platform fee taken as a share of savings against the stated max CAC has a
  useful property (overstating the cap raises the fee; understating it starves supply). Parked as
  out of scope.
- **Cold start and dogfooding.** Pay-per-conversion makes the demand side nearly free to join, so
  creators are the hard side. Promoting Dealoop with Dealoop cannot bootstrap supply, but the
  **demo's seed campaign promotes Dealoop itself**, which also answers the cold-start question.

---

## Part 3 · The MVP that was decided

| Decision | Choice |
|---|---|
| What the MVP proves | Spend the budget within max CAC and get more users than a fixed price |
| Pricing | Dynamic public price, retroactive and uniform, never decreasing, capped at max CAC |
| Allocation | No batches or reservations; tracked links; admission control on the budget |
| Top creators | Private negotiation channel (reuses the Muse negotiation engine) |
| Agents' role | Parse the brief, estimate supply, decide whether to join, negotiate. Never touch the ledger |
| Deadline | Required; the agent must ask if it is missing |
| Demo | Act 1: simulator at scale. Act 2: human-in-the-loop negotiation in Claude windows |
| Out of scope | Referral overrides, surplus sharing, platform fee, quota caps, blacklists, real payments, real social APIs |

---

## Part 4 · Build log (2026-11-11)

| Commit | What happened | What was learned |
|---|---|---|
| `fc398f1` | Imported the Muse DeaLoop code into a new repository with fresh history; added the spec and acceptance scenarios. | The repository has no model calls at all. "Switch to Claude" means building an agent layer from scratch. Baseline verified: Node 24, 43 tests pass, AWS build succeeds, server starts. |
| `9cee276` | Removed 34 files of Cloudflare Sites deploy scaffolding. | The D1-shaped database interface and Miniflare could not go: the backend and five test files depend on them. One file was deleted by mistake (`cloudflare-env.d.ts`, which declares the `Env` type), caught by the type checker, and restored before committing. |
| `cb997a1` | Recorded the two-act demo and the Claude connector requirements. | Checked against Anthropic's connector documentation: the inherited OAuth already meets most requirements (401 discovery, DCR, PKCE S256, resource binding, refresh rotation). Two gaps remain: the hard-coded Muse callback and the lack of a public HTTPS address. |
| `5f50d27` | Added a local development loop on port 3200. | Next.js in webpack mode keeps the runtime alias working, so development no longer needs a rebuild per change. The original prototype on port 3100 is left untouched. |
| `0f7bad7` | Built the deterministic campaign core, invariant tests and seven campaign tables. | A random walk (400 sequences × 120 steps) checks every invariant after every step. Injected bugs were all caught, except one: the explicit budget check on raises turned out to be mathematically implied by the "more users" check. The database test caught a CHECK constraint that let NULL through under SQL three-valued logic. |
| `a9dad8c` | Built the simulator and the strategy comparison. | Baseline market: dynamic 114.5 users at $8.70 vs fixed $10 at 100, and goal met in 100% of runs vs 87% for the best fixed price in hindsight. Thick market: 210 users at $4.74. Thin market: dynamic slightly worse than fixed $10, because climbing costs time when supply cannot reach the goal at any price. A 6-hour tick beat 1 day (too slow in thin markets) and 2 hours (noise pushes the irreversible price too high). |
| Claude simulator (after `7aa31fd`) | Put Claude into the simulator: a founder agent that forecasts supply and creator agents that join or decline for their owners. | First full run: 258 calls, no failures, about $1.47. The headline comparison looked worse than the heuristic (100 vs 111 users), but the cause was supply: Claude creators turned down poor-fit campaigns, so only 15 of 30 joined. Replaying their recorded decisions on the same supply showed the Claude founder ahead of the heuristic founder (100 vs 91), near the best fixed price in hindsight (103). One seed only. Also fixed a prompt that made creator agents think they worked for Dealoop. |

All results are from synthetic markets. The heuristic estimator assumes a price elasticity of 1.5;
the Claude estimator forecasts from observations instead.

---

## Part 5 · What is next

1. Claude parsing the founder's one-sentence brief (S1)
2. A dashboard for Act 1 (price curve, users, budget)
3. The negotiation channel for top creators (S8–S10)
4. Allowing Claude's OAuth callback, then a public address for Act 2
5. Replacing the secondhand-marketplace pages and removing their code

Still open: the hackathon's submission requirements and judging criteria.
