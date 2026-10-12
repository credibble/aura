# Aura — working notes for agents

Two deployables in this repo:

| Path | What it is | Port |
|---|---|---|
| `app/` | The product: TanStack Start + Vite + Tailwind 4 + Radix. Every page is the market UI. | 5173 |
| `oracle/` | NestJS backend: social/feeds API, handle creation + profile updates, Cloudinary uploads, WS gateway, AI aura engine. | 3000 (REST `/v1`, Socket.IO `/socket.io`) |
| `indexer/` | Envio HyperIndex: every on-chain entity the UI and the oracle read (handles, windows, trades, orders, the auraLP vault, staking). | 8080 (GraphQL `/v1/graphql`; Hasura console 8080, password `testing`) |
| `smart-contracts/` | Solidity + the deploy tooling (Pool, Stake, Handle, MarketMaker, OrderBook, RevenueSharing). | — |

## Where the app reads data from

**Indexer (Envio HyperIndex, `VITE_INDEXER_URL`, default `http://localhost:8080/v1/graphql`)** — all on-chain state:
- `Handle` → explore grid, leaderboard, search popover, sidebars (`queries/handles.ts`)
- `Window` / `Trade` / `PricePoint` / `Order` + `OrderFill` → market detail (`queries/markets.ts`)
- `PoolSnapshot` / `PoolEvent` → `/pool` (`queries/pool.ts`)
- `Stake` / `StakeSnapshot` → staking (`queries/stake.ts`)

Paging, sorting and filtering happen **in the query** via `lib/indexer-page.ts`
(`indexerInfiniteOptions`) — Envio's own dialect: `where` with
`{ field: { _eq: … } }`, `order_by: { field: dir }`, `limit`, `offset`;
`hasMore = page.length >= limit`. Sort/filter fields are `@index`-ed in
`schema.graphql`. Charts are the exception: they request the whole series in one shot.

**Live updates are subscriptions, polling is the fallback.** `lib/indexer-ws.ts`
holds the `graphql-ws` client (same endpoint over `ws://`) and
`useIndexerLive({ queryKey, query, mode })` keeps a cache entry fresh from one —
`invalidate` for lists/paged collections, `patch` for a single row. It registers
the query key, and `lib/poll-registry.ts` stands that key's timers down while the
subscription is live (and they resume if the socket drops), because hosted
WebSocket support is plan-dependent — never *require* the socket.

**Oracle REST (`VITE_API_URL`, default `http://localhost:3000/v1`)** — backend-owned data:
- posts/feeds, comments (with reaction-GIF `media`), likes, reposts, bookmarks, follows,
  subscriptions, notifications (`queries/posts.ts`, `queries/social.ts`, `queries/notifications.ts`)
- handle creation `POST /handles` and **profile updates `PATCH /handles/:id`** (multipart
  `photo` → Cloudinary → oracle-signed `Handle.setMetadata`)
- source connections `GET/PUT/DELETE /handles/:id/connection`, `verify`, `availability/check`
- auth: `POST /auth/login` (EIP-191 → JWT, stored per device in `localStorage`)

**Chain (viem public client, Monad testnet)** — anything that must be exact and fresh:
balances, allowances, outcome shares, vault stats, and every write. Addresses come from
`VITE_*_ADDRESS` (`lib/chain.ts`); the ABIs there are `parseAbi`-ed **on purpose** — raw
human-readable strings make `encodeFunctionData` throw
(`Cannot use 'in' operator to search for 'name' in function …`).

## WebSocket (oracle gateway)

`lib/ws.ts` is the only push client. It maps each server message to cache work:

| Event | Effect |
|---|---|
| `hello` (first) | warm start, nothing to do |
| `hello` (re-connect) | invalidate every covered prefix (the resync that makes polling unnecessary) |
| `aura` | patch `aura`/`auraDelta` in place across handle caches + refresh aura history |
| `feed` / `social.post.*` | invalidate posts / feed / search / bookmarks / reposted |
| `social.engagement` | patch that post's counters in place |
| `social.comment.*` | invalidate that post's comments + detail |
| `window*` | invalidate windows, handle-windows, window, stats, leaderboard **and the pool vault** |
| `notification` | invalidate that user's notification list |

