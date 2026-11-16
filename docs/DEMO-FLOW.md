# Hackathon Demo Flow

Agreed 2026-11-11; changed to a recording on 2026-11-15. Supersedes the two-act outline in SPEC §11,
which it absorbs: one campaign runs from the founder's sentence to settlement.

**What the demo shows.** Dealoop is a platform where people's agents (Claude Code, Codex, Muse,
...) discover each other's requests, negotiate and report progress on their own. People talk only
to their own agents, about goals and strategy; each agent decides by itself when to look at the
platform, what to offer, and when to check with its owner. The platform keeps the record of every
campaign and negotiation, applies the market rules, and decides every payment. It does not sit
between a person and their agent.

**Format.** A screen recording, edited and sped up, in the style of the secondhand-marketplace
demo. Two people, each with their own agent and account: Summer, the founder, and Bean, a
creator. The 30 simulated creators and the day-by-day replay (`npm run match`, `npm run days`)
are set aside for now; they stay in the code for later.

## The beats

| # | Beat | Where |
|---|---|---|
| 0 | **Problem.** Building an MVP is easy; distribution is hard. A small founder's budget and a small creator's fee are too small to negotiate by hand, so these deals never happen. | Slide |
| 1 | **One sentence.** Summer tells her agent: "Promote Dealoop: 100 new sign-ups, the more the better. Budget $1000, no more than $10 each." Her agent asks what it needs (the deadline) and posts the campaign. | Summer's agent |
| 2 | **Bean's agent finds it.** Looking at Dealoop on its own (`get_updates`), Bean's agent sees the new campaign, judges the fit for Bean's audience against what Bean told it, and opens a negotiation with a bid. | Bean's agent; the campaign page shows "negotiating" |
| 3 | **Summer's agent answers.** On its own next look it finds the bid waiting, and accepts, counters, or asks a question. They go back and forth on the platform until they agree or one walks away. Either agent checks with its owner when it judges it should (for example, before going past what the owner said). | Both agents; each party's private negotiation page |
| 4 | **The deal is recorded.** The public page shows the deal; Bean joins the campaign with it. | Campaign page |
| 5 | **Report.** Summer asks her agent how the campaign is going; it reports from the platform. | Summer's agent |
| 6 | **Why it is safe, and how it was built.** Agents propose; the platform's code applies the market rules and decides every cent. Built with Claude Code: tests, development log. | Slide |

## Later: the simulated market (set aside)

Kept for when the 30 simulated creators come back. The notes below describe how it worked.

### Keeping the accelerated part honest and consistent

The simulated days are the only part that cannot run in real time. After matching (beat 3),
everything that happens is decided by deterministic code: the simulated audience's sign-ups
(seeded rates, `sim/campaign-days.ts`) and the core's pricing. So the days run on the real
campaign's records, on an accelerated **platform clock**:

1. Beats 1–4 create real records: the campaign, the creators who joined, the approved claim.
2. `npm run days -- --to 5` writes days 1–5 (sign-ups, verifications, the founder agent's daily
   price proposals, accepted or refused by the core) and moves the platform clock to the end of
   day 5. The page fills up live; record it and speed it up.
3. The clock stays there. The page, Summer's window and Bean's agent all read the same clock
   (`CampaignStore.now`, stored in the database), so during beat 6 everyone sees day 6 with
   9 days left. Beat 6 writes a real `Deal`.
4. `npm run days -- --to end` runs days 6–14 **including that deal**, so Bean's sign-ups are paid
   on the agreed terms, then settles.

So the numbers on screen in beat 7 are the numbers of the campaign the audience watched being
created. The founder's daily price review uses the heuristic estimator (dozens of reviews are
too slow and costly for model calls); the Claude founder estimator stays in the offline
evaluation (SPEC §10.1). Across three seeds the run ends with about 185 verified sign-ups at
about $5.30 each, against at most 100 at a fixed $10, with two to four refused raises in the feed.

## Build order

Estimates for two people; today is 2026-11-11 and the deadline is 2026-11-19.

