# Using Kimi K2 to Turn Internet Attention Into a Tradeable On-Chain Index

Aura — *The Internet Aura Market* — prices the internet's attention. Every "handle" (a person, project, coin, or brand) carries an index called its **aura**, scored from real source activity (news RSS, X, YouTube, Reddit, GitHub), and every market window is a binary prediction market on where that aura closes. The protocol is deterministic Solidity on Monad testnet — the one step needing real judgment is the scoring tick, and for that Aura uses **Moonshot's Kimi K2**.

## How It Works

Each tick asks Kimi three things about one handle: **direction** (improving or deteriorating?), **magnitude** (by how much?), and **rationale** (the decisive signal, in one line). Counting cannot answer this — fifty news mentions can be strongly positive or strongly negative depending on what the coverage *says*.

The model returns a strict JSON object:

```json
{ "percent": -12.4, "summary": "openai ships enterprise api tier amid analyst upgrades" }
```

The prompt defines magnitude bands (5–20%, symmetric for negatives) and one rule: *score sentiment from item texts, not metric counts; never invent events.*

The `summary` is capped at twelve words and written **on-chain** via `Handle.updateAura`, then served back to traders as the chart tooltip's "Aura memo" — every index move carries its own public explanation. It is also fed back to the next tick, giving the scorer memory across a handle's history.

Crucially, **the model advises; code decides size**. Before any value reaches the chain:

- an evidence weight (credibility × volume × engagement, clamped to `[0.25, 1.0]`) scales the model's magnitude down when the backing signal is weak;
- the applied move is clamped to ±5–20%, with a floor so no tick rounds to zero;
- every tick is hashed (`keccak256` over the exact items the model saw, its raw reply, and the applied percent), so any settlement is replayable — re-fetch the evidence, re-run the prompt, compare the hash.

Because Kimi allows one in-flight request per organization, ten handles run through a Redis-backed single-slot scheduler with a 2.5s gap, retries with backoff, and a 60-second coalescing gate per handle.

## What Kimi Delivered

- **Judgment across a dozen source formats** — wire headlines, Reddit threads, and API metrics read jointly in one prompt. No per-platform sentiment models, no keyword lists.
- **Explanation generated with the decision** — one completion produces the number *and* the on-chain reason behind it.
- **Scale through configuration** — all ten seeded handles (Bitcoin, OpenAI, Taylor Swift, and seven more) run the identical pipeline; adding a handle is on-chain config, not prompt engineering.

## The Takeaway

Putting a reasoning LLM inside a system that settles money is safe only if the model is fenced on every side: direction advised, magnitude clamped, evidence weighted, output hashed, failure contained. Kimi supplied the taste; the protocol kept the keys.

---

*Built on Monad testnet with Solidity, NestJS, and Kimi K2 by Moonshot.*