Queries without an event source (positions, open orders, pool/stake stats) poll through
`lib/poll-registry.ts` — a poll only runs while its surface is on screen.

## Redeploy runbook (one pass)

Prefer the orchestrator — it runs steps 1-3 and 5 in order and prints the env lines:

```bash
cd smart-contracts
PRIVATE_KEY=$RELAYER_PK ORACLE_PRIVATE_KEY=$RELAYER_PK node scripts/deploy-all.mjs
# (add --skip-indexer to compile/deploy only the contracts + seed)
```

The same steps by hand:

```bash
# 0. Fund the deployer/relayer (it deploys AND settles; same address is fine).
#    Monad's gas floor is ~100 gwei — do NOT force a much higher GAS_PRICE or a
#    full deploy will burn several MON.

# 1. Deploy the stack (writes deployments/deployments.json)
cd smart-contracts
PRIVATE_KEY=$RELAYER_PK ORACLE_PRIVATE_KEY=$RELAYER_PK \
  npx hardhat run scripts/deploy.ts --network monadTestnet

# 1b. Prove the wiring (no gas): the factory signer MUST equal the relayer, or
#     submitResolution reverts on every window and settlement stalls silently.
ORACLE_PRIVATE_KEY=$RELAYER_PK npx hardhat run scripts/verify-deploy.ts --network monadTestnet

# 2. Push the new addresses + start block into the indexer's config, and print
#    the env lines for both services
node scripts/sync-indexer.mjs --write

# 3. Generate the indexer's handler types from config.yaml + schema.graphql,
#    then index (needs Docker; the Envio CLI is linux/darwin, so use WSL on Windows)
cd ../indexer
npm run codegen          # validates config + schema
npm run dev              # HyperSync sync; GraphQL on :8080

# 5. Seed the handles (10, each with its OWN scoped sources: an exact-phrase
#    news feed + an entity-only site where one exists — never a general desk).
cd ../smart-contracts
PRIVATE_KEY=$RELAYER_PK ORACLE_PRIVATE_KEY=$RELAYER_PK \
  npx hardhat run scripts/seed-handles.ts --network monadTestnet

# 4. Point the oracle at the new addresses, then rebuild + restart it
#    (paste the env lines printed by step 2 into oracle/.env)
cd ../oracle
docker compose up -d --build --force-recreate postgres redis oracle-migrate oracle-api oracle-worker
curl -s localhost:4000/health/ready
```

Migrations are applied on boot: every oracle container runs
`oracle/docker-entrypoint.sh`, and the one-shot `oracle-migrate` service is the
single migrator (`oracle-api`/`oracle-worker` wait for it via
`service_completed_successfully`, and set `RUN_MIGRATIONS=false`). No manual
`prisma migrate deploy` step is needed.

Notes:
- `ORACLE_PRIVATE_KEY` must equal the address `OracleFactory` was deployed with
  (its `signer`): the receipt signature must recover to it *and* that same EOA
  sends `submitResolution`.
- The oracle's own Postgres service (5432, DB `aura`) is the database now that
  graph-node is gone; the Envio indexer runs its own Postgres on 5433 so the two
  never collide.
- `docker compose up` **without** service names would start the bundled
  `postgres` and fight for 5432; always name the services.

## Adapter contract (what "a good adapter" means)

Naming: **`<Platform><Purpose>Adapter`**, grouped by credential type.

| folder | credential | adapters | reads |
|---|---|---|---|
| `adapters/public/` | none | `RssFeedAdapter` · `RedditSearchAdapter` · `HackerNewsSearchAdapter` | open feeds + open search APIs |
| `adapters/api/` | app key / app token | `XSearchAdapter` · `YouTubeChannelAdapter` · `GitHubProfileAdapter` · `TwitchChannelAdapter` | **other people's** public data |
| `adapters/connections/` | per-user OAuth | `SpotifyConnectAdapter` · `InstagramConnectAdapter` · `FacebookConnectAdapter` · `LinkedInConnectAdapter` · `ShopifyConnectAdapter` | **the connected account's own** data |

