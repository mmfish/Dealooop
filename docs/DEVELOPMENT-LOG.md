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
| Act 1 dashboard (after `69b77b4`) | Built `/sim`: playback of a campaign with sign-ups and price charts against fixed $10, KPI tiles, the agents' decisions with filters, and the final comparison. | Browser checks caught four problems before commit: the default run was a 6-creator trial instead of the full run; end-of-line labels collided; the last point showed 99 sign-ups while settlement paid 100 (conversions finish verification after the deadline); and a CSS rule meant for the charts stretched the tooltip keys. Light, dark and phone widths verified. |
| Negotiation channel (after `ba5c78a`) | Built the private deal channel: a deterministic protocol enforcing C1–C5, Claude negotiators for both sides, a rule-based fallback, and `npm run negotiate`. Deals gained a volume cap and now never pay less than the public price. | Changing deal pay to max(deal, public) broke the A8 invariant test, which still assumed the old price: the random walk caught the semantic change immediately. Mutation checks (removing the last-round rule, the leak check, or the mandate check) each failed the suite. First live run: $9.00 × 60 → $6.50 × 40 → $7.25 × 40 → accepted, 4 calls, about $0.05. |
| Brief parsing (after `630d270`) | Built the founder agent's intake: one sentence in, campaign fields out, or a question when something required is missing. `npm run brief`. | The design choice was to make Claude quote the words behind every value and let code reject anything it cannot find in the text, so a helpful guess becomes a question. Live: the S1 sentence was asked for its deadline; the Chinese version produced the same campaign; a brief with no CAC was asked for one instead of getting $2.50 computed. Under a cent per call. |