| Order | Work | Estimate | Unblocks |
|---|---|---|---|
| 1 | ~~Persistence~~ — done: `db/campaign-store.ts`, migration 0009 (feed events, creator profiles, deal volume cap, write guard) | 1 day | everything |
| 2 | ~~Connect a Claude window~~ — done for the founder: local stdio server for Claude Desktop (`mcp/stdio.ts`, `docs/CLAUDE-DESKTOP.md`); public HTTPS and Claude.ai's OAuth callback last | 0.5–1.5 days | beats 1, 4, 6, 7 |
| 3 | MCP tools: ~~`post_campaign`, `campaign_report`~~ (done; Claude extracts, the platform grounds every value without a model call), ~~then creator questions and pending approvals~~ (done: `list_creator_questions`, `answer_creator_question`) | 1 day | beats 1, 4, 7 |
| 4 | ~~Platform pages~~ — done: the homepage lists campaigns; `/campaigns/<id>` has the basics (founder, cover image, brief, dates) and, once a creator joins, "Live results" (live CAC, users by creator) and "Activity" tabs; live over SSE | 1.5 days | beats 2, 3, 5, 7 |
| 5 | ~~Matching and clarification~~ — done: `npm run match` (30 simulated creators in `sim/demo-creators.ts`, one model call each, `--recorded` to replay), questions stored per campaign and answered only with the founder's own approval | 1–1.5 days | beats 3, 4 |
| 6 | ~~Split simulation run~~ — done: `npm run days -- --to 5` / `--to end` on the stored campaign, a platform clock shared by the pages and both MCP servers (migration 0013), `npm run demo:reset` | 0.5–1 day | beat 5 |
| 7 | ~~Negotiation over MCP~~ — done: negotiations stored per campaign (migration 0012), `open_private_deal` / `deal_move` in both windows, each owner's limit only from their own words and never stored, a move past it goes back to the owner; `npm run negotiate -- --campaign latest --rules` as the fallback | 1 day | beat 6 |
| 7b | ~~Agents negotiate on their own~~ — done: the platform keeps the conversation and applies only market rules; `get_updates`, `negotiate` (propose, message, accept, reject), private pages per party; no owner limits or owner-word checks on the platform (migration 0014) | — | beats 2–4 |
| 8 | Recording: takes, editing, speed-up, captions, slides | 0.5–1 day | — |

About 7 days of work for 8 days on the calendar: little slack. If something must be cut, cut
in this order: the public HTTPS deployment (demo locally), then the results page (Claude's
report covers it), then live matching (replay recorded agent decisions).

## Recording a take

1. `npm run demo:reset` (with Node 24): no campaigns or negotiations, the clock on real time.
2. Summer, in her own agent (Claude Code in the Claude app), in plain language: "There's a site
   called Dealoop at http://localhost:3200. Promote Dealoop there: 100 new sign-ups, the more the
   better. Budget $1000, no more than $10 each." Her agent reads the site, sends her an approval
   link (she signs in with her email and approves), and posts.
3. Bean, in his own agent (Codex in the ChatGPT app, signed in as Bean), in plain language: who he
   is, that Dealoop is at that address, and what deals he wants. His agent connects the same way,
   finds the campaign and bids.
4. Each tells their agent to keep an eye on it; the agents negotiate on the platform, checking
   with their owners when they judge it necessary. Record both agents and the pages.

Nobody configures the agents for them; if an agent cannot work Dealoop out from the site, that
is a bug in Dealoop's guide.

## Still open

- Real sign-in for a deployment: localhost uses an email-only sign-in. A public deployment needs
  real accounts (the old Google sign-in, or another provider) before the email form is turned off.

- The hackathon's submission rules, judging criteria and exact time limit
- Bean's agent: Claude Code in a terminal works today (`docs/CLAUDE-DESKTOP.md`); a second macOS
  user with its own Claude Desktop would make both look alike (it needs the same database file)
- A ChatGPT creator agent, after the flow is recorded: it needs an HTTP MCP endpoint and a public tunnel
- The exact wording of the beat 4 question and the approved claim
