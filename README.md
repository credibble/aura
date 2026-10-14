# Aura — The Internet Aura Market

[![CI](https://github.com/credibble/aura/actions/workflows/ci.yml/badge.svg)](https://github.com/credibble/aura/actions/workflows/ci.yml)

> **Trade the trend line of the internet's mood.**
> Aura turns real online attention into a live, AI-scored on-chain index — then
> lets anyone trade prediction markets on where each name's aura goes next.

Every market is one **handle** (a person, project, coin, or brand) and one time
window. The handle's index — its **aura** — is scored by an AI from the handle's
own scoped sources (RSS, public APIs, per-user OAuth connections). Each window
asks one question: **does this handle's aura close higher or lower?**

---

## Contents

- [What is Aura](#what-is-aura)
- [How it works](#how-it-works)
- [Repository layout](#repository-layout)
- [Where the data comes from](#where-the-data-comes-from)
- [The aura → market decision path](#the-aura--market-decision-path)
- [Prerequisites](#prerequisites)
- [Quickstart](#quickstart)
- [Environment variables](#environment-variables)
- [Verification & CI](#verification--ci)
- [Chainlink CRE workflows](#chainlink-cre-workflows)
- [Redeploy runbook](#redeploy-runbook)
- [The adapter contract](#the-adapter-contract)
- [Docs & conventions](#docs--conventions)

---

## What is Aura

Attention is the internet's most valuable asset, but it doesn't trade anywhere.
Aura makes it tradable:

- **Ingest** — per-handle, per-outlet adapters pull real items with real reach
  (author, likes, replies, views). Every adapter fails closed without
  credentials and never invents a metric.
- **Score** — a reasoning model reads the item *text* and returns a direction, a
  magnitude in a ±5–20% band, and a one-line rationale. **The model advises; code
  decides size** — the move is scaled by an evidence weight and clamped.
- **Settle** — a window resolves from the aura series, with a points floor so a
  tick always moves ≥ 1 unit. Every tick is hashed over the exact items the model
  saw, so any settlement is **replayable**.
- **Explain** — the AI's memo is written on-chain and shown as the chart tooltip's
  "why it moved".

## How it works

```
  scoped sources ──▶ aura engine ──▶ on-chain aura ──▶ market windows
  (RSS · APIs ·     (AI scores      (Handle.updateAura   (MarketMaker LMSR,
   OAuth feeds)      text + reach)   + AuraHistory)       YES/NO per slot)
        ▲                                   │
        └────────── indexer (Envio) ────────┘  every entity the UI + oracle read
```

1. **Sources** feed a handle on a fixed cadence. Each source is configured by a
   JSON object stored on-chain in `Handle.sources[]` (platform + params +
   optional `topic`/`context`).
2. The **aura engine** fetches each source, assembles the signal (normalized
   volume + engagement + item texts), asks the AI for direction + magnitude +
   memo, scales it by evidence, writes the new aura **on-chain**, and pushes it
   over WebSocket.
3. The **window engine** opens a market window per handle per slot, settles it
   from the aura series at `windowEnd`, and opens the next slot — so a handle
   always has a live window.
4. The **app** reads on-chain state from the indexer, backend data from the
   oracle API, and exact/fresh values (balances, allowances, shares) from the
   chain.

## Repository layout

| Path | What it is | Port |
|---|---|---|
| `app/` | The product — TanStack Start + Vite + Tailwind 4 + Radix + TanStack Query/Router + viem. Reads on-chain state from the indexer (HTTP + WS subscriptions), backend data from the oracle API, exact values from the chain. | `5173` |
| `oracle/` | NestJS backend — social/feeds API, handle creation + profile writes, Cloudinary uploads, Socket.IO gateway, the AI aura engine, and the market-window job engine. | `4000` (`/v1`, `/socket.io`) |
| `indexer/` | Envio HyperIndex — every on-chain entity (handles, windows, trades, orders, the auraLP vault, staking). A pure log consumer: the contracts emit the state. | `8080` (`/v1/graphql`; Hasura console, password `testing`) |
| `smart-contracts/` | Solidity protocol (Handle/HandleFactory, MarketMaker LMSR, Oracle/OracleFactory, Pool, Stake, RevenueSharing, OrderBook) + Hardhat tests + the deploy tooling. | — |
| `packages/` | Shared workspace — `@aura/contracts` (types + slot math), consumed by the oracle and scripts. | — |
| `cre/` | Chainlink CRE project — the stake-reward + graduation workflows. Their reads (vault list, graduation candidates) come from the Envio indexer's `/v1/graphql`, the same source as the app. | — |

## Where the data comes from

| Source | Used for | Env |
|---|---|---|
| **Envio indexer** (GraphQL + WebSocket) | All on-chain state: handles, windows, trades, price points, orders + fills, pool/stake snapshots. Paging/sorting/filtering happen *in the query*; live surfaces subscribe over `ws://` and stand their polling down while the socket is up. | `VITE_INDEXER_URL` |
| **Oracle REST** | Backend-owned data: posts/feeds, comments, likes, reposts, bookmarks, follows, subscriptions, notifications, handle/profile writes, OAuth connections. | `VITE_API_BASE` |
| **Chain** (viem, Monad testnet) | Anything that must be exact and fresh: balances, allowances, outcome shares, vault stats, and **every write**. | `VITE_*_ADDRESS` |
| **Socket.IO** (oracle) | The oracle pushes `aura`, `feed`, `social.*`, `window*`, and `notification` events; the app patches its caches in place. | same as oracle |

**Live updates are subscriptions; polling is the fallback.** Queries without an
event source (positions, open orders, pool/stake stats) poll through the poll
registry, and a poll only runs while its surface is on screen.

## The aura → market decision path

One tick, and what constrains it:

| Step | Where | Deterministic? |
|---|---|---|
| Fetch scoped sources → raw items (+ engagement) | `oracle/adapters/*` | yes |
| Build signals: normalized volume + engagement + item texts + per-source context/topic | `AuraEngineService.signalFor` | yes |
| AI answer: **direction + magnitude (percent, ±5–20) + memo** | `KimiAiModel.scoreWithSummary` | **no** (the only non-deterministic step) |
| Evidence weight: credibility-weighted volume × reach, clamped to `[0.25, 1]` | `evidenceWeight` | yes |
| Applied move: AI magnitude × evidence weight, re-clamped to ±5–20%; points floor ≥ 1 unit | `AuraEngineService.appliedPercent` | yes |
| Memo → on-chain (`Handle.updateAura`) + audit hash → WS | `ChainGateway`, `publishAura` | yes |

- **The model never decides size alone.** A confident answer off one weak item
  moves the index far less than a broad, high-reach story.
- **Nothing resolves without an observation.** A window with no aura observation
  is deliberately left unsettled (the market's grace window VOIDs it and refunds
  traders) rather than resolving YES on an unchanged series. The aura engine keeps
  ticking even without brand-new items — it scores the most recent items — or the
  window engine would starve.
- **Every tick is replayable.** `hashTick` commits to the handle, timestamp, base
  level, the item ids the model saw, its raw reply, and the applied percent.

## Prerequisites

- **Node.js 20+** (the indexer CI job uses Node 22).
- **Docker** — the indexer (HyperSync sync + GraphQL) and the oracle stack run in
  containers.
- **WSL** on Windows — the Envio CLI addon is linux/darwin only.
- **A funded Monad testnet wallet** for deploy/relayer duties (Monad's gas floor
  is ~100 gwei).
- **CRE CLI** (`cre`) + a Chainlink account, only for the `cre/` workflows.

## Quickstart

```bash
# 0. deps (workspace root)
npm install

# 1. indexer: HyperSync sync + the GraphQL API (needs Docker; WSL on Windows)
cd indexer && npm install
cp .env.example .env                # ENVIO_API_TOKEN + ENVIO_RPC_URL
npm run codegen && npm run dev      # GraphQL on :8080

# 2. contracts: deploy + verify wiring + sync the indexer config + seed handles
cd ../smart-contracts
PRIVATE_KEY=$RELAYER_PK ORACLE_PRIVATE_KEY=$RELAYER_PK \
  npx hardhat run scripts/deploy.ts --network monadTestnet
npx hardhat run scripts/verify-deploy.ts --network monadTestnet
node scripts/sync-indexer.mjs --write
PRIVATE_KEY=$RELAYER_PK ORACLE_PRIVATE_KEY=$RELAYER_PK \
  npx hardhat run scripts/seed-handles.ts --network monadTestnet

# 3. oracle: API + worker + postgres + redis (migrations run on boot)
cd ../oracle && docker compose up -d --build --force-recreate \
  postgres redis oracle-migrate oracle-api oracle-worker

# 4. app
cd ../app && npm run dev             # http://localhost:5173
```

Copy `oracle/.env.example` → `oracle/.env` and `app/.env.example` → `app/.env`
first, and paste the addresses printed by `sync-indexer.mjs` into `oracle/.env`.
**Never commit the real `.env` files** — they hold the relayer key.

> Prefer the orchestrator: `smart-contracts/scripts/deploy-all.mjs` runs steps
> 1–3 and 5 and prints the env lines. See the [redeploy runbook](#redeploy-runbook).

## Environment variables

Each deployable has an `.env.example` with the full list and comments. The ones
you'll touch most:

| Variable | Where | Purpose |
|---|---|---|
| `VITE_INDEXER_URL` | `app` | Envio GraphQL endpoint (`http://localhost:8080/v1/graphql`) |
| `VITE_API_BASE` | `app` | Oracle REST base, includes `/v1` (`http://localhost:4000/v1`) |
| `VITE_*_ADDRESS` | `app` | Contract addresses from `deployments/deployments.json` |
| `VITE_PRIVY_APP_ID` | `app` | Auth + embedded wallet |
| `ORACLE_PRIVATE_KEY` | `oracle` | The relayer that pushes aura and settles windows |
| `HANDLE_OWNER_PRIVATE_KEY` / `HANDLE_FACTORY_ADDRESS` | `oracle` | Server-signed handle creation |
| `INDEXER_URL` | `oracle` | Same indexer endpoint |
| `KIMI_VIA_0G` + `ZERO_G_API_KEY` | `oracle` | Route AI completions through the 0G router (`kimi-k2.5`) instead of Moonshot |
| `AURA_AI_MIN_INTERVAL_MS` | `oracle` | Minimum gap between AI scoring calls per handle |
| `WINDOW_EARLY_SETTLE` | `oracle` | `false` (default): windows trade their full length |

## Verification & CI

Everything runs **without a wallet or an RPC**:

```bash
cd app
node scripts/check-writes.mjs           # parses every ABI + encodes all write paths
node scripts/check-routes.mjs           # fetches every page, asserts 200 + content
node scripts/check-indexer-fields.mjs   # app queries vs the indexer schema
npx tsc --noEmit
```

```bash
cd oracle && npm test          # unit suite (vitest)
cd oracle && npm run test:e2e  # builds + drives dist/main.js over HTTP
cd smart-contracts && npx hardhat test
cd indexer && npx envio codegen   # config + schema compile (linux/darwin; WSL on Windows)
```

`check-writes.mjs` fails on ABI drift; `check-indexer-fields.mjs` fails when an
entity/field the app selects is missing from `indexer/schema.graphql`. The oracle
e2e asserts health/readiness shape, hardening headers, 401 on guarded writes, and
that a write burst never 5xx's.

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs all of the above on
every push and pull request.

## Chainlink CRE workflows

`cre/` holds two cron workflows — **stake-reward** (top up underfunded AURA
vaults) and **graduation** (graduate handles above an aura floor). Both read from
the Envio indexer and write EVM through consensus-verified reports.

Run the **receiver-free dry run** from the project root (`cre/`):

```bash
cd cre
cre workflow simulate reward     --target local-simulation --non-interactive --trigger-index 0
cre workflow simulate graduation --target local-simulation --non-interactive --trigger-index 0
```

`--target local-simulation` exercises the real indexer read + decision path and
returns a labeled result — no consumer contract, no transaction. The production
target is `testnet-settings` (Monad testnet); it fails closed without the deployed
consumer address in `config.json`. Deploy with
`cre workflow build|simulate|deploy --target testnet-settings`.

## Redeploy runbook

Prefer the orchestrator (runs steps 1–3 and 5, prints the env lines):

```bash
cd smart-contracts
PRIVATE_KEY=$RELAYER_PK ORACLE_PRIVATE_KEY=$RELAYER_PK node scripts/deploy-all.mjs
# (add --skip-indexer to compile/deploy only the contracts + seed)
```

By hand: deploy → `verify-deploy.ts` (proves `OracleFactory.signer == relayer`) →
`sync-indexer.mjs --write` → indexer `codegen && dev` → `seed-handles.ts` → point
the oracle at the new addresses and
`docker compose up -d --build --force-recreate oracle-api oracle-worker`.

> `ORACLE_PRIVATE_KEY` must equal the address `OracleFactory` was deployed with
> (its `signer`) **and** the handle's `auraUpdater`, or settlement and aura writes
> revert silently.

## The adapter contract

Naming: **`<Platform><Purpose>Adapter`**, grouped by credential type.

| Folder | Credential | Adapters | Reads |
|---|---|---|---|
| `adapters/public/` | none | `RssFeedAdapter` · `RedditSearchAdapter` · `HackerNewsSearchAdapter` | open feeds + search APIs |
| `adapters/api/` | app key / token | `XSearchAdapter` · `YouTubeChannelAdapter` · `GitHubProfileAdapter` · `TwitchChannelAdapter` | **other people's** public data |
| `adapters/connections/` | per-user OAuth | `SpotifyConnectAdapter` · `InstagramConnectAdapter` · `FacebookConnectAdapter` · `LinkedInConnectAdapter` · `ShopifyConnectAdapter` | **the connected account's own** data |

Every adapter **emits items** (not just metrics), **carries reach** on each item,
**never synthesizes a number**, **fails closed without credentials**, and is **one
code path per protocol, configured per source**.

## Docs & conventions

- [`AGENTS.md`](./AGENTS.md) — the deeper working notes: the WS event map, the
  adapter contract in full, the redeploy runbook, and local-setup gotchas.
- [`indexer/README.md`](./indexer/README.md) — the indexer's own notes.
- **Copy & voice:** slang lives in the chrome, never in the ledger — one quip per
  surface, never on numbers, funds, or errors. Recurring strings live in
  `app/src/lib/voice.ts`.
