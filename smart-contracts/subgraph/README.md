# Aura subgraph

Indexes the Aura prediction protocol — **live binary UP/DOWN digital options on
the continuous aura index (0-100)**, priced by an SVI/Black-Scholes surface, plus
the limit-order exchange on those positions.

## Design

Each market window is a strike on the aura index at a window close:
- **UP** pays 1 USDC per share if the closing index > strike; **DOWN** pays if
  it is ≤ strike (mutually exclusive).
- The **oracle seeds the SVI surface** (a, b, rho, m, sigma) and pushes the
  **live reference index** every tick (10s / 1m / 10m windows). Position value =
  `P(close > strike | live index, remaining time)` moves in real time, so you can
  see profit and **sell early** (`sell`) without waiting for settlement, then
  `claim` 1:1 if your side wins.
- The **order book** matches UP/DOWN shares between makers/takers (buys escrow
  USDC, sells escrow shares); matching is routed off-chain — takers submit the
  specific resting order ids to fill.

Every window has its own `WindowOracle` (deployed by the `OracleFactory`), and
events log the oracle address — windows are keyed here by `${handleId}-${windowStart}`
with the oracle address stored on `IndexWindow`.

## Entities (what the frontend queries)

| Entity | Purpose |
| ------ | ------- |
| `Handle` | Registered handles/markets (`@btc`, `@ai`, …) |
| `IndexWindow` | One window: strike, SVI surface, **live reference index**, total UP/DOWN shares, cash, settlement result |
| `IndexTrade` | Every buy / live sell / settled claim (side, premium/proceeds, shares, price) |
| `User` | Trader rollups (total premium, total proceeds) |
| `Order` / `OrderFill` | Resting limit orders + executions (status ACTIVE/FILLED/CANCELLED, isUp, side) |

Scalars: amounts/prices are 1e18; the index, strike and reference are 1e2
(50.00 = 5000); timestamps are epoch seconds.

## Deploy

1. Set the real contract addresses in `subgraph.yaml` (MarketRegistry,
   OracleFactory, IndexMarket, OrderBook) and the correct `network` for the
   indexer node (e.g. `monad-testnet`).
2. `npm install`
3. `npm run codegen && npm run build` — validates the schema + mappings.
4. Deploy: `npm run create:local && npm run deploy:local` (graph-node) or
   `npm run deploy:studio` (Subgraph Studio).

## Example query

```graphql
{
  indexWindows(orderBy: windowStart, orderDirection: desc, first: 20) {
    id
    oracle
    strike
    reference
    totalUp
    totalDown
    settled
    downWon
    finalIndex
    trades { kind side shares price }
  }
}
```