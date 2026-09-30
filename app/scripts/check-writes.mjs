/**
 * Contract-surface check — runs the app's real ABIs through viem and encodes
 * every write path, so the whole write surface is verified without an RPC.
 *
 * Why this exists: the ABIs in `src/lib/chain.ts` are human-readable strings that
 * MUST be `parseAbi`-ed (raw strings made `encodeFunctionData` throw
 * "Cannot use 'in' operator to search for 'name'…"). This script fails loudly if
 * that regresses, if a function name is misspelled, or if arg arity/types drift.
 *
 *   node scripts/check-writes.mjs
 *
 * The ABI strings are duplicated here on purpose and checked BACK against
 * chain.ts, so drift between the two fails the run.
 */
import { readFileSync } from "node:fs";
import { encodeFunctionData, parseAbi } from "viem";

const chainSrc = readFileSync(new URL("../src/lib/chain.ts", import.meta.url), "utf8");

const ERC20 = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)",
];
const MARKET_MAKER = [
  "function buy(address oracle, uint256 outcome, uint256 amountIn, uint256 minShares)",
  "function sell(address oracle, uint256 outcome, uint256 delta, uint256 minProceeds)",
  "function claim(address oracle, uint256 outcome)",
  "function outcomeTokenOf(address oracle, uint256 outcome) view returns (address)",
  "function shares(address user, address oracle, uint256 outcome) view returns (uint256)",
  "function priceOf(address oracle, uint256 outcome) view returns (uint256)",
  "function sellProceeds(address oracle, uint256 outcome, uint256 delta) view returns (uint256)",
  "function approve(address oracle, uint256 outcome, uint256 amount)",
  "function isOpen(address oracle) view returns (bool)",
];
const ORDER_BOOK = [
  "function placeOrder(address oracle, uint256 outcome, bool side, uint256 price, uint256 size, uint256 expiresAt) returns (bytes32)",
  "function cancelOrder(address oracle, bytes32 orderId)",
  "function remainingOf(bytes32 orderId) view returns (uint256)",
  "function isActive(bytes32 orderId) view returns (bool)",
];
const STAKE = [
  "function deposit(uint256 amount)",
  "function withdraw(uint256 shares)",
  "function reward(uint256 amount, string memo)",
  "function valuePerToken() view returns (uint256)",
  "function earned(address user) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
];
const POOL = [
  "function deposit(uint256 amount)",
  "function withdraw(uint256 shares)",
  "function idle() view returns (uint256)",
  "function valuePerToken() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalReserved() view returns (uint256)",
  "function earned(address user) view returns (uint256)",
];
const HANDLE = [
  "function claim()",
  "function addSource(string source)",
  "function setMetadata(string metadata)",
  "function aura() view returns (uint256)",
  "function sourcesCount() view returns (uint256)",
];
const HANDLE_FACTORY = [
  "function createHandle(bytes32 handleId, address creator, string name, string symbol, string metadata, uint256 windowMinutes, uint256 category) returns (address)",
];

const ADDR = "0x1111111111111111111111111111111111111111";
const ORACLE = "0x2222222222222222222222222222222222222222";
const E18 = 10n ** 18n;
const MAX = (1n << 256n) - 1n;

/** Every write the app can send: [label, abi, function, args]. */
const WRITES = [
  ["approve USDC", ERC20, "approve", [ADDR, 10n * E18]],
  ["approve AURA (max)", ERC20, "approve", [ADDR, MAX]],
  ["buy", MARKET_MAKER, "buy", [ORACLE, 0n, 10n * E18, 9n * E18]],
  ["sell", MARKET_MAKER, "sell", [ORACLE, 0n, 5n * E18, 4n * E18]],
  ["claim", MARKET_MAKER, "claim", [ORACLE, 0n]],
  ["approve outcome shares (max)", MARKET_MAKER, "approve", [ORACLE, 0n, MAX]],
  ["placeOrder buy", ORDER_BOOK, "placeOrder", [ORACLE, 0n, true, 5n * 10n ** 17n, 10n * E18, 0n]],
  ["placeOrder sell", ORDER_BOOK, "placeOrder", [ORACLE, 1n, false, 9n * 10n ** 17n, 3n * E18, 0n]],
  ["cancelOrder", ORDER_BOOK, "cancelOrder", [ORACLE, `0x${"ab".repeat(32)}`]],
  ["stakeDeposit", STAKE, "deposit", [100n * E18]],
  ["stakeWithdraw", STAKE, "withdraw", [50n * E18]],
  ["stakeReward", STAKE, "reward", [10n * E18, "memo"]],
  ["poolDeposit", POOL, "deposit", [100n * E18]],
  ["poolWithdraw", POOL, "withdraw", [50n * E18]],
  ["handleClaim", HANDLE, "claim", []],
  ["handleAddSource", HANDLE, "addSource", ['{"platform":"x"}']],
  ["handleSetMetadata", HANDLE, "setMetadata", ['{"name":"Aura"}']],
  [
    "handleFactory.createHandle",
    HANDLE_FACTORY,
    "createHandle",
    [`0x${"00".repeat(32)}`, ADDR, "Aura", "AURA", "{}", 30n, 100_001_001n],
  ],
];

let failures = 0;
console.log("Contract write surface\n");

for (const [label, entries, fn, args] of WRITES) {
  // 1. Every human-readable entry must exist verbatim in chain.ts (no drift).
  const missing = entries.filter((e) => !chainSrc.includes(`"${e}"`));
  if (missing.length) {
    failures++;
    console.log(`  ✗ ${label.padEnd(28)} ABI drift — not in chain.ts: ${missing[0].slice(0, 60)}…`);
    continue;
  }
  // 2. The ABI must parse (raw strings break encodeFunctionData).
  let abi;
  try {
    abi = parseAbi(entries);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${label.padEnd(28)} parseAbi failed: ${e.message.split("\n")[0]}`);
    continue;
  }
  // 3. The call must encode to real calldata.
  try {
    const data = encodeFunctionData({ abi, functionName: fn, args });
    if (!/^0x[0-9a-f]+$/.test(data) || data.length < 10) throw new Error("empty calldata");
    console.log(`  ✓ ${label.padEnd(28)} ${fn}() → ${data.slice(0, 10)}… (${(data.length - 2) / 2} bytes)`);
  } catch (e) {
    failures++;
    console.log(`  ✗ ${label.padEnd(28)} encode failed: ${e.message.split("\n")[0]}`);
  }
}

console.log(
  failures === 0
    ? `\nAll ${WRITES.length} write paths encode.\n`
    : `\n${failures} of ${WRITES.length} write paths FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
