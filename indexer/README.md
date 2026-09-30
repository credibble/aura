# Aura indexer (Envio HyperIndex)

Every piece of on-chain state the app and the oracle read: handles, windows,
trades, price points, orders + fills, the auraLP vault and staking. It replaces
the old graph-node indexer - same entities and field names, so consumers only
changed their query syntax.

## Layout

| Path | What it is |
|---|---|
| `config.yaml` | chains (Monad testnet 10143), contract addresses, the events indexed, and the RPC data source |
| `schema.graphql` | the entities the GraphQL API serves |
| `src/handlers/` | one file per contract group — the event handlers |
| `src/lib/helpers.ts` | ids, load-or-create helpers, LMSR seeding maths |

There is **no contract-read layer**: every value the indexer needs is emitted by
the contracts (`HandleCreated` carries the whole creation snapshot,
`WindowOpened` the metadata, `PricesUpdated` the price vector,
`PoolStateChanged`/`StakeStateChanged` the vault/receipt state), so indexing is a
pure log consumer — no archive RPC, no per-block `eth_call`.

`Handle` and `Stake` carry **no address**: `HandleFactory.HandleCreated` registers
each deployed pair through `indexer.contractRegister`, so both contracts' events
are indexed from the block they were created in.

## Running it

```bash
npm install
npm run codegen     # after changing config.yaml or schema.graphql
npm run dev         # needs Docker
```

`envio dev` starts its own Postgres (host port **5433**, so it never touches the
oracle's 5432) and a Hasura console:

- GraphQL API — `http://localhost:8080/v1/graphql`
- Hasura console — `http://localhost:8080` (password `testing`)

> The app's dev server defaults to 8080 as well, so it is pinned to **5173** in
> `app/vite.config.ts`. Envio's console keeps 8080.

Stop it with `npm run stop`.

## Environment

`ENVIO_API_TOKEN` and `ENVIO_RPC_URL` live in `.env` (gitignored) — see
`.env.example`.

- `ENVIO_API_TOKEN` unlocks **HyperSync**, the fast historical source. Without it
  the indexer falls back to the RPC below.
- `ENVIO_RPC_URL` is the JSON-RPC data-source fallback for chain 10143 (HyperRPC):
  HyperSync serves the primary historical sync, and this carries the indexer if
  HyperSync is unavailable. It is not used for contract state reads — there are
  none.

If HyperSync rejects the token, point the RPC at the sync role (one word in
`config.yaml`) to run RPC-only:

```yaml
    rpc:
      - url: ${ENVIO_RPC_URL}
        for: sync
```

## Query syntax (Envio, not The Graph)

| The Graph | Envio |
|---|---|
| `handles` / `windows` | `Handle` / `Window` (entity name as declared) |
| `first` / `skip` | `limit` / `offset` |
| `orderBy: aura, orderDirection: desc` | `order_by: {aura: desc}` |
| `where: {active: true}` | `where: {active: {_eq: true}}` |
| `where: {handle: $id}` | `where: {handle_id: {_eq: $id}}` |
| `name_contains_nocase: $q` | `name: {_ilike: $q}` (the caller passes `%q%`) |
| `stats(id: "stats")` | `Stats_by_pk(id: "stats")` |
| `categoryIds` (a derived list) | gone — `categories` holds the plain codes (1 people · 2 crypto · 3 sports · 4 ai · 5 tech · 6 brands · 7 music · 8 memes · 9 culture) and the UI maps them |

The app's helper (`app/src/lib/indexer-page.ts`), its subscription hook
(`app/src/lib/indexer-ws.ts`) and the oracle's reader already speak this dialect.

## Windows

`envio` ships a native CLI addon for **linux and darwin only** — `codegen`, `dev`
and `start` cannot run natively on Windows. Use WSL, or the Linux CI job
(`.github/workflows/ci.yml`), which runs `npm ci && npm run codegen`.
