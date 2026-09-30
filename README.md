# aura

**The Internet Aura Market** — binary prediction markets where every
market is one *handle* and one time window. Each handle's index ("aura") is
scored by AI from real source activity (RSS, APIs, web search) and every window
asks a single question about where that aura goes next.

## Monorepo layout

| Path | What it is | Dev port |
|---|---|---|
| `app/` | The product — TanStack Start + Vite + Tailwind 4 + Radix. Reads on-chain state from the indexer (HTTP + WebSocket subscriptions), backend data from the oracle API, and exact/fresh values from the chain. | 5173 |
| `oracle/` | NestJS backend — social API, handle creation + profile writes, Cloudinary uploads, Socket.IO gateway, the AI aura engine and the market-window job engine. | 3000 → mapped 4000 (`/v1`, `/socket.io`) |
| `indexer/` | Envio HyperIndex — every on-chain entity (handles, windows, trades, orders, the auraLP vault, staking). A pure log consumer: the contracts emit the state. | 8080 (`/v1/graphql`) |
| `smart-contracts/` | Solidity protocol (Handle/HandleFactory, MarketMaker LMSR, Oracle/OracleFactory, Pool, Stake, RevenueSharing, OrderBook) + Hardhat tests + the deploy tooling. | — |
| `packages/` | Shared workspaces — `@aura/contracts` (types + slot math) and `@aura/indexer-client`. | — |
| `cre/` | Chainlink CRE project for the stake-gifting workflow. | — |

## Where the data comes from

- **Indexer (GraphQL + WebSocket, `VITE_INDEXER_URL`)** — all on-chain state:
  handles, windows, trades, price points, orders + fills, pool/stake snapshots.
  Paging/sorting/filtering happen *in the query*; live surfaces subscribe over
  `ws://` and stand their polling down while the socket is up.
- **Oracle REST (`VITE_API_BASE`)** — backend-owned data: posts/feeds, comments,
  likes, reposts, bookmarks, follows, subscriptions, notifications.
- **Chain (viem, Monad testnet)** — anything that must be exact and fresh:
  balances, allowances, shares, vault stats, and every write.
- **WebSocket (Socket.IO)** — the oracle pushes `aura`, `feed`, `social.*`,
  `window*` and `notification` events; the app patches its caches in place.
- **Oracle REST (`VITE_API_BASE`)** — backend-owned data: posts/feeds, comments,
  likes, reposts, bookmarks, follows, subscriptions, notifications.
- **Chain (viem, Monad testnet)** — anything that must be exact and fresh:
  balances, allowances, shares, vault stats, and every write.
- **WebSocket (Socket.IO)** — the oracle pushes `aura`, `feed`, `social.*`,
  `window*` and `notification` events; the app patches its caches in place.

## Quickstart

```bash
# 0. deps (workspace root)
npm install

# 1. indexer: HyperSync sync + the GraphQL API (needs Docker; WSL on Windows)
cd indexer && npm install
cp .env.example .env      # ENVIO_API_TOKEN + ENVIO_RPC_URL
npm run codegen && npm run dev     # GraphQL on :8080

# 2. contracts (deploy + verify wiring + seed the handles + sync the indexer config)
cd ../smart-contracts
PRIVATE_KEY=$RELAYER_PK ORACLE_PRIVATE_KEY=$RELAYER_PK \
  npx hardhat run scripts/deploy.ts --network monadTestnet
npx hardhat run scripts/verify-deploy.ts --network monadTestnet
node scripts/sync-indexer.mjs --write
PRIVATE_KEY=$RELAYER_PK ORACLE_PRIVATE_KEY=$RELAYER_PK \
  npx hardhat run scripts/seed-handles.ts --network monadTestnet

# 3. oracle (API + worker + postgres + redis)
cd ../oracle && docker compose up -d --force-recreate postgres redis oracle-api oracle-worker
docker compose exec oracle-api npx prisma migrate deploy

# 4. app
cd ../app && npm run dev            # http://localhost:5173
```

Copy `oracle/.env.example` → `oracle/.env` and `app/.env.example` → `app/.env`
first; **never commit the real `.env` files** (they hold the relayer key).

## Verification without a wallet or an RPC

```bash
cd app
node scripts/check-writes.mjs            # parses every ABI + encodes all write paths
node scripts/check-routes.mjs            # fetches every page, asserts 200 + content
node scripts/check-indexer-fields.mjs    # app queries vs indexer schema
npx tsc --noEmit
```

```bash
cd oracle && npm test          # unit suite (vitest)
cd oracle && npm run test:e2e  # builds + drives dist/main.js over HTTP
cd smart-contracts && npx hardhat test
cd indexer && npx envio codegen   # config + schema compile (linux/darwin; WSL on Windows)
```

CI (`.github/workflows/ci.yml`) runs all of the above on every push.

See [`AGENTS.md`](./AGENTS.md) for the deeper working notes: the WS event map,
the redeploy runbook, and the local setup gotchas.