`…ConnectAdapter` is never the same thing as `…SearchAdapter`: different
credential, different subject (you vs. the world). The `platform` string inside an
adapter is the key on-chain configs use (`"x"`, `"spotify"`, …) and must not
change; folder and class names are internal.

Every adapter must:

1. **Emit ITEMS, not just metrics, whenever the platform has text.** Metrics alone
   make a platform a number; the AI reads text. (RSS, X, Reddit, HackerNews,
   Spotify top tracks do.)
2. **Carry reach on each item** — `author` (with the follower count where the API
   gives it) and `stats` (likes/replies/reposts/views/score/upvotes). These drive
   both the prompt and the feed card line.
3. **Never synthesize a number.** If the API doesn't expose it, it doesn't exist —
   `spotify-profile` used to derive "monthly listeners" from followers ×
   popularity, which invented a metric that moved the aura. Fail closed instead.
4. **Fail closed without credentials** — an empty sample, never a fabricated
   series. `requiredCredentials` declares what it needs (resolved from the
   ConnectionStore, never from the on-chain config).
5. **Be one code path per protocol, configured per source.** There is ONE RSS
   adapter: `platform: "rss"` + `feed` (+ optional `weight`, `outlet`, `topic`,
   `context`). Per-outlet subclasses (BbcAdapter, FoxSportsAdapter) were deleted —
   credibility is a config value, not a class. Likewise Spotify's artist and
   "me" halves are one adapter, mode chosen by the config.
6. **Honour the source-scoping intent**: `topic` (drives <<MENTION>>) and
   `context` (how to read this outlet for this handle) flow onto the Source via
   `BaseSource.toSource` — don't drop them.
7. **Respect `since`** so a poll doesn't re-ingest the same day's items, and
   declare `metrics` with real units/labels.

Still metrics-only (text is a follow-up): `YouTubeChannelAdapter` (video titles),
`GitHubProfileAdapter` (release/commit titles), `TwitchChannelAdapter` (stream
titles), the `*ConnectAdapter`s (token-gated posts), `ShopifyConnectAdapter`
(commerce metrics — no ambient text).

## The aura → market decision path (audit & replay)

One tick, and what constrains it:

| Step | Where | Deterministic? |
|---|---|---|
| Fetch scoped sources → raw items (+ engagement) | `adapters/*`, shared Redis cache | yes |
| Build signals: normalized `volume` + `engagement` + item texts + per-source `context`/`topic` | `AuraEngineService.signalFor` | yes |
| AI answer: **direction + magnitude (percent, ±5–20) + memo** | `KimiAiModel.scoreWithSummary` | no (the only non-deterministic step) |
| Evidence weight: credibility-weighted item volume × reach, clamped to [0.25, 1] | `evidenceWeight` | yes |
| Applied move: AI magnitude (band ±5–20%) × evidenceWeight, then the APPLIED move re-clamped to ±5–20%; **points floor ≥ 1 unit** | `AuraEngineService.appliedPercent` | yes |
| Memo → on-chain (`Handle.updateAura`) + audit hash → WS | `ChainGateway`, `publishAura` | yes |

- **The model never decides size alone.** Its magnitude is advisory and scaled by
  evidence, so a confident answer off one weak item moves the index far less than
  a broad high-reach story.
- **Nothing resolves without an observation.** The points floor guarantees a tick
  always moves ≥ 1 unit (a 0.2% floor rounds to zero on a low aura), and a window
  with no aura observations is deliberately left unsettled — the market's grace
  window VOIDs it and `redeemVoid` refunds traders, instead of resolving YES on an
  unchanged series.
- **Every tick is replayable.** `hashTick` commits to the handle, timestamp, base
  level, the item ids the model saw, its raw reply and the applied percent; the
  hash is logged and pushed with the aura event. To verify a resolution: re-fetch
  the item ids for that window, re-run the prompt and compare the hash.
