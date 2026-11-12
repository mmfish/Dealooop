# Hackathon Demo Flow

Agreed 2026-11-11. Supersedes the two-act outline in SPEC §11, which it absorbs: one campaign
runs from the founder's sentence to settlement, live wherever possible.

**Format.** A live demo, about 3 minutes. Two presenters, two Claude windows: Summer plays the
founder, Yi plays the top creator. Every other creator is a simulated agent, labeled as such.
The seed campaign promotes Dealoop itself.

## The beats

| # | Time | Beat | Where | Live? |
|---|---|---|---|---|
| 0 | 0:00–0:15 | **Problem.** Building an MVP is easy; distribution is hard. A small founder's budget and a small creator's fee are too small to negotiate by hand, so these deals never happen. | Slide | — |
| 1 | 0:15–0:30 | **One sentence.** The founder tells their Claude: "Promote Dealoop: 100 new sign-ups, the more the better. Budget $1000, no more than $10 each." Claude asks the one thing missing, the deadline, then posts the campaign. | Founder's Claude window | Live |
| 2 | 0:30–0:40 | **The request appears** on the platform's campaign list and event feed. | Platform page | Live |
| 3 | 0:40–0:55 | **Matching.** About 30 creator agents read the campaign and join or decline on audience fit ("cooking channel, wrong audience"). | Platform feed | Live (parallel Claude calls) |
| 4 | 0:55–1:10 | **Clarification with a human in the loop.** One creator agent asks a question the brief does not answer ("Can I say it's free?"). The founder agent cannot authorize a claim on its own, so it asks the founder in their Claude window; the founder approves a wording, and the creator joins. | Founder's window + feed | Live |
| 5a | 1:10–1:30 | **The market runs, days 1–5,** on an accelerated clock: sign-ups by creator, the price rising when the core approves a raise. | Platform dashboard | Replay of a computed run (see below) |
| 6 | 1:30–2:10 | **Top creator deal.** The clock pauses. Yi's creator agent (200 verified sign-ups in earlier campaigns) opens a private negotiation. Countered terms go past Yi's floor, so the agent asks Yi; Yi confirms. The deal is recorded; the public price is unchanged. | Both Claude windows | Live |
| 5b | 2:10–2:25 | **Days 6–14** with the deal in place, then the campaign closes and settles. | Platform dashboard | Replay of a computed run |
| 7 | 2:25–2:45 | **Results.** The founder asks their Claude "How did it go?"; Claude reports sign-ups, average CAC and the comparison with a fixed $10, and links the results page (payout per creator). | Founder's window + results page | Live |
| 8 | 2:45–3:00 | **Why it is safe, and how it was built.** Agents propose; deterministic code decides every cent (refused proposals are visible in the feed). Built with Claude Code: tests, development log. | Slide / feed | — |

The two human-in-the-loop moments are deliberately different: beat 4 is about **content**,
approved by the founder; beat 6 is about **price**, approved by the creator.

## Keeping the accelerated part honest and consistent

The simulated days are the only part that cannot run in real time, but they do not need a
video file. After matching (beat 3), everything that happens is decided by the deterministic
engine — the simulated audience's sign-ups and the core's pricing — so it can be computed in a
second and **replayed in the dashboard on an accelerated clock**, from the real campaign's data:

1. Beats 1–4 create real records: the campaign, the creators who joined, the approved claim.
2. When beat 5a starts, the engine computes days 1–5 for that campaign and the dashboard plays
   them back.
3. Beat 6 writes a real `Deal`.
4. Beat 5b computes days 6–14 **including that deal**, so the outcome reflects what was
   actually agreed live, then plays them back and settles.

So the numbers on screen in beat 7 are the numbers of the campaign the audience watched being
created. A screen recording of beats 5a/5b is kept only as a backup.

The founder's per-tick pricing uses the heuristic estimator during the live run (dozens of
ticks are too slow for live model calls). The Claude founder estimator stays in the
offline evaluation (SPEC §10.1) and can be mentioned there.

## Build order

Estimates for two people; today is 2026-11-11 and the deadline is 2026-11-19.

| Order | Work | Estimate | Unblocks |
|---|---|---|---|
| 1 | ~~Persistence~~ — done: `db/campaign-store.ts`, migration 0009 (feed events, creator profiles, deal volume cap, write guard) | 1 day | everything |
| 2 | Connect a Claude window to the local MCP server (Claude Desktop with a local MCP bridge first; public HTTPS and Claude.ai's OAuth callback last) | 0.5–1.5 days | beats 1, 4, 6, 7 |
| 3 | MCP tools: `create_campaign` (brief parsing on the server), `answer_creator_question` / pending approvals, `campaign_report` | 1 day | beats 1, 4, 7 |
| 4 | Platform pages: campaign list, live event feed (SSE), results page; the `/sim` dashboard reused for the replay | 1.5 days | beats 2, 3, 5, 7 |
| 5 | Matching on the real campaign, plus the clarification protocol and escalation to the founder | 1–1.5 days | beats 3, 4 |
| 6 | Split simulation run (days 1–5, deal, days 6–14) against stored records | 0.5–1 day | beat 5 |
| 7 | Negotiation over MCP with owner approval in both windows | 1 day | beat 6 |
| 8 | Rehearsal, fallbacks, screen recordings | 0.5 day | — |

About 7 days of work for 8 days on the calendar: little slack. If something must be cut, cut
in this order: the public HTTPS deployment (demo locally), then the results page (Claude's
report covers it), then live matching (replay recorded agent decisions).

## Fallbacks for a live demo

| Beat | If it fails live | Fallback |
|---|---|---|
| 1, 7 | The Claude window cannot reach the server | The same tool calls from a terminal client; a recorded clip of the window |
| 3 | Model calls slow or failing | Recorded join and decline decisions replayed into the feed |
| 4, 6 | An agent goes off script | Rehearsed mandates make the escalation reliable; the rule-based negotiator (`npm run negotiate --rules`) produces the same protocol with no model calls |
| 5 | — | Already a replay; the screen recording as a last resort |

## Still open

- The hackathon's submission rules, judging criteria and exact time limit
- Whether Yi's creator window uses a second account or a second Claude Desktop profile
- The exact wording of the beat 4 question and the approved claim