| Campaign store (after `33f80ae`) | Agreed the demo flow (`docs/DEMO-FLOW.md`): one campaign, live from the founder's sentence to settlement. Built its first dependency: `db/campaign-store.ts` persists the core's `Book`, with a feed of events, creator profiles and a write guard. Migration 0009. | A randomized test applies the same operations to the database and to an in-memory Book and compares them after every step. Removing the write guard made the cross-process test fail, so it is load-bearing. A probe also found that with only the guard, 25 simultaneous writers in one process left 20 failing after retries; a per-campaign queue fixed that. Drizzle's generated migration copied a column the old table did not have; fixed by hand and checked on a populated 0008 database. |
| Founder's Claude window (after `059cc73`) | A local stdio MCP server for Claude Desktop with founder tools: post a campaign from the founder's own words, list campaigns, report. `npm run mcp:config`. | Claude Desktop runs local servers over stdio from its config, so the demo needs no public address and no OAuth. The Claude in the window does the extraction; the server only checks each value against the founder's quoted words, so it needs no API key. The end-to-end test spawns the server as Claude Desktop does; it caught a result whose status was overwritten by the campaign's own `status` field. |
| Campaign pages (after `76f23ff`) | `/campaigns` and `/campaigns/<id>`: the campaign list, a live activity feed, creators who joined or declined and why, price changes, private deals, and results with per-creator payouts once settled. Built on `db/campaign-view.ts`, which Claude's `campaign_report` now uses too, so the page and the report cannot disagree. | The commit hook that pushes live updates fires only for writes in the web server's own process, but Claude Desktop's server and the simulation write from other processes; the stream polls the database every 500 ms instead, and a test writes through a second connection to prove it. Checked in the browser on a throwaway database, posting through the MCP server as Claude Desktop does: the campaign appeared on the list in about a second without a reload. The check also caught a closed campaign still showing "budget committed" (which counts unverified sign-ups) next to the smaller amount actually paid, a "15 days left" that disagreed with the "14 days" Claude had told the founder, and a date clipped at projector width. |
| Campaign pages in the homepage style | After review, the campaign list became the homepage itself, keeping its logo, layout and styles: the listing grid now shows campaigns (cover, price per sign-up, goal, deadline), and the secondhand-marketplace sidebar, filters and categories are gone. A campaign page has the basics in the old listing-detail layout and, once creators join, a "Live results" tab (live CAC, registered users, users and earnings by creator) and an "Activity" tab. Campaigns gained an optional cover image (migration 0010). | An earlier standalone restyle (new logo, emoji, a dashboard of tiles) was reverted: the brief is to keep the existing style and keep pages simple. The cover image only accepts http(s) URLs or site paths, so a `javascript:` or protocol-relative URL from an agent cannot reach an `<img>`. Live CAC is what is committed so far over pending and verified sign-ups; the per-creator earnings add up to it. |
| Matching and creator questions (demo beats 3–4) | `npm run match`: 30 simulated creators (`sim/demo-creators.ts`) each have their own agent read the live campaign and join, decline with a reason, or ask the founder a question; decisions land in the feed as they are made, and a run can be replayed with `--recorded`. Questions are stored per campaign (migration 0011); the founder's Claude lists them and answers through a preview-then-approve tool, after which the creator joins with that wording. The homepage copy now leads with the founder, and declined creators fold into one line instead of filling the table. | Creators' floors and instructions stay in the seed file, never in the platform's database, and the floor overrules the model in code (a join, or a question that would end in a join, below the floor becomes a decline). The approval check is a real gate, not a formality: the wording must be the one previewed, and the founder's quoted words must be found in their messages and say yes or contain the wording. A test caught the founder's answer showing with the question icon. The browser check used a hand-written recording, so no live matching run has been made yet. |
| Private deal negotiation over MCP (demo beat 6) | The negotiation engine ported from the secondhand marketplace (`core/negotiation.ts`: at most two rounds, a proposal is its author's agreement, no move outside the owner's limit, no message revealing it) now runs on stored campaigns: negotiations are persisted (migration 0012) and an agreement records the Deal and joins the creator in one step. Both windows get tools (`list_deal_negotiations`, `read_deal_negotiation`, `deal_move`; for creators also `join_campaign` and `open_private_deal`). `npm run negotiate -- --campaign latest [--rules]` runs the old Claude or rule-based negotiators against the same store as the fallback. | Each owner's private limit comes from their own quoted words and is held only in their own MCP process, never in the database, so the other side cannot see it and the platform does not need to protect it. A move past the limit returns `needs_your_owner` with the question to ask; only the owner's words can widen it, which is the beat 6 moment on Yi's side. Approvals now refuse a "yes" that comes with a "no" ("not ok", "don't accept"), closing a gap in the beat 4 check too. The end-to-end test runs Summer's and Yi's servers as two processes on one database file. |
| The campaign's days and the platform clock (demo beats 5a, 5b, 7) | `npm run days -- --to 5` and `--to end` run the stored campaign day by day: the creators who joined bring simulated sign-ups at seeded rates, sign-ups are verified a day later (5% fail), the founder agent proposes a raise once a day with the heuristic estimator and the core accepts or refuses it in the feed, creators who declined below their minimum join when the price meets it, and creators stop promoting once the budget cannot pay for another sign-up. The run ends at the deadline with settlement. A platform clock stored in the database (migration 0013) is read by the pages and both MCP servers, so at the pause the page and Yi's and Summer's windows all say day 6 with 9 days left. `npm run demo:reset` starts each recording take clean. The demo moved from a live presentation to a recording (`docs/DEMO-FLOW.md`). | With 0.3–1.1 sign-ups a day per creator the price climbed from $3 to $7 by day 5, above any sensible deal for Yi; at 0.8–2 a day the budget binds around $4–5, which is when a premium private deal makes sense. Across three seeds: about 185 verified sign-ups at about $5.30 each, against at most 100 at a fixed $10. The founder agent re-proposed a refused raise every day, so it now waits two days after a refusal. Without the budget check, 69 unpaid sign-ups filled the feed; now 5–11. The rule-based fallback negotiator fails when the creator's floor is a round $7 (its counter states the floor, which the core refuses as a leak); the demo's Claude negotiators are not affected, and the fallback uses a $6.50 floor. Checked in the browser on a throwaway database: the page fills live, Activity reads in time order, the results banner shows 184 verified sign-ups at $5.42 each. |
| Agents negotiate on their own | Corrected the design: Dealoop is a platform for people's agents, not a go-between for a person and their agent. The platform no longer holds owners' limits, checks owners' words (negotiation, posting, answering questions) or tells an agent when to ask its owner. `core/negotiation.ts` keeps only market rules: turns, a proposal is its author's agreement, only the other side accepts, the campaign's maximum price, at most 30 moves; a `message` move lets agents talk without changing terms. New tools: `get_updates` (the platform remembers how far each agent read and lists what waits on it), `negotiate`, `open_negotiation`, `set_creator_profile`. The conversation is stored on the platform and readable only by the two parties, each through its agent or a private page; the public page shows that they are negotiating and the deal. Yi became Bean. Migration 0014. | The first version made Summer type Bean's offer into her own window, and the platform asked for each owner's limit with a quote of their words. Both were wrong for a platform whose users are autonomous agents. The limit checks moved to the simulated negotiators' own guardrail (`agents/own-limits.ts`), so the rule-based fallback still behaves. Tested with two real MCP processes: Summer posts, Bean's agent finds the campaign through `get_updates` and bids, they counter and ask each other a question, a restarted agent picks up from the platform, and the deal is recorded; the public page leaks no terms or messages (checked in the browser too). |
| Agents connect by themselves | An owner now only tells their agent Dealoop's address. The agent reads `/llms.txt` (rewritten for campaigns, with `/openapi.json` and a `Link` header on `/`), pairs with its owner's approval (the existing device-style pairing: request, owner approves at `/connect`, token), and calls the campaign tools over HTTP (`GET /api/v1/tools` with JSON Schemas, `POST /api/v1/tools/<name>`) or the same tools as MCP at `/api/v1/mcp`, with identity from the token. Roles are gone: anyone posts campaigns and is the founder on them, and negotiates on others' campaigns as a creator. On localhost, sign-in is name and email with no password. The approval page and sidebar copy describe agents, not one Claude window. | Before this, the demo depended on me installing Dealoop into each person's agent (a Claude Desktop entry, a Codex config, launcher scripts), which is exactly what a platform cannot ask of its users; those were removed. The tools stay defined once: the HTTP API collects them from the same registration code the MCP servers use, so the two cannot drift. The old marketplace's Google sign-in cannot work on localhost, so the email form is the local stand-in. Checked end to end in the browser on a throwaway database: an agent requested a connection, a test owner signed in and approved, the agent got its token and its identity. |
| Reset button and campaign pictures | A Reset demo button in the sidebar (localhost only, same-origin) gives a clean start: every campaign, negotiation, deal, sign-in and agent connection is deleted and the browser is signed out, so each agent connects again (`POST /api/v1/demo/reset`, `sim/demo-reset.ts`, also `npm run demo:reset`). `post_campaign` now requires the app's address and description (migration 0015), and the platform draws each campaign a cartoon picture from them: an object chosen from what the app is about, the two-ring Dealoop eyes and a smile, Dealoop's greens, the app's name underneath (`backend/campaign-art.ts`, `/campaigns/<id>/art.svg`). | The pictures are drawn by code rather than an image model: free, instant, the same every time, and in one style, at the cost of variety (six objects). Checked all six by rendering them; LittleMoochi gets a bowl. The live dev server, started by another session before the new column existed, needed the migration applied by hand. |
| Tracked links and live sign-ups | Each creator who joins (or agrees a deal) gets a tracked link, `/r/<token>`: a page standing in for the app's sign-up page, "recommended by" that creator, with an email form (`POST /api/v1/links/<token>/signup`, public, rate-limited, one sign-up per email). `join_campaign` and `read_negotiation` give the creator agent the link. `npm run signups` simulates prospective users signing up through the links in real time and confirms most of them a few seconds later, so the campaign's live results fill up while you watch. Verifying a sign-up now writes a `conversion.verified` event, which the feed folds like recorded ones, so pages also update on verification. | Verification events made the day-by-day replay's feed longer than the page's 200 newest events, so its test now checks all events. A second dev server for a throwaway check could not start next to the running one (Next allows one per folder), so the end-to-end path was checked in tests and the live link page with a request against the running server. |
| Internal test accounts | Three internal test accounts (Summer, Bean, Goldsword) sign in with a fixed code through `POST /api/auth/code`, on any deployment, including where the email-only form is off. Codes are configured only in the environment (`DEALOOP_TEST_USERS`, locally `.env.local`), compared in constant time, rate-limited, and never shown on the site. | A separate "Have a test code?" area on the login page was built and then removed at review: the accounts are for internal use only, so there is no page for them. |
| Negotiations in Activity | Every turn of every negotiation now appears in the campaign's Activity, in time order with the other events: who (`@Goldsword → Summer`, `Summer's agent → @Goldsword`), the action, the terms and the message; messages without terms get their own icon. The turns are read from the stored negotiations, so earlier turns show too, and each move writes a `deal.turn` event so the live page refreshes. | This reverses the earlier choice to keep conversations with the two parties: for the demo, the negotiation is the story to show. The private pages remain. |

All results are from synthetic markets. The heuristic estimator assumes a price elasticity of 1.5;
the Claude estimator forecasts from observations instead.

---

## Part 5 · What is next

1. The build order in `docs/DEMO-FLOW.md`: persistence, the founder's Claude window and the campaign pages are done; matching with clarification, the private deal negotiation and the campaign's days on a shared platform clock are done too; agents now negotiate on their own through the platform; next, a live run with Summer's and Bean's real agents, then the recording (`docs/DEMO-FLOW.md`)
2. Replacing the secondhand-marketplace pages and removing their code

Still open: the hackathon's submission requirements and judging criteria.
