# Aura's Maintenance Crew Runs on Chainlink CRE

Every prediction market needs housekeeping: rewards to distribute, handles to promote, checks to run every hour on the clock. Most projects run this stuff as a cron job on a rented server — a silent process nobody can audit that dies quietly with the VM. Aura does it differently: **its two recurring protocol jobs are Chainlink CRE workflows** — code-first, consensus-verified, running as first-class on-chain actors.

## What CRE is doing here

CRE is Aura's **orchestration layer** for everything the protocol needs to do on a schedule. Both workflows are written in TypeScript with the CRE SDK (`@chainlink/cre-sdk`), compiled to WASM, and deployed with the `cre` CLI. Each one is a small, readable pipeline of CRE capabilities:

> **Cron trigger → read the world → decide → write on-chain**

No bot server, no keeper subscription, no "trust me, my script is running."

## Workflow 1: Stake gifting — rewarding the early backers

Aura stakers back a handle early and earn a share of its vault. To keep that yield real, the protocol's treasury periodically **gifts AURA to the stake vaults** — every staker's share price rises, and the gift is labeled on-chain with a memo so anyone can see exactly why the vault grew.

Running every hour in production, the CRE workflow:

1. **Fires on a cron schedule** built into the workflow (`CronCapability`) — no external scheduler.
2. **Reads each stake vault's AURA balance** directly on-chain.
3. **Decides** — vaults already above the funding threshold are skipped; only the underfunded get topped up.
4. **Writes on-chain** — `approve`, then `Stake.reward(amount, "CRE reward")`, a consensus-verified EVM write that lands in the contract's audit trail.

The contracts were built for this: `Stake.reward()` exists specifically for the CRE gift, with its own `Rewarded(amount, memo)` event. The tests even rehearse it — *"the vault numerator grows WITHOUT minting shares."*

## Workflow 2: Graduation — promoting handles that earn it

In Aura, only "graduated" handles are allowed to open trading windows. The graduation decision is now made by a CRE workflow rather than a human button:

1. **Cron fires every 15 minutes.**
2. **HTTP capability queries Aura's Envio indexer** — a consensus-verified read of live chain state: *which handles have aura above the threshold and haven't graduated yet?*
3. **Decides** — handles strictly above the aura threshold qualify, up to a hundred per run; an unreadable response means the run skips safely.
4. **Writes on-chain** — `Handle.setGraduated(true)` for each winner. That single flag is what the market-maker checks before opening a window, so a quiet CRE workflow is literally what lets a rising handle start trading.

This is the orchestration layer doing what it does best: **a data read off-chain, a decision, and an authorized write**, composed in one auditable piece of code.

## Why it matters

- **It's protocol behavior, not server behavior.** The workflows live in the repo (`cre/reward`, `cre/graduation`), get reviewed in PRs, and run as consensus-verified code — the same trust model as everything else on-chain.
- **The reads are as trustworthy as the writes.** The graduation workflow's indexer query goes through CRE's HTTP capability, so the decision inputs are verified, not blind-fired.
- **Secrets stay in the DON.** The treasury key (`CRE_ETH_PRIVATE_KEY`) is a declared CRE secret — never committed, never on a laptop.
- **Staging and production are config, not redeployments.** Each workflow ships `staging` and `production` targets (Monad testnet RPC in both) and per-environment schedules — hourly gifting in production, every 15 minutes for graduation.

---

*Two workflows, one pattern: trigger, read, decide, write. Chainlink CRE runs the parts of Aura that used to need a server — and makes them verifiable instead of invisible.*
