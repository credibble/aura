# Using Kimi K2 to Turn Internet Attention Into a Verifiable, Tradeable On-Chain Index

**How Aura embeds a reasoning LLM inside a blockchain settlement pipeline — and keeps it auditable**

---

## Abstract

Aura — *The Internet Aura Market* — prices the internet's attention. Every "handle" (a person, project, cryptocurrency, or brand) carries a continuous index called its **aura**, scored from real source activity (news RSS, X, YouTube, Reddit, Hacker News, GitHub, Twitch), and every market window is a binary prediction market on where that index closes. The protocol's state — handles, windows, an LMSR automated market maker, staking vaults, and fee splitting — is deterministic Solidity, fully auditable on Monad testnet. The one component that requires genuine judgment rather than arithmetic is the aura scoring tick, and for that Aura uses **Moonshot's Kimi K2** via the chat-completions API.

This article describes the integration in full: the structured output contract, the on-chain memo pipeline, the deterministic guardrails that constrain the model's influence, and the reliability engineering required to run one reasoning model across ten continuously ticking markets. It concludes with measured results and a set of practical lessons for teams placing a language model inside a system that settles funds.

---

## 1. Introduction

Financial markets have long priced events — elections, earnings, sporting outcomes. What they have never priced well is **attention itself**: the fastest-moving, most consequential asset of the internet era. A product launch, a scandal, or a viral moment reprices a person's or a brand's public standing within minutes, yet sentiment tooling remains dominated by lagging dashboards, manual polls, and keyword-counting heuristics that cannot distinguish a product launch from a recall when both appear as "twelve mentions, high engagement."

Aura closes that gap with a simple mechanism: a continuously re-scored index per handle, and binary markets that settle on the index value each window actually closes at. The engineering philosophy behind Aura is strict separation of concerns:

| Layer | Component | Property |
|---|---|---|
| Protocol | Solidity contracts (Handle, MarketMaker, Pool, Stake, OrderBook, RevenueSharing) | Deterministic, auditable, on-chain |
| Data | Envio HyperIndex indexer + oracle REST API | Reproducible from contract events |
| Judgment | **Kimi K2 aura scoring** | The single non-deterministic step — fenced on every side |

Every aura tick passes through Kimi. The remainder of this article explains exactly what the model is asked to do, what it is permitted to do, and how the surrounding system converts a natural-language judgment into a number that money settles against.

---

## 2. Problem Statement

Each aura tick must answer three questions for a single handle, given its recent activity across all of its configured sources:

1. **Direction** — is the handle's standing improving or deteriorating?
2. **Magnitude** — by how much, on a bounded scale?
3. **Rationale** — what was the decisive signal, stated in one line?

The first two determine the index movement and therefore the settlement of any open market window. The third is the public explanation attached to the data point.

Three properties make this problem unsuitable for conventional approaches:

- **Heterogeneous evidence.** A single prompt contains wire-service headlines, Reddit threads with upvote ratios, YouTube titles, Twitch stream names, and API metrics. Interpreting them requires reading *text*, not counting rows.
- **Context dependence.** The same entity appearing in the news fifty times can be strongly positive, strongly negative, or neutral, depending entirely on what the coverage says.
- **Public accountability.** Because the index settles markets, every movement must carry an explanation and be independently replayable. A black-box score is not acceptable.

These constraints define the integration design: a reasoning model supplies judgment; deterministic code supplies bounds, evidence weighting, and audit.

---

## 3. Integration Architecture

The Kimi integration consists of four layers, described in Sections 3.1–3.4, followed by the reliability layer in Section 3.5.

### 3.1 Output Contract: A Two-Field JSON Object

`KimiAiModel.scoreWithSummary()` sends the handle's recent source activity — grouped per source, each item truncated to 240 characters — and requires a strict JSON reply:

```json
{ "percent": -12.4, "summary": "openai ships enterprise api tier amid analyst upgrades" }
```

The system prompt is deliberately small and constrained. It defines magnitude bands — 5–8% modest, 8–12% moderate, 12–16% large, and 16–20% very large, the last reserved for *"decisive, high-reliability events only"*, with symmetric bands for negative movement — and a single judgment rule: *"score SENTIMENT from item texts, not metric counts; account for every `<<MENTION>>` item; never invent events."* Items matching the handle's configured topic are prefixed `<<MENTION>>` in the prompt, allowing the model to distinguish ambient chatter from substantive coverage.