- **Windows must be ≥ the aura cadence** (`AURA_AI_MIN_INTERVAL_MS`). The engine
  warns when a handle's window is shorter, because such a window can open and
  close between two observations (→ void).

**Not yet done (needs the next contract revision):** commit `inputsHash` into the
`ResolutionReceipt` itself, so a settlement carries the evidence hash on-chain
rather than only over the WS/audit log. That is a `ResolutionReceiptLib` +
`Oracle.submitResolution` + EIP-712 types change; it belongs in the same deploy as
the categories[]/binary migration. Governance for the same reason: the relayer is
a single signer — a multisig (or a challenge window on `submitResolution`) is the
real mitigation, and it is a deployment/config decision, not a code one.

## Verification without a wallet or an RPC

```
cd app
node scripts/check-writes.mjs           # parses every ABI + encodes all 18 write paths
node scripts/check-routes.mjs           # fetches every page, asserts 200 + real content
node scripts/check-indexer-fields.mjs   # contract test: app queries vs indexer schema
npx tsc --noEmit
```

```
cd oracle
npm test          # unit suite (vitest)
npm run test:e2e  # builds, spawns dist/main.js, drives it over HTTP (black box)
npx tsc --noEmit
```

```
cd smart-contracts
npx hardhat test                 # 45 tests, incl. the money invariants
cd ../indexer && npx envio codegen   # config + schema compile (linux/darwin; WSL on Windows)
```

`.github/workflows/ci.yml` runs all of the above on every push.

`check-writes.mjs` fails on ABI drift (re-reads `src/lib/chain.ts`).
`check-indexer-fields.mjs` fails when an entity/field the app selects is missing
from `indexer/schema.graphql`. The oracle e2e asserts health/readiness shape,
hardening headers, 401 on guarded writes, JSON 404s, and that a write burst never
5xx's.


## Copy & voice (the Gen-Z layer)

The app talks like its users, **moderately**. Slang lives in the **chrome**,
never in the **ledger**:

| Lane | Surfaces | Rule |
|---|---|---|
| 🟢 full send | heroes, primary CTAs, big empty states, success toasts, "How it works" headlines, 404 | one quip per surface, max |
| 🟡 light touch | section subtitles, sidebar explainer cards, dialog descriptions, tooltips, table-empty rows | a word or two; stay literal |
| 🔴 never | numbers/prices/PnL/balances, deposit/withdraw/claim/stake/window rules, errors + reverts, destructive dialogs, legal, `aria-label`/`sr-only` | plain English, accuracy wins |

Two hard caps: **never slang a consequence** (funds, fees, settlement) and
**never stack two slang beats on one surface** — if a page already has a slogan,
that *is* the quip. Recurring strings live in `app/src/lib/voice.ts` (the
flagship `START_FARMING` = "Start farming aura"); one-off quips stay inline next
to their component. Keep the `check-routes.mjs` markers (page H1s) intact.

## Local setup notes

- `oracle/.env` needs `DATABASE_URL`, `HANDLE_OWNER_PRIVATE_KEY`, `HANDLE_FACTORY_ADDRESS`,
  `CLOUDINARY_*`, `ALCHEMY_RPC_URL`/`RPC_URL`, `INDEXER_URL` (default
  `http://localhost:8080/v1/graphql`). Migrations run automatically on container
  boot via `oracle/docker-entrypoint.sh` (`npx prisma migrate deploy` + the
  pg_trgm indexes); run it by hand only outside Docker.
- `indexer/.env` needs `ENVIO_API_TOKEN` (HyperSync) and `ENVIO_RPC_URL` (the
  HyperRPC fallback data source). Both are gitignored; see `indexer/.env.example`.
- The oracle's aura engine writes aura on-chain and pushes it over WS; it keeps **no**
  backend copy of aura history — the indexer indexes that (`AuraHistory`).
- Handle profile writes are server-signed (`PATCH /handles/:id`); the old
  `social/sync-user` endpoint is gone.
