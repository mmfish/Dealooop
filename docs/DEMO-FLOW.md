# Hackathon Demo Flow

Agreed 2026-11-11; changed to a recording on 2026-11-15. Supersedes the two-act outline in SPEC §11,
which it absorbs: one campaign runs from the founder's sentence to settlement.

**Format.** A screen recording, not a live demo: both sides' conversations are recorded ahead of
time, then edited and sped up, in the style of the secondhand-marketplace demo. Two people, two
Claude windows: Summer plays the founder, Yi plays the top creator. Both use Claude for now;
a ChatGPT creator agent may come later, on top of a working flow. Every other creator is a
simulated agent, labeled as such. The seed campaign promotes Dealoop itself. The beat times
below are for the finished video; the recording itself can take as long as it needs.

## The beats

| # | Time | Beat | Where | How it is made |
|---|---|---|---|---|
| 0 | 0:00–0:15 | **Problem.** Building an MVP is easy; distribution is hard. A small founder's budget and a small creator's fee are too small to negotiate by hand, so these deals never happen. | Slide | — |
| 1 | 0:15–0:30 | **One sentence.** The founder tells their Claude: "Promote Dealoop: 100 new sign-ups, the more the better. Budget $1000, no more than $10 each." Claude asks the one thing missing, the deadline, then posts the campaign. | Founder's Claude window | Recorded conversation |
| 2 | 0:30–0:40 | **The request appears** on the platform's campaign list and event feed. | Platform page | Recorded page |
| 3 | 0:40–0:55 | **Matching.** About 30 creator agents read the campaign and join or decline on audience fit ("cooking channel, wrong audience"). | Platform feed | `npm run match`: one live run (about $0.20), recorded |
| 4 | 0:55–1:10 | **Clarification with a human in the loop.** One creator agent asks a question the brief does not answer ("Can I say it's free?"). The founder agent cannot authorize a claim on its own, so it asks the founder in their Claude window; the founder approves a wording, and the creator joins. | Founder's window + feed | Recorded conversation |
| 5a | 1:10–1:30 | **The market runs, days 1–5,** on an accelerated clock: sign-ups by creator, the price rising when the core approves a raise. | Platform page | `npm run days -- --to 5`, recorded and sped up |
| 6 | 1:30–2:10 | **Top creator deal.** The clock pauses. Yi's creator agent (200 verified sign-ups in earlier campaigns) opens a private negotiation. Countered terms go past Yi's floor, so the agent asks Yi; Yi confirms. The deal is recorded; the public price is unchanged. | Both Claude windows | Recorded conversations, edited side by side |
| 5b | 2:10–2:25 | **Days 6–14** with the deal in place, then the campaign closes and settles. | Platform page | `npm run days -- --to end`, recorded and sped up |
| 7 | 2:25–2:45 | **Results.** The founder asks their Claude "How did it go?"; Claude reports sign-ups, average CAC and the comparison with a fixed $10, and links the results page (payout per creator). | Founder's window + results page | Recorded conversation |
| 8 | 2:45–3:00 | **Why it is safe, and how it was built.** Agents propose; deterministic code decides every cent (refused proposals are visible in the feed). Built with Claude Code: tests, development log. | Slide / feed | — |

The two human-in-the-loop moments are deliberately different: beat 4 is about **content**,
approved by the founder; beat 6 is about **price**, approved by the creator.

## Keeping the accelerated part honest and consistent

The simulated days are the only part that cannot run in real time. After matching (beat 3),
everything that happens is decided by deterministic code: the simulated audience's sign-ups
(seeded rates, `sim/campaign-days.ts`) and the core's pricing. So the days run on the real
campaign's records, on an accelerated **platform clock**:

1. Beats 1–4 create real records: the campaign, the creators who joined, the approved claim.
2. `npm run days -- --to 5` writes days 1–5 (sign-ups, verifications, the founder agent's daily
   price proposals, accepted or refused by the core) and moves the platform clock to the end of
   day 5. The page fills up live; record it and speed it up.
3. The clock stays there. The page, Summer's window and Yi's window all read the same clock
   (`CampaignStore.now`, stored in the database), so during beat 6 everyone sees day 6 with
   9 days left. Beat 6 writes a real `Deal`.
4. `npm run days -- --to end` runs days 6–14 **including that deal**, so Yi's sign-ups are paid
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
| 8 | Recording: takes, editing, speed-up, captions, slides for beats 0 and 8 | 0.5–1 day | — |

About 7 days of work for 8 days on the calendar: little slack. If something must be cut, cut
in this order: the public HTTPS deployment (demo locally), then the results page (Claude's
report covers it), then live matching (replay recorded agent decisions).

## Recording a take

1. `npm run demo:reset`: no campaigns, the clock on real time, the creators seeded (Yi with 200
   verified sign-ups). The database is backed up to `data/backups/` first.
2. Beats 1–2 in Summer's Claude Desktop window; open the campaign page.
3. `npm run match` (live, about $0.20; save the run). A retake can replay it with
   `npm run match -- --recorded <file>`, so the matching looks the same in every take.
4. Beat 4 in Summer's window.
5. `npm run days -- --to 5` while recording the page.
6. Beat 6: Yi's window (Claude Code: `claude --strict-mcp-config --mcp-config data/yi-mcp.json`)
   and Summer's window, recorded separately and edited side by side.
7. `npm run days -- --to end` while recording the page; then beat 7 in Summer's window.

If an agent goes off script, reset and retake; there is no audience to recover in front of.
In the edit, slow down at the two human-in-the-loop moments and caption them ("past Yi's floor,
so his agent asks him"; "the public price stays the same").

## Still open

- The hackathon's submission rules, judging criteria and exact time limit
- Yi's window: Claude Code in a terminal works today; a second macOS user with its own Claude
  Desktop would make both windows look alike (it needs read and write access to the same database file)
- A ChatGPT creator agent, after the flow is recorded: it needs an HTTP MCP endpoint and a public tunnel
- The exact wording of the beat 4 question and the approved claim
