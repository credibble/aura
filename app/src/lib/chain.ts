import { parseAbi, type Chain } from "viem";

/**
 * Chain RPC. The public Monad testnet endpoint rate-limits under load (reads
 * fail mid-trade as "HTTP request failed"), so it is overridable — point
 * `VITE_RPC_URL` at an Alchemy/private endpoint for a stable session.
 */
export const RPC_URL = import.meta.env.VITE_RPC_URL ?? "https://testnet-rpc.monad.xyz";

/** Monad testnet — the Aura home chain. */
export const monad = {
  id: 10_143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [RPC_URL] },
    public: { http: [RPC_URL] },
  },
} as const satisfies Chain;

/** Deployed contract addresses (VITE_* env override). */
export const CONTRACTS = {
  marketMaker: (import.meta.env.VITE_MARKET_MAKER_ADDRESS ?? "") as string,
  orderBook: (import.meta.env.VITE_ORDER_BOOK_ADDRESS ?? "") as string,
  handleFactory: (import.meta.env.VITE_HANDLE_FACTORY_ADDRESS ?? "") as string,
  pool: (import.meta.env.VITE_POOL_ADDRESS ?? "") as string,
  auraToken: (import.meta.env.VITE_AURA_TOKEN_ADDRESS ?? "") as string,
  usdc: (import.meta.env.VITE_USDC_ADDRESS ?? "") as string,
  revenueSharing: (import.meta.env.VITE_REVENUE_SHARING_ADDRESS ?? "") as string,
};

/**
 * ABIs are PARSED here on purpose: viem reads accept human-readable strings, but
 * `encodeFunctionData` (our write path) needs a real ABI — raw strings made every
 * write throw `Cannot use 'in' operator to search for 'name' in function …`.
 */
export const ERC20_ABI = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export const AU_ABI = ERC20_ABI;

/** Test collateral only — `MockUSDC.mint` is public on testnet. */
export const MINT_ABI = parseAbi(["function mint(address to, uint256 amount)"]);

export const MARKET_MAKER_ABI = parseAbi([
  "function buy(address oracle, uint256 outcome, uint256 amountIn, uint256 minShares)",
  "function sell(address oracle, uint256 outcome, uint256 delta, uint256 minProceeds)",
  "function claim(address oracle, uint256 outcome)",
  "function outcomeTokenOf(address oracle, uint256 outcome) view returns (address)",
  "function shares(address user, address oracle, uint256 outcome) view returns (uint256)",
  "function priceOf(address oracle, uint256 outcome) view returns (uint256)",
  "function sellProceeds(address oracle, uint256 outcome, uint256 delta) view returns (uint256)",
  "function approve(address oracle, uint256 outcome, uint256 amount)",
  "function isOpen(address oracle) view returns (bool)",
  "function buyCost(address oracle, uint256 outcome, uint256 delta) view returns (uint256)",
  "function feeBips() view returns (uint256)",
]);

/** Resting limit orders — escrowed USDC (buy) or MarketMaker outcome shares (sell). */
export const ORDER_BOOK_ABI = parseAbi([
  "function placeOrder(address oracle, uint256 outcome, bool side, uint256 price, uint256 size, uint256 expiresAt) returns (bytes32)",
  "function cancelOrder(address oracle, bytes32 orderId)",
  "function remainingOf(bytes32 orderId) view returns (uint256)",
  "function isActive(bytes32 orderId) view returns (bool)",
]);

export const STAKE_ABI = parseAbi([
  "function deposit(uint256 amount)",
  "function withdraw(uint256 shares)",
  "function reward(uint256 amount, string memo)",
  "function valuePerToken() view returns (uint256)",
  "function earned(address user) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
]);

export const POOL_ABI = parseAbi([
  "function deposit(uint256 amount)",
  "function withdraw(uint256 shares)",
  "function idle() view returns (uint256)",
  "function valuePerToken() view returns (uint256)",
  "function totalAssets() view returns (uint256)",
  "function totalReserved() view returns (uint256)",
  "function earned(address user) view returns (uint256)",
]);

export const HANDLE_FACTORY_ABI = parseAbi([
  "function createHandle(bytes32 handleId, address creator, string name, string symbol, string metadata, uint256 windowMinutes, uint256[] categories) returns (address)",
]);

export const HANDLE_ABI = parseAbi([
  "function claim()",
  "function addSource(string source)",
  "function setMetadata(string metadata)",
  "function aura() view returns (uint256)",
  "function sourcesCount() view returns (uint256)",
]);

/** Encode a handle id as left-aligned bytes32 (mirrors the chain). */
export function encodeBytes32(s: string): `0x${string}` {
  const hex = Buffer.from(s, "utf8").toString("hex").padEnd(64, "0");
  return `0x${hex}` as `0x${string}`;
}
