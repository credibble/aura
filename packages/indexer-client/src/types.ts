/**
 * Aura subgraph entity types. Subgraph BigInt/Int scalars arrive as strings in
 * GraphQL JSON, so those fields are typed `string` (helpers convert to number
 * / bigint when needed). Bytes are `0x…` hex strings.
 */

/** A creator (address) — one creator may own MANY handles. */
export interface Creator {
  id: string; // address hex
  handleCount: number;
}

/** The top-level on-chain handle entity. */
export interface Handle {
  id: string; // handleId bytes32 hex
  contract: string;
  owner: string; // creator address hex
  name: string;
  symbol: string;
  metadata: string;
  market: string;
  oracleFactory: string;
  revenue: string;
  stake: string;
  sources: string[];
  aura: string; // live Aura score (1e2)
  graduated: boolean;
  category: string; // market-style category code (BigInt, e.g. "100001001")
  pendingOwner: string;
  windowMinutes: string;
  active: boolean;
  windowCount: number;
}

/** One prediction window on the MarketMaker (LMSR). */
export interface IndexWindow {
  id: string; // `${handleId}-${windowStart}`
  handle: string; // handleId hex
  oracle: string;
  oracleMetadata: string; // the window metadata JSON
  handleId: string;
  windowStart: string;
  windowEnd: string;
  outcomes: string[]; // outcome names, e.g. ["YES","NO"]
  initialProbabilities: string[]; // 1e18-seeded LMSR prices at open
  liquidity: string; // LMSR depth b = funding/ln(n), 1e18
  q: string[]; // outstanding shares per outcome (1e18)
  reference: string;
  timestamp: string;
  cash: string;
  settled: boolean;
  winningOutcome: number | null;
  reserved: string;
  paidOut: string;
  volume: string; // cumulative buy premium (USDC 1e18)
}

export type PoolEventKind = "RESERVED" | "PAID_OUT" | "UNRESERVED";

export interface PoolEvent {
  id: string;
  pool: string;
  oracle: string; // the window oracle — the canonical window identity
  kind: PoolEventKind;
  amount: string;
  to: string | null;
  timestamp: string;
}

export interface IndexTrade {
  id: string;
  window: string;
  user: string;
  outcome: number;
  kind: string; // BUY | SELL | CLAIM
  premium: string;
  proceeds: string;
  shares: string;
  price: string;
  ts: string;
}

export interface Order {
  id: string;
  window: string;
  maker: string;
  outcome: number;
  side: boolean;
  price: string;
  size: string;
  filled: string;
  expiresAt: string;
  status: string; // ACTIVE | FILLED | CANCELLED
  createdAt: string;
}

export interface OrderFill {
  id: string;
  order: string;
  window: string;
  taker: string;
  outcome: number;
  shares: string;
  price: string;
  ts: string;
}

export interface User {
  id: string; // address hex - one entity per account (owns handles + trades)
  handleCount: number;
  totalPremium: string;
  totalProceeds: string;
}

/** Maps a window oracle address to its IndexWindow (events log the oracle). */
export interface OracleWindow {
  id: string; // oracle address hex
  window: IndexWindow;
}

/** The JSON metadata string stored on the Oracle / OutcomeToken (parsed shape). */
export interface WindowMetadata {
  handleId?: string;
  handle?: string;
  oracle?: string;
  windowStart?: string;
  windowEnd?: string;
  strike?: string;
  outcomes?: string[];
  [key: string]: string | number | boolean | string[] | undefined;
}

/** The OutcomeToken metadata (per position: window + outcome). */
export interface OutcomeTokenMetadata {
  handle?: string;
  handleId?: string;
  oracle?: string;
  outcome?: number;
  name?: string;
  strike?: string;
  windowStart?: string;
  windowEnd?: string;
  [key: string]: string | number | boolean | undefined;
}

/** Query result shapes (subgraph returns arrays for list fields). */
export interface HandlesQuery {
  handles: Handle[];
}

export interface HandleQuery {
  handle: Handle | null;
}

export interface WindowsQuery {
  indexWindows: IndexWindow[];
}

export interface WindowQuery {
  indexWindow: IndexWindow | null;
}

export interface OracleWindowQuery {
  oracleWindow: OracleWindow | null;
}

export interface PoolEventsQuery {
  poolEvents: PoolEvent[];
}

export interface TradesQuery {
  indexTrades: IndexTrade[];
}

export interface OrdersQuery {
  orders: Order[];
}

export interface OrderFillsQuery {
  orderFills: OrderFill[];
}

export interface UserQuery {
  user: User | null;
}

export interface UsersQuery {
  users: User[];
}

export interface CountQuery {
  handles: { id: string }[];
  indexWindows: { id: string }[];
}

/** Pagination options for list queries. */
export interface Page {
  first?: number;
  skip?: number;
}