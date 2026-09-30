import type {
  CountQuery,
  Handle,
  HandleQuery,
  HandlesQuery,
  IndexTrade,
  IndexWindow,
  OracleWindow,
  OracleWindowQuery,
  Order,
  OrderFill,
  OrderFillsQuery,
  OrdersQuery,
  Page,
  PoolEvent,
  PoolEventsQuery,
  TradesQuery,
  User,
  UserQuery,
  UsersQuery,
  WindowQuery,
  WindowsQuery,
} from "./types";
import {
  HANDLE_FIELDS,
  ORDER_FIELDS,
  ORDER_FILL_FIELDS,
  ORACLE_WINDOW_FIELDS,
  POOL_EVENT_FIELDS,
  TRADE_FIELDS,
  WINDOW_FIELDS,
  windowId,
} from "./queries";

export type SubgraphConfig = { url?: string };

/** Inline a pagination fragment (`first`/`skip`). */
const pg = (p?: Page): string => {
  const parts: string[] = [];
  if (p?.first !== undefined) parts.push(`first: ${p.first}`);
  if (p?.skip !== undefined) parts.push(`skip: ${p.skip}`);
  return parts.length ? `, ${parts.join(", ")}` : "";
};

/**
 * Typed GraphQL client for the Aura subgraph — the on-chain source of truth for
 * handles (created via HandleFactory), their per-window oracles, the singleton
 * Pool vault's reserve movements, and the MarketMaker's trades + order book.
 * Shared by the frontend (app) and the oracle backend.
 */
export class SubgraphClient {
  readonly url: string;

  constructor(config: SubgraphConfig = {}) {
    const url = config.url;
    if (!url) throw new Error("SubgraphClient requires a `url`");
    this.url = url.replace(/\/$/, "");
  }

