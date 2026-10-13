# Not Just Installed — Load-Bearing: How Aura Runs on Envio

Aura is an on-chain attention market: every handle (a person, project, coin, or brand) has a live index called its **aura**, and people trade real-money predictions on where that index is heading. All of that state — handles, markets, trades, the pool, staking — lives in smart contracts on Monad.

So the question for any data layer is simple: **can you run the whole product on it?** For Aura, Envio isn't a bolt-on. It's the only thing the app reads on-chain state from.

## Everything you see is powered by it

Every feature that shows on-chain data comes straight from Envio's indexer:

| What you do in Aura | What Envio powers |
|---|---|
| Browse handles on the Explore map | The full, always-current handle list |
| Check the leaderboard | Live rankings by aura and momentum |
| Watch a market's price chart | The complete price history, point by point |
| Read the order book | Every open order, sorted and ready |
| View your positions & open orders | Your personal trade history |
| See the pool's TVL and events | Vault growth and payouts over time |
| Follow staking on a handle | Who's backing it and what it's earning |
| Hover the aura chart to see *why* it moved | Each tick's on-chain explanation |
| Search for a handle | Instant matches — no laggy page scans |
| Read the global stats | Total handles, markets, and volume |

And the oracle backend uses the same source to decide which markets need settling — there's no hidden second database.

## It updates in real time

This isn't a page you refresh. Aura plugs into Envio's **real-time WebSocket feed**: the moment a trade lands, a window opens, or a handle's aura moves, the change appears on your screen — prices tick, the ladder reshuffles, the chart extends — without a single reload. If the connection ever drops, the app quietly falls back to polling and picks the stream back up automatically. You never see a stale price pretending to be live.

## It can't silently break

Because the app's queries are checked against the indexer's schema in every CI run, a data mismatch fails the build — not your trading session.

## And HyperRPC has its back

Envio's HyperRPC is configured as the fallback data source underneath HyperSync. If the primary sync path ever has an outage, the indexer keeps running on HyperRPC — meaning Aura doesn't go dark when one data path does.

---

*One data layer, every feature, live to the second. That's not integration — that's infrastructure.*
