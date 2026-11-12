# Dealoop

A promotion marketplace that pays per verified conversion. A founder states a goal in one
sentence, creators' agents join on their own, and every verified conversion is settled
immediately. Hackathon project; submission date 2026-11-19.

Specification: [docs/SPEC.md](docs/SPEC.md). Invariants and acceptance scenarios:
[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md). How the idea and the build got here:
[docs/DEVELOPMENT-LOG.md](docs/DEVELOPMENT-LOG.md).

All project documents are in English (the demo and progress review are presented in English).

## Rules that must not be broken

1. **Agents do not write to the ledger.** Attribution, budget commitment, pricing decisions and
   settlement are all deterministic code. Claude only produces proposals; the core validates them
   before acting, and a failed validation is refused with a recorded reason.
2. **Tests first.** The A/B/C invariants in ACCEPTANCE.md become tests before the implementation.
   Run the whole suite after every change.
3. **All amounts are integer cents (`*_cents`).** No floating point for money.
4. **The price never decreases and never exceeds `max_cac`.**
5. **All synthetic data must be labeled as synthetic** in the UI and the README.
6. Do not build anything beyond the scope in SPEC.md §13 without asking first.
7. **Leave `/Users/SummerXia/Projects/dealoop-muse` and its server on port 3100 alone.** It is the
   original prototype. This project runs on port 3200.

## Where this repository came from

Imported from [mmfish/DeaLoop](https://github.com/mmfish/DeaLoop) with git history reset. The
original project was a secondhand marketplace (Meta Muse hackathon), and **it contains no model
calls at all**: the agents' intelligence lived entirely on Muse's side, outside the repository.
So "switching to Claude" is not swapping an SDK; it means building an agent layer that did not
exist before.

Import baseline (verified): Node 24, `npm ci` succeeds, 43 tests pass, `build:aws` succeeds, the
server starts.

| Inherited from Muse | Disposition |
|---|---|
| `backend/auth.ts` `backend/oauth.ts` `backend/oauth-scopes.ts` `backend/grants.ts` | Reuse; rename scopes for the new domain |
| `backend/mcp.ts` | Reuse the framework; rewrite every tool definition |
| `backend/event-stream.ts` `backend/contracts.ts` `backend/policy.ts` | Reuse |
| `backend/negotiation.ts` `backend/negotiation-spec.ts` | **Reuse as the private negotiation channel** (SPEC §9) |
| `backend/shortlist*.ts` `backend/media.ts` and their pages | Delete (not yet done; they will go when the new pages replace the old ones) |
| `db/schema.ts` posts / offers / deals | Superseded by the campaign tables added in migration 0008; the old tables are still present |
| Sites/Cloudflare deploy scaffolding (`worker/`, `vite.config.ts`, the install/sites scripts in `scripts/`, `lib/connector*`) | **Deleted** (see git log) |
| The D1-shaped database interface (`runtime/sqlite.ts` emulates it, the `Env` type in `cloudflare-env.d.ts`, `@cloudflare/workers-types`) and Miniflare | **Kept**: the whole backend is written against D1's `prepare/bind/batch`, and five test files (api, api-key, auth, negotiation, security) use Miniflare D1 as their database. Removing them means rewriting tests, which is not cleanup |
| `public/images/*` (secondhand product photos) | Delete |

**The hard requirements for connecting Claude have been checked; see
[docs/SPEC.md §15](docs/SPEC.md).** Two are not met yet: `backend/oauth.ts` only accepts the
hard-coded Muse callback (allow `https://claude.ai/api/mcp/auth_callback`, and also
`https://claude.com/api/mcp/auth_callback`; update the `form-action` in `consentCsp`, and
`tests/mcp.test.ts` and `tests/oauth-refresh.test.ts`), and the service needs a public HTTPS
address that `DEALOOP_ORIGIN` matches exactly.

The demo has two acts: Act 1 is the simulator driven by headless Claude agents (scale); Act 2 is
human-in-the-loop negotiation in Claude.ai / Desktop connectors (the format of the Muse demo).
Both acts' agents call the same MCP tools.

## Layout

```
docs/          specification, acceptance scenarios, development log, original project README
app/           Next.js pages and routes (including /mcp, /api/v1, and /sim, the Act 1 dashboard)
backend/       server: authentication, OAuth, MCP, REST, negotiation, events
core/          deterministic core: ledger, pricing rules, deals, settlement      [new]
sim/           simulator and strategy comparison                                  [new]
agents/        Claude layer: brief parsing, supply estimation, creator join decisions, negotiation
db/ drizzle/   schema, migrations, repository
tests/         invariant tests and scenario tests
runtime/       runtime adapters (AWS/SQLite only)
```

## Build order and status

1. ~~Cleanup: delete what the table above marks for deletion, keeping `npm test` green~~ — deploy scaffolding done; shortlist/media deferred to step 7
2. ~~`db/` campaign schema and migration~~ — done (migrations 0008, 0009); `db/campaign-store.ts` is the only code that reads or writes the campaign tables
3. ~~`core/` + `tests/` for the A and B invariants~~ — done
4. ~~`sim/` + comparison (S2, S3)~~ — done
5. ~~`agents/`: connect Claude~~ — done: brief parsing (`npm run brief`), supply estimation and creator decisions (`npm run sim:claude`)
6. ~~Negotiation channel (C series, S8–S10)~~ — done (`core/negotiation.ts`, `npm run negotiate`); persistence and MCP tools come with Act 2
7. UI, seed data, and removal of the remaining secondhand-marketplace code — Act 1 dashboard done (`/sim`)

## Local development

- Node 24: `nvm use` (the repo has `.nvmrc`)
- Dev server: `DEALOOP_ORIGIN=http://localhost:3200 npm run dev:aws -- --port 3200`
- Tests: `npm test`; types: `npm run check`; simulator: `npm run sim`
- Claude Desktop (local MCP over stdio): `npm run mcp:config -- --install`, see `docs/CLAUDE-DESKTOP.md`
- Simulator with Claude agents: `npm run sim:claude -- --seed 1` (calls the API and costs money; add `--creators 5 --days 2` for a cheap trial)
- Agent tests never call the network: they use a fake `JsonClient` (`tests/agents.test.ts`)

## Terms

- **Public price / current_price**: the campaign's current uniform unit price; every public-channel creator gets the same price
- **Retroactive uniform price**: after a raise, conversions verified earlier are also paid the new price
- **pending**: a conversion that has happened but not yet passed verification; it holds budget at the current price
- **unfunded**: a conversion recorded after the budget was fully held; never paid
- **deal**: private terms negotiated by a top creator: a price floor for a capped number of sign-ups, paid at least the public price; does not affect the public price
- **mandate**: the bounds within which an agent may decide on its own (budget, max CAC, minimum take-home)
- **supply(p, d)**: the estimate of how many more conversions price p will bring over the remaining time d; produced by the agent

## Schedule (11/11–11/19)

| Date | Work | Checkpoint | Status |
|---|---|---|---|
| 11/11 | Final spec, project skeleton, stack | | Done |
| 11/12–11/13 | `core` + A/B invariant tests | **11/13: tests green, or negotiation drops to P1** | Done early (11/11) |
| 11/14 | `sim` + comparison, producing the S2/S3 numbers | | Done early (11/11) |
| 11/15 | `agents` connected to Claude | **11/15: agents working, or cut natural-language policy** | Done early (11/11) |
| 11/16 | Negotiation channel (unless dropped) | | Done early (11/11) |
| 11/17 | Demo UI + seed data, **feature freeze** | | Act 1 dashboard done early (11/11) |
| 11/18 | Polish, record the demo video, README | | |
| 11/19 | Buffer, submit | | |

Cut rules: core not green by 11/13 → negotiation drops to P1; agents not working by 11/15 → keep
only the parsing call to Claude; no new features after 11/17.