  /** Run an arbitrary GraphQL query. */
  async query<T>(gql: string, variables?: Record<string, unknown>): Promise<T> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: gql, variables: variables ?? {} }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`subgraph HTTP ${res.status}`);
    const json = (await res.json()) as { data?: T; errors?: { message?: string }[] };
    if (json.errors?.length) throw new Error(`subgraph query error: ${json.errors[0]?.message}`);
    if (!json.data) throw new Error("subgraph returned no data");
    return json.data;
  }

  // --- handles --------------------------------------------------------------

  async handles(page?: Page): Promise<Handle[]> {
    const data = await this.query<HandlesQuery>(
      `query($first: Int, $skip: Int) { handles(orderBy: windowCount, orderDirection: desc${pg(page)}) { ${HANDLE_FIELDS} } }`,
      { first: page?.first ?? 100, skip: page?.skip ?? 0 },
    );
    return data.handles;
  }

  async handle(id: string): Promise<Handle | null> {
    const data = await this.query<HandleQuery>(`query($id: ID!) { handle(id: $id) { ${HANDLE_FIELDS} } }`, { id });
    return data.handle;
  }

  /** Every handle owned by a creator (one creator → many handles). */
  async handlesByCreator(owner: string, page?: Page): Promise<Handle[]> {
    const data = await this.query<HandlesQuery>(
      `query($owner: String!, $first: Int, $skip: Int) { handles(where: { owner: $owner }${pg(page)}) { ${HANDLE_FIELDS} } }`,
      { owner, first: page?.first ?? 100, skip: page?.skip ?? 0 },
    );
    return data.handles;
  }

  /**
   * Graduation candidates: handles NOT yet graduated but with aura above the
   * given floor. The `aura` is 1e2-scaled, so `minAura = 1000` means a display
   * aura > 10.00. The CRE graduation workflow consumes this to call
   * `Handle.setGraduated(true)`.
   */
  async graduationCandidates(minAura: bigint, page?: Page): Promise<Handle[]> {
    const data = await this.query<HandlesQuery>(
      `query($minAura: BigInt!, $first: Int, $skip: Int) { handles(where: { graduated: false, aura_gt: $minAura }, orderBy: aura, orderDirection: desc${pg(page)}) { ${HANDLE_FIELDS} } }`,
      { minAura: minAura.toString(), first: page?.first ?? 100, skip: page?.skip ?? 0 },
    );
    return data.handles;
  }

  /** Accounts ranked by handles owned (merged Creator/User entity). */
  async creators(page?: Page): Promise<User[]> {
    const data = await this.query<UsersQuery>(
      `query($first: Int, $skip: Int) { users(orderBy: handleCount, orderDirection: desc${pg(page)}) { id handleCount totalPremium totalProceeds } }`,
      { first: page?.first ?? 100, skip: page?.skip ?? 0 },
    );
    return data.users;
  }

  async creator(id: string): Promise<User | null> {
    const data = await this.query<UserQuery>(`query($id: ID!) { user(id: $id) { id handleCount totalPremium totalProceeds } }`, { id });
    return data.user;
  }

  /** On-chain handle count (paged to the max; exact up to the page size). */
  async handleCount(maxScan = 1000): Promise<number> {
    const data = await this.query<CountQuery>(
      `query($first: Int!) { handles(first: $first) { id } indexWindows(first: 1) { id } }`,
      { first: maxScan },
    );
    return data.handles.length;
  }

  // --- windows --------------------------------------------------------------

  async windows(handleId: string, page?: Page): Promise<IndexWindow[]> {
    const data = await this.query<WindowsQuery>(
      `query($handleId: String!, $first: Int, $skip: Int) { indexWindows(where: { handle: $handleId }, orderBy: windowStart, orderDirection: desc${pg(page)}) { ${WINDOW_FIELDS} } }`,
      { handleId, first: page?.first ?? 20, skip: page?.skip ?? 0 },
    );
    return data.indexWindows;
  }

  /** The latest windows across ALL handles (for a live feed / leaderboard). */
  async latestWindows(page?: Page): Promise<IndexWindow[]> {
    const data = await this.query<WindowsQuery>(
      `query($first: Int, $skip: Int) { indexWindows(orderBy: windowStart, orderDirection: desc${pg(page)}) { ${WINDOW_FIELDS} } }`,
      { first: page?.first ?? 20, skip: page?.skip ?? 0 },
    );
    return data.indexWindows;
  }

  /** Windows for a handle that are still trading (not settled). */
  async openWindows(handleId: string, page?: Page): Promise<IndexWindow[]> {
    const data = await this.query<WindowsQuery>(
      `query($handleId: String!, $first: Int, $skip: Int) { indexWindows(where: { handle: $handleId, settled: false }, orderBy: windowStart, orderDirection: desc${pg(page)}) { ${WINDOW_FIELDS} } }`,
      { handleId, first: page?.first ?? 20, skip: page?.skip ?? 0 },
    );
    return data.indexWindows;
  }

  async window(handleId: string, windowStart: string): Promise<IndexWindow | null> {
    const data = await this.query<WindowQuery>(`query($id: ID!) { indexWindow(id: $id) { ${WINDOW_FIELDS} } }`, {
      id: windowId(handleId, windowStart),
    });
    return data.indexWindow;
  }

  async latestWindow(handleId: string): Promise<IndexWindow | null> {
    const windows = await this.windows(handleId, { first: 1 });
    return windows[0] ?? null;
  }

  /** Resolve the IndexWindow for a window ORACLE address (events log the oracle). */
  async windowByOracle(oracle: string): Promise<IndexWindow | null> {
    const data = await this.query<OracleWindowQuery>(
      `query($id: ID!) { oracleWindow(id: $id) { ${ORACLE_WINDOW_FIELDS} } }`,
      { id: oracle },
    );
    return data.oracleWindow?.window ?? null;
  }

  // --- pool -----------------------------------------------------------------

  async poolEvents(oracle: string, page?: Page): Promise<PoolEvent[]> {
    const data = await this.query<PoolEventsQuery>(
      `query($oracle: String!, $first: Int, $skip: Int) { poolEvents(where: { oracle: $oracle }, orderBy: timestamp, orderDirection: desc${pg(page)}) { ${POOL_EVENT_FIELDS} } }`,
      { oracle, first: page?.first ?? 50, skip: page?.skip ?? 0 },
    );
    return data.poolEvents;
  }

  // --- trading --------------------------------------------------------------

  async tradesByWindow(windowId: string, page?: Page): Promise<IndexTrade[]> {
    const data = await this.query<TradesQuery>(
      `query($windowId: String!, $first: Int, $skip: Int) { indexTrades(where: { window: $windowId }, orderBy: ts, orderDirection: desc${pg(page)}) { ${TRADE_FIELDS} } }`,
      { windowId, first: page?.first ?? 100, skip: page?.skip ?? 0 },
    );
    return data.indexTrades;
  }

  /** A user's trades (BUY/SELL/CLAIM) across windows. */
  async tradesByUser(user: string, page?: Page): Promise<IndexTrade[]> {
    const data = await this.query<TradesQuery>(
      `query($user: String!, $first: Int, $skip: Int) { indexTrades(where: { user: $user }, orderBy: ts, orderDirection: desc${pg(page)}) { ${TRADE_FIELDS} } }`,
      { user, first: page?.first ?? 100, skip: page?.skip ?? 0 },
    );
    return data.indexTrades;
  }

  async user(id: string): Promise<User | null> {
    const data = await this.query<UserQuery>(`query($id: ID!) { user(id: $id) { id totalPremium totalProceeds } }`, { id });
    return data.user;
  }

  /** Top users by total premium (leaderboard). */
  async users(page?: Page): Promise<User[]> {
    const data = await this.query<UsersQuery>(
      `query($first: Int, $skip: Int) { users(orderBy: totalPremium, orderDirection: desc${pg(page)}) { id totalPremium totalProceeds } }`,
      { first: page?.first ?? 50, skip: page?.skip ?? 0 },
    );
    return data.users;
  }

  async orders(windowId: string, page?: Page): Promise<Order[]> {
    const data = await this.query<OrdersQuery>(
      `query($windowId: String!, $first: Int, $skip: Int) { orders(where: { window: $windowId }, orderBy: createdAt, orderDirection: desc${pg(page)}) { ${ORDER_FIELDS} } }`,
      { windowId, first: page?.first ?? 50, skip: page?.skip ?? 0 },
    );
    return data.orders;
  }

  /** A maker's resting orders (their order book). */
  async ordersByMaker(maker: string, page?: Page): Promise<Order[]> {
    const data = await this.query<OrdersQuery>(
      `query($maker: String!, $first: Int, $skip: Int) { orders(where: { maker: $maker }, orderBy: createdAt, orderDirection: desc${pg(page)}) { ${ORDER_FIELDS} } }`,
      { maker, first: page?.first ?? 50, skip: page?.skip ?? 0 },
    );
    return data.orders;
  }

  async orderFills(windowId: string, page?: Page): Promise<OrderFill[]> {
    const data = await this.query<OrderFillsQuery>(
      `query($windowId: String!, $first: Int, $skip: Int) { orderFills(where: { window: $windowId }, orderBy: ts, orderDirection: desc${pg(page)}) { ${ORDER_FILL_FIELDS} } }`,
      { windowId, first: page?.first ?? 100, skip: page?.skip ?? 0 },
    );
    return data.orderFills;
  }

  /** A taker's executions across orders. */
  async orderFillsByTaker(taker: string, page?: Page): Promise<OrderFill[]> {
    const data = await this.query<OrderFillsQuery>(
      `query($taker: String!, $first: Int, $skip: Int) { orderFills(where: { taker: $taker }, orderBy: ts, orderDirection: desc${pg(page)}) { ${ORDER_FILL_FIELDS} } }`,
      { taker, first: page?.first ?? 100, skip: page?.skip ?? 0 },
    );
    return data.orderFills;
  }
}