Two configuration decisions were dictated directly by the model's observed behavior:

- **Temperature is pinned to 1.** The `kimi-k2.*` family rejects any other value with HTTP 400; the parameter is therefore hard-coded rather than configurable.
- **Token budgets are sized for reasoning.** In reasoning models, thinking tokens are consumed from `max_tokens` before any answer is produced. During development, a call budgeted at 256 tokens spent 255 reasoning tokens and returned empty content with `finish_reason: "length"`; even a minimal JSON answer required approximately 985 tokens. All paths are therefore budgeted at 8,192 tokens, with a 300-second request timeout (180 seconds was aborting legitimate calls mid-deliberation).

### 3.2 The On-Chain Memo: Explanation as a First-Class Product

Kimi does not only move the index; it explains the movement. The `summary` field is subject to a hard cap — at most twelve words, truncated at 120 characters (because it is written on-chain, where length is gas), stripped of quotes, brackets, and trailing punctuation — and is passed directly into `Handle.updateAura(aura, summary)` on Monad.

From there the memo traverses the entire stack: it is indexed into `AuraHistory.summary`, broadcast over WebSocket, and rendered in the trade page's chart tooltip under the label **"Aura memo."** When the index dips, the chart says why, in the model's own words, committed on-chain at the moment of decision.

The memo also serves as the model's short-term memory: each tick's summary is cached and returned to the next call as a `PREVIOUS TICK` line (`aura`, `delta`, `summary`), giving the scorer continuity across a handle's history without maintaining any external state machine.

### 3.3 Guardrails: The Model Advises; Code Decides Size

The model's answer is treated as **authoritative in direction and advisory in magnitude**. The `AuraEngineService` applies three deterministic transformations before any value reaches the chain:

1. **Evidence weighting.** `evidenceWeight()` computes a factor in `[0.25, 1.0]` from credibility-weighted fresh item volume plus a logarithmic engagement bonus. A confident answer backed by a single weak item is scaled down; a broad, high-reach story is not.
2. **Band clamping.** The applied movement is clamped to the ±5–20% band regardless of the model's raw answer, and a one-point floor guarantees that no tick can round to zero — a dead tick would allow a market window to open and close on an unchanged series, which the protocol forbids.
3. **Audit hashing.** Every applied tick is hashed with `keccak256` over the handle, timestamp, baseline, the exact item identifiers the model saw, the model's *raw* reply, and the applied percent. The hash is published with the aura event, making every settlement replayable: re-fetch the cited items, re-run the prompt, compare the hash.

The governing invariant is stated in the protocol's own documentation: *the model never decides size alone*, and *nothing resolves without an observation*.

### 3.4 Fail-Closed Parsing

Because reasoning models occasionally spend their entire budget thinking and return empty content, the parser treats every malformed answer as a failure rather than a value: empty completions throw, junk strings resolve to zero rather than `NaN`, bare numbers and legacy response keys are tolerated, and any thrown error causes the tick to fall back to a mechanical memo instead of corrupting the series. An index that occasionally skips a tick is acceptable; an index that writes a garbage value is not.

### 3.5 Reliability Engineering: One Slot, Globally

Kimi rejects a second concurrent request with HTTP 429 (`"max organization concurrency: 1"`). Because Aura's API and worker containers score ten handles continuously, the request path was turned into a small scheduler:

- an **in-process promise chain** serializing calls within each process;
- a **Redis distributed lock** (`aura:kimi:single-slot`) serializing calls across containers, released via a Lua compare-and-delete with a TTL above the request timeout;
- a configurable **minimum inter-call gap** (2.5 seconds in production), tracked in Redis;
- **four retry attempts** with exponential backoff, covering 429s, 5xxs, *and* thrown fetches — a DNS blip is as transient as a server error and previously cost the tick.

Three complementary economic gates reduce load at the source: the aura queue runs with concurrency one (additional workers would only generate 429s), adapter fetches pass through a shared Redis cache, and each handle is limited to at most one AI call per 60 seconds, coalescing item bursts. A `DEBUG_MODE` switch hard-offlines every model call for the test suite and for live demonstrations, guaranteeing that no rate limit can stall a demo.

