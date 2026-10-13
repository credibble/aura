# Privy: Trading On-Chain Without the Onboarding Headache

Prediction markets live or die on the first thirty seconds. If a newcomer has to install a
browser extension, buy gas, and paste a seed phrase before they can take a position, they're
gone. Aura uses **Privy** to erase that wall: an email address is enough to start trading —
while every write still stays a real, self-custodied on-chain transaction.

## Email in, wallet out

Aura signs users in with Privy using **email or an existing wallet** — nothing else to install.
The moment an email user logs in, Privy's config (`createOnLogin: "all-users"`) **creates an
embedded Ethereum wallet for them automatically**. No seed phrase to write down, no extension
to trust — the newcomer doesn't even need to know a wallet exists. Veterans simply connect the
wallet they already use. Both live side by side in the app, embedded preferred.

## That wallet is the real signer

This isn't a custodial IOU. **Every trade, stake, claim, and handle creation is a genuine
contract write signed by the user's Privy wallet.** Before any signature, the app makes sure
the wallet is on Monad testnet — switching or adding the chain for the user — then sends the
transaction and waits for the receipt. Same keys, same chain, zero crypto homework.

## One signature opens the social app

The trading side is on-chain; likes, follows, comments, notifications, and handle profiles live
on Aura's backend. Privy's wallet bridges the two with a single `personal_sign`: the app asks
the wallet to sign a short "Aura login" message with a fresh nonce, and the backend verifies
the signature and mints a session token. The identity is always the wallet address itself —
proven by signature, never by a username. (The backend never talks to Privy at all; it just
recovers the signer, which means no vendor lock-in on the server side.)

## Where it shows up

- **Every "Sign in" in the app** — feeds, portfolio, pool, notifications, comments — funnels through one Privy login.
- **The trade page** — no wallet? You get a prompt, not a dead button.
- **The account popover** — copy address, USDC/AURA balances, disconnect — all driven by the Privy wallet.
- **The live socket** — even the real-time push channel authenticates with the same signed identity.

---

*One login, an instant wallet, real on-chain trades. Privy carries the onboarding so the market can get to the interesting part.*
