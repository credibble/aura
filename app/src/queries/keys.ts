/** Query key factory — every invalidation goes through these. */
export const qk = {
  handles: ["handles"] as const,
  /** People search (indexer name ilike). */
  peopleSearch: (q: string) => ["people-search", q] as const,
  /** Handle search (indexer name/symbol ilike) — the search popover. */
  handleSearch: (q: string) => ["handle-search", q] as const,
  handle: (id: string) => ["handle", id] as const,
  handleVerified: (id: string) => ["handle-verified", id] as const,
  /** Creator revenue claimable by a handle contract (USDC balanceOf). */
  handleRevenue: (contract: string) => ["handle-revenue", contract] as const,
  auraHistory: (id: string) => ["aura-history", id] as const,
  posts: (handleId?: string) => (handleId ? ["posts", handleId] : ["posts"]),
  /** Post search (`?q=`) — shared by the search popover. */
  search: (q: string) => ["search", q] as const,
  post: (id: string) => ["post", id] as const,
  /** 2-element prefix form (no viewer) invalidates every viewer's cache. */
  comments: (id: string, viewer?: string) => (viewer ? ["comments", id, viewer] : ["comments", id]),
  feed: (userId: string) => ["feed", userId] as const,
  notifications: (userId: string) => ["notifications", userId] as const,
  following: (userId: string) => ["following", userId] as const,
  followers: (handleId: string) => ["followers", handleId] as const,
  subscriptions: (userId: string) => ["subscriptions", userId] as const,
  likes: (userId: string) => ["likes", userId] as const,
  reposts: (userId: string) => ["reposts", userId] as const,
  bookmarks: (userId: string) => ["bookmarks", userId] as const,
  /** Reposted posts (the /saved Reposts tab). */
  reposted: (userId: string) => ["reposted", userId] as const,
  /** On-chain auraLP pool — "stats" | per-account "shares"/"earned". */
  pool: (kind: "stats" | "shares" | "earned", id?: string) => ["pool", kind, id ?? ""] as const,
  /** Indexer auraLP history — snapshots (charts) + pool events (flows). */
  poolSnapshots: ["pool-snapshots"] as const,
  poolEvents: ["pool-events"] as const,
  /** Per-handle AURA stake vault — "stats" | per-account "shares"/"earned". */
  stake: (kind: "stats" | "shares" | "earned", vault: string, id?: string) =>
    ["stake", kind, vault, id ?? ""] as const,
  /** Indexer stake history for the vault's chart. */
  stakeSnapshots: (vault: string) => ["stake-snapshots", vault] as const,
  windows: ["windows"] as const,
  stats: ["stats"] as const,
  window: (id: string) => ["window", id] as const,
  handleWindows: (handleId: string) => ["handle-windows", handleId] as const,
  windowPoints: (windowId: string) => ["window-points", windowId] as const,
  windowTrades: (windowId: string) => ["window-trades", windowId] as const,
  orderbook: (windowId: string) => ["orderbook", windowId] as const,
  trades: (handleId: string) => ["trades", handleId] as const,
  leaderboard: ["leaderboard"] as const,
  userHandles: (address: string) => ["user-handles", address] as const,
  positions: (address: string) => ["positions", address] as const,
  openOrders: (address: string) => ["open-orders", address] as const,
  /** One numbered page of the wallet's orders for a tab (shares the open-orders
   *  prefix so the reconnect resync invalidates every page too). */
  ordersPage: (address: string, tab: "open" | "closed", page: number) =>
    ["open-orders", address, tab, page] as const,
} as const;
