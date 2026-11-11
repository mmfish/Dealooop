<p align="center">
  <img src="public/brand/dealoop-wordmark.png" alt="DeaLoop AI" width="360" />
</p>

# Dealoop — a promotion marketplace that pays per verified conversion

A founder states a promotion goal in one sentence, and the platform turns it into a public
campaign. Creators' agents join on their own and promote with tracked links, and every verified
conversion is settled immediately. The platform adjusts the price as the campaign progresses,
caps it at the founder's maximum CAC, and **applies every raise retroactively to all verified
conversions**.

- Specification: [docs/SPEC.md](docs/SPEC.md)
- Invariants and acceptance scenarios: [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md)
- How the idea and the build evolved: [docs/DEVELOPMENT-LOG.md](docs/DEVELOPMENT-LOG.md)
- Working agreement for Claude Code: [CLAUDE.md](CLAUDE.md)

> **Status: being rebuilt.** This repository was imported from
> [mmfish/DeaLoop](https://github.com/mmfish/DeaLoop) (a secondhand marketplace from the Meta Muse
> hackathon) with git history reset. Identity, OAuth, MCP, the event stream and idempotency are
> inherited as they are. The domain model is being replaced: campaigns, conversions, deals and a
> ledger now exist alongside the old posts / offers / deals / shortlist, which will be removed
> once the new pages are in place. The original README for the inherited code is kept at
> [docs/MUSE-README.md](docs/MUSE-README.md); most of it describes secondhand-marketplace
> behavior and **does not describe this repository's target**.

## Run locally

Requires Node 24 (the package declares `>=22.13`; the AWS runtime is 24). Local runs use
**port 3200**.

Development mode (reloads on change):

```sh
nvm use
npm ci
DEALOOP_ORIGIN=http://localhost:3200 npm run dev:aws -- --port 3200
```

Closer to production (build, then start):

```sh
npm run build:aws
DEALOOP_BUILD_TARGET=aws DEALOOP_RUNTIME=aws DEALOOP_ORIGIN=http://localhost:3200 npm run start:aws -- --port 3200
```

`DEALOOP_ORIGIN` must match the address you browse to; OAuth and MCP `resource` checks depend on
it. SQLite is created at `data/dealoop.sqlite`, and migrations run automatically on first use.
Public browsing needs no sign-in; human sign-in needs `config/firebase.json` replaced with your
own Firebase project's configuration.

## Validate

```sh
npm test
```

```sh
npm run build:aws && npm run check
```

Baseline at import: 43 tests passing, `build:aws` succeeding, server starting. Current: 60 tests
passing.

## Simulator

```sh
npm run sim
```

```sh
npm run sim -- --runs 200 --market baseline --tick 6
```

Compares the dynamic price with a range of fixed prices in three synthetic markets (baseline,
thin, thick). See [docs/SPEC.md §10](docs/SPEC.md) for how to read the results.

## About the data

The creators, conversions and comparison results shown in the demo and the pitch are **all
synthetic data**, not verified results from real campaigns.