---

## 4. Value Delivered by Kimi

**4.1 Text-level judgment across heterogeneous sources.** A single prompt carries wire-service headlines, Reddit threads, YouTube titles, and API metrics; Kimi reads them as normalized volume and engagement plus raw item text and reasons across them jointly. No per-platform sentiment model and no keyword lists were required.

**4.2 Explanation generated in the same pass as the decision.** The two-field JSON contract yields direction, magnitude, and a publishable one-line rationale from a single completion. This converted a black-box index into a product in which every data point carries a human-readable reason, on-chain, at no additional model cost.

**4.3 Context that heuristics cannot reproduce.** "Entity in the news" is plus six points or minus fifteen depending on *what* the news is. The model distinguishes a delivery beat from a recall, weights a high-reliability wire service above a meme account, and honors the prior tick's memo when a story develops slowly — all from prompt context alone.

**4.4 Containment within the trust boundary.** The only reason an AI answer is acceptable in a settlement path is that its influence is fenced on every side: parsed tolerantly, clamped to ±20%, scaled by a deterministic evidence factor, hashed for replay, and fail-closed on empty replies.

**4.5 Scale through configuration, not prompt engineering.** All ten seeded handles — Bitcoin, Ethereum, Solana, OpenAI, Tesla, Elon Musk, Donald Trump, Cristiano Ronaldo, Lionel Messi, and Taylor Swift — run through the identical pipeline. Adding a handle is an on-chain configuration of source reliability, context, and topic; no prompt changes were needed.

---

## 5. Results

- **A live, replayable AI-driven index.** Every aura movement is a Kimi answer, passed through deterministic guardrails, written on-chain on Monad testnet with a public memo, and committed to a `keccak256` audit hash binding the tick to the exact evidence the model observed.
- **Markets that settle on evidence.** Window settlement requires a real observation; the points floor ensures every tick moves the index, so no window can open and close on a flat series, and every resolution carries Kimi's memo as its public rationale.
- **Operational stability under constraint.** The single-slot lock, backoff, coalescing gate, and debug mode have together sustained continuous scoring through rate limits, network faults, and continuous integration runs without stalling a market window.
- **One model call, three surfaces.** The trade-page tooltip, the social feed digest, and the on-chain record all originate from the same tick — a single structured completion serving the interface, the community, and the ledger.

---

## 6. Lessons for Teams Placing an LLM in a Settlement Path

1. **Let the model judge; let code decide size.** Direction can be delegated to the model with confidence; magnitude should always be re-derived from deterministic evidence weighting and hard bounds.
2. **Constrain output at the token level, not the prose level.** Structured-output mode, a twelve-word cap, and a hard character trim outperform any amount of instruction to "please respond in JSON."
3. **Budget for reasoning tokens.** Every empty reply observed during development was a `finish_reason: "length"` failure; size `max_tokens` for the thinking, not for the answer.
4. **Assume the tightest concurrency limit.** Build the distributed lock, the inter-call gap, and the backoff before the first demonstration, not after the first 429 storm.
5. **Hash the prompt inputs.** The audit hash is what makes an AI-generated number acceptable in a system that settles money: anyone can re-execute the exact tick and verify the result.
6. **Fail closed, always.** A skipped tick degrades gracefully; a garbage tick poisons the series and every market that settles on it.

---

## 7. Conclusion

Aura demonstrates a workable pattern for embedding a reasoning language model inside a financial settlement pipeline without surrendering determinism or auditability. Kimi K2 supplies the judgment that counting cannot: reading a dozen source formats jointly, distinguishing substance from noise, and explaining its decision in a single line that is written on-chain and served back to traders in the chart tooltip. Everything the model touches is bounded — direction advised, magnitude clamped, evidence weighted, output hashed, and failure contained. The result is an attention index that a market can safely settle against, and a blueprint for any team that needs an LLM's taste without granting it the keys.

---

*Aura — The Internet Aura Market. Built on Monad testnet with Solidity, NestJS, Envio HyperIndex, and Kimi K2 by Moonshot. Spot it early. Trade it first.*
