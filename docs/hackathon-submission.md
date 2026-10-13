# Aura — Hackathon Submission

## Project name

**Aura — The Internet Aura Market**

## One-line description

*Aura turns real internet attention into a live, AI-scored on-chain index — then lets anyone trade prediction markets on where each name's aura goes next.*

---

## Description

**The problem**

Attention is the internet's most valuable asset, yet it doesn't trade anywhere. You can watch a coin, a startup, a musician, or a politician go viral — or get cancelled — in real time, but there's no clean way to act on that read. Existing prediction markets make you bet on discrete events ("will X happen by date Y?"): slow to resolve, easy to dispute, and a poor fit for the fuzzy thing people actually care about — *momentum*. Meanwhile the raw signal is scattered across RSS, X, Reddit, YouTube, and GitHub, and nobody prices it continuously.

**The solution**

Aura is a market where **the asset is attention itself.** Every "handle" — a person, project, coin, or brand — carries a live index called its **aura**. An AI engine reads that handle's own scoped sources on a fixed cadence and answers three questions: is the aura *improving or deteriorating*, *by how much*, and *why*. The score is written on-chain, and every time window becomes a simple binary market: **will this handle's aura close higher or lower?**

You're not betting on a press release. You're trading the trend line of the internet's mood, with a settlement source that's continuous, public, and explained.

**How it works**

1. **Ingest** — Per-handle, per-outlet adapters (RSS, X, Reddit, YouTube, GitHub, Hacker News, plus per-user OAuth connections for Spotify, Instagram, Shopify and more) pull real items with real reach — author, likes, replies, views. Every adapter fails closed without credentials and never invents a metric.
2. **Score** — A reasoning model (Kimi K2) reads the actual item *text*, not just counts, and returns a direction, a magnitude in a ±5–20% band, and a one-line rationale. The model **advises; code decides size**: the move is scaled by an evidence weight (credibility × volume × engagement) and clamped, so a confident take off one weak article moves the index far less than a broad, high-reach story.
3. **Settle** — A window resolves from the aura series with a points floor, so a tick always moves at least one unit. Every tick is hashed over the exact items the model saw, its raw reply, and the applied percent — **any settlement is replayable**: re-fetch the evidence, re-run the prompt, compare the hash. A window with no observations is deliberately left to VOID, so traders get refunded instead of resolving on a stale number.
4. **Explain** — The AI's one-line memo is written on-chain and served back as the chart tooltip's "why it moved." Every index move carries its own public explanation, and the memo is fed back into the next tick, giving the scorer memory.
5. **Trade** — LMSR market-maker pricing, an order book, a liquidity pool, outcome tokens, and staking on handles you back early — real money rails, self-custodied.

**What makes it useful**

- **A new asset class, not a new UI.** Continuous, momentum-based, explained-by-construction — a fundamentally different primitive from event betting.
- **Trust by design.** The only non-deterministic step is fenced on every side: magnitude clamped, evidence weighted, output hashed, failure contained. There's no "trust our oracle" — the oracle is auditable and replayable.
- **One code path per protocol, configured per source.** Credibility is a *config value*, not a class. Adding a handle is on-chain configuration, not prompt engineering.
- **Live to the second.** On-chain state streams over Envio's WebSocket feed; prices tick, the order book reshuffles, and the chart extends without a reload — falling back to polling only if the socket drops.
- **Zero onboarding wall.** Email login with an auto-created embedded wallet (Privy); every trade is still a genuine, user-signed on-chain transaction.

**Built with**

Monad testnet · Solidity (Handle/HandleFactory, MarketMaker LMSR, Oracle, Pool, Stake, OrderBook, RevenueSharing) · TanStack Start + Vite + Tailwind 4 · NestJS + Socket.IO · Envio HyperIndex (GraphQL + WS) · Chainlink CRE (protocol jobs as consensus-verified workflows) · Kimi K2 · Privy · Cloudinary · Postgres + Redis.

---

## Go-to-market & user acquisition strategy

**Who we're acquiring**

Three concentric audiences, each a distribution channel for the next:

1. **Crypto-native traders** on Monad — they already hold assets, understand gas, and chase narrative.
2. **Attention-economy natives** — the fans, holders, and haters of a specific name (a coin, a creator, a company) who already refresh charts all day.
3. **The handles themselves** — creators, projects, and brands who want a public, tradeable read on their own momentum.

**The wedge: each handle is its own launch campaign**

The core growth insight is structural. Aura markets aren't a generic venue you visit — **a market *is* one name and one community.** So acquisition rides on the subject:

- **Self-serve handle creation** ("Start farming aura") is the top of the funnel. Anyone can spin up a handle, and doing so *creates a market that its own audience wants to trade*. The creator becomes both market-maker and marketer.
- **Shareable, verifiable receipts.** The on-chain aura memo and the replayable tick hash give a handle something no other market does: a public, provable "here's why my number moved." That's native social content.
- **Leaderboards and rivalry.** Rankings by aura and momentum turn every handle into a scoreboard its community checks daily — the same loop that made trending lists addictive.

**Launch sequence**

- **Phase 0 — Seed the map.** Launch with a curated set of ~10 high-signal handles across distinct categories (Bitcoin, OpenAI, Taylor Swift, and peers), each with its *own scoped sources* — no generic news desk. Instant, credible depth on day one.
- **Phase 1 — Ecosystem distribution.** Monad, Envio, Chainlink, Moonshot, and Privy all have their own audiences and channels. Ship as a flagship showcase for each (live indexer, real CRE workflows, LLM settlement, embedded wallets) and mine those communities — hackathon demo days, ecosystem newsletters, co-marketing.
- **Phase 2 — Community-led expansion.** Open handle creation broadly and let the long tail fill the map. Monitor which handles attract real volume, then co-market the winners.
- **Phase 3 — Attention flywheel.** Weekly "Movers" recaps, aura-memo spotlights, and category seasons (crypto, AI, music, sports) to give returning users a reason to come back on a rhythm.

**Retention loops**

- **Live push, not refreshes.** Real-time WS updates on aura, feed, windows, and notifications make Aura a second-screen habit.
- **Early staking.** Backing a handle before it takes off gives users a stake in the story and a reason to watch it compound — with on-chain rewards distributed by automation.
- **Notifications on the names you follow** — the same trigger that drives a trade drives a comeback.

**Community & content engine**

The product generates its own marketing: every settlement is a public, hashed, replayable event, and every aura move ships with a one-line reason. We turn that into a content stream — "why OpenAI's aura dropped this hour," "the biggest movers this week" — that's both accurate and shareable, which is rare in this category.

**Partnerships & monetization**

- **Ecosystem grants and integrations** for the infrastructure partners whose rails Aura depends on.
- **Handle sponsorships** — brands and projects pay to own and promote their handle, funding awareness *and* revenue.
- **Protocol revenue** from market fees, liquidity, and staking, aligned directly with volume rather than extraction.
- **Data as a product** — the aura series and its memos are a novel, continuously-updating attention dataset with obvious downstream buyers (media, funds, marketing teams).

**Why this compounds**

Every product decision feeds the loop: markets attach to names, names bring their communities, communities bring volume, volume makes the leaderboard matter, the leaderboard recruits the next name. Aura doesn't need to buy a generic audience — **each handle recruits its own.**
