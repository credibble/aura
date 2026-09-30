/**
 * Aura subgraph query fragments — the exact field sets the client fetches.
 * Keep in sync with `indexer/schema.graphql`.
 */

export const HANDLE_FIELDS = `
  id
  contract
  owner
  name
  symbol
  metadata
  market
  oracleFactory
  revenue
  stake
  sources
  aura
  graduated
  category
  pendingOwner
  windowMinutes
  active
  windowCount
`;

export const WINDOW_FIELDS = `
  id
  handle
  oracle
  oracleMetadata
  handleId
  windowStart
  windowEnd
  outcomes
  initialProbabilities
  liquidity
  q
  reference
  timestamp
  cash
  settled
  winningOutcome
  reserved
  paidOut
  volume
`;

export const POOL_EVENT_FIELDS = `
  id
  pool
  oracle
  kind
  amount
  to
  timestamp
`;

export const TRADE_FIELDS = `
  id
  window
  user
  outcome
  kind
  premium
  proceeds
  shares
  price
  ts
`;

export const ORDER_FIELDS = `
  id
  window
  maker
  outcome
  side
  price
  size
  filled
  expiresAt
  status
  createdAt
`;

export const ORDER_FILL_FIELDS = `
  id
  order
  window
  taker
  outcome
  shares
  price
  ts
`;

/** OracleWindow → nested IndexWindow (resolves a window by oracle address). */
export const ORACLE_WINDOW_FIELDS = `
  id
  window { ${WINDOW_FIELDS} }
`;

/** `id` is `${handleId}-${windowStart}` — build a window's graph id. */
export function windowId(handleId: string, windowStart: string): string {
  return `${handleId}-${windowStart}`;
}