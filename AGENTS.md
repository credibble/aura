# Aura — working notes for agents

Two deployables in this repo:

| Path | What it is | Port |
|---|---|---|
| `app/` | The product: TanStack Start + Vite + Tailwind 4 + Radix. Every page is the market UI. | 8080 |
| `oracle/` | NestJS backend: social/feeds API, handle creation + profile updates, Cloudinary uploads, WS gateway, AI aura engine. | 3000 (REST `/v1`, Socket.IO `/socket.io`) |
| `smart-contracts/` | Solidity + the subgraph (Pool, Stake, Handle, MarketMaker, OrderBook, RevenueSharing). | subgraph 8000 |

## Where the app reads data from

**Subgraph (GraphQL, `VITE_SUBGRAPH_URL`, default `http://localhost:8000/subgraphs/name/aura/aura`)** — all on-chain state:
- `handles` → explore grid, leaderboard, search popover, sidebars (`queries/handles.ts`)
- `windows` / `trades` / `pricePoints` / `orders` + `orderFills` → market detail (`queries/markets.ts`)
- `poolSnapshots` / `poolEvents` → `/pool` (`queries/pool.ts`)
- `stakes` / `stakeSnapshots` → staking (`queries/stake.ts`)

Paging, sorting and filtering happen **in the query** via `lib/subgraph-page.ts`
(`subgraphInfiniteOptions`) — `where`, `orderBy`, `orderDirection`, `first`, `skip`;
`hasMore = page.length >= limit`. Charts are the exception: they request the whole
series in one shot.

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

# 2. Push the new addresses into the subgraph manifest, start blocks and the
#    graph-node chain mapping; prints the env lines for both services
node scripts/sync-subgraph.mjs --write

# 3. Reindex the subgraph (same name → graph-node picks up the new addresses)
cd subgraph && npx graph codegen && npx graph build
npx graph create --node http://localhost:8020 aura/aura   # first time only
npx graph deploy aura/aura --node http://localhost:8020 --ipfs http://localhost:5001 \
  --version-label v0.1.0

# 4. Point the oracle at the new addresses, then rebuild + restart it
#    (paste the env lines printed by step 2 into oracle/.env)
cd ../../oracle
docker compose up -d --build oracle-api oracle-worker redis   # never the bundled postgres
docker compose exec oracle-api npx prisma migrate deploy
curl -s localhost:4000/health/ready
```

Notes:
- `ORACLE_PRIVATE_KEY` must equal the address `OracleFactory` was deployed with
  (its `signer`): the receipt signature must recover to it *and* that same EOA
  sends `submitResolution`.
- The oracle container uses the host's Postgres (`host.docker.internal:5432`,
  DB `aura`) — the graph-node's Postgres container also hosts it.
- `docker compose up` **without** service names would start the bundled
  `postgres` and fight for 5432; always name the services.

## Verification without a wallet or an RPC

```
cd app
node scripts/check-writes.mjs           # parses every ABI + encodes all 18 write paths
node scripts/check-routes.mjs           # fetches every page, asserts 200 + real content
node scripts/check-subgraph-fields.mjs  # contract test: app queries vs subgraph schema
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
cd subgraph && npx graph build   # mappings compile against the schema
```

`.github/workflows/ci.yml` runs all of the above on every push.

`check-writes.mjs` fails on ABI drift (re-reads `src/lib/chain.ts`).
`check-subgraph-fields.mjs` fails when an entity/field the app selects is missing
from `smart-contracts/subgraph/schema.graphql` — e.g. it pins the new
`Handle.categoryId`. The oracle e2e asserts health/readiness shape, hardening
headers, 401 on guarded writes, JSON 404s, and that a write burst never 5xx's.


## Local setup notes

- `oracle/.env` needs `DATABASE_URL`, `HANDLE_OWNER_PRIVATE_KEY`, `HANDLE_FACTORY_ADDRESS`,
  `CLOUDINARY_*`, `ALCHEMY_RPC_URL`/`RPC_URL`. Migrations: `npx prisma migrate deploy`
  (the DB was baselined with `prisma migrate resolve --applied 0001_init`).
- The oracle's aura engine writes aura on-chain and pushes it over WS; it keeps **no**
  backend copy of aura history — the subgraph indexes that (`AuraHistory`).
- Handle profile writes are server-signed (`PATCH /handles/:id`); the old
  `social/sync-user` endpoint is gone.
