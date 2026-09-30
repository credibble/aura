import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type Redis from "ioredis";
import { REDIS } from "../../queue/queue.constants";
import type { AuraHandle } from "../jobs.types";
import { bytes32ToId } from "../../core/domain/handle";

const HANDLES_KEY = "jobs:handles:v1";
const WINDOWS_KEY = "jobs:windows:v1";
/** Last known GOOD copies — served when the subgraph query fails. */
const HANDLES_LAST_KEY = "jobs:handles:last";
const WINDOWS_LAST_KEY = "jobs:windows:last";

const HANDLE_QUERY = `
{
  handles(where: { active: true }, orderBy: aura, orderDirection: desc) {
    id
    contract
    symbol
    metadata
    sources
    aura
    graduated
    category
    windowMinutes
  }
}`;

const WINDOW_QUERY = `
{
  windows(where: { settled: false }) {
    id
    handle { id }
    oracle
    windowStart
    windowEnd
    outcomes
    settled
  }
}`;

export interface SubgraphWindow {
  /** `${handleId}-${windowStart}`. */
  id: string;
  handleId: string;
  oracle: string;
  windowStart: number;
  windowEnd: number;
  outcomes: string[];
  settled: boolean;
}

/** The most recent settled window before `beforeSec` for a handle. */
export interface SettledWindow {
  id: string;
  windowStart: number;
}

/** A taker execution against a resting order (from the subgraph OrderFill). */
export interface SubgraphOrderFill {
  id: string;
  orderId: string;
  taker: string;
  outcome: number;
  shares: string;
  price: string;
  ts: number;
}

/**
 * Subgraph reader — the oracle's source of truth for on-chain state. Handles
 * and windows come from the subgraph (created on-chain via HandleFactory /
 * MarketMaker), cached in Redis for the job schedulers. No backend seeding.
 */
@Injectable()
export class SubgraphReader {
  private readonly logger = new Logger(SubgraphReader.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private get url(): string | undefined {
    return this.config.get<string>("SUBGRAPH_URL");
  }

  private get ttlMs(): number {
    return this.config.get<number>("SUBGRAPH_CACHE_TTL_MS") ?? 60_000;
  }

  private async gql<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T | null> {
    const url = this.url;
    if (!url) {
      this.logger.warn("SUBGRAPH_URL unset — returning no on-chain data.");
      return null;
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables: variables ?? {} }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`subgraph HTTP ${res.status}`);
      const json = (await res.json()) as {
        data?: T;
        errors?: { message?: string }[];
      };
      if (json.errors?.length)
        throw new Error(json.errors[0]?.message ?? "graphql error");
      return json.data ?? null;
    } catch (error) {
      this.logger.warn(`Subgraph query failed: ${(error as Error).message}`);
      return null;
    }
  }

  /** Every active handle (aura desc) — cached for SUBGRAPH_CACHE_TTL_MS. */
  async handles(): Promise<AuraHandle[]> {
    const cached = await this.read<AuraHandle[]>(HANDLES_KEY);
    if (cached !== null) return cached;
    const data = await this.gql<{ handles?: unknown[] }>(HANDLE_QUERY);
    if (data === null) {
      // A FAILED query must never be cached as "no handles": that turned a
      // subgraph outage into a silent, total market outage for the whole TTL.
      const last = await this.read<AuraHandle[]>(HANDLES_LAST_KEY);
      this.logger.warn(
        `handles: subgraph unavailable — serving ${last?.length ?? 0} last-known handle(s)`,
      );
      return last ?? [];
    }
    const handles = normalizeHandles(data.handles ?? []);
    await this.write(HANDLES_KEY, handles);
    await this.writeLast(HANDLES_LAST_KEY, handles);
    return handles;
  }

  /** Graduated handles only (the only ones that can open windows). */
  async graduatedHandles(): Promise<AuraHandle[]> {
    const all = await this.handles();
    return all.filter((h) => h.graduated);
  }

  /** Handles whose category falls in a sub-category band [sub, sub+1000) —
   *  the candidate pool a group (multi) handle samples its outcomes from. */
  async handlesByCategory(sub: number): Promise<AuraHandle[]> {
    const all = await this.handles();
    return all.filter((h) => h.category >= sub && h.category < sub + 1_000);
  }

  /** Open (not settled) windows — cached. */
  async openWindows(): Promise<SubgraphWindow[]> {
    const cached = await this.read<SubgraphWindow[]>(WINDOWS_KEY);
    if (cached !== null) return cached;
    const data = await this.gql<{ windows?: unknown[] }>(WINDOW_QUERY);
    if (data === null) {
      // Same rule as handles(): serve the last good list, never cache "none".
      const last = await this.read<SubgraphWindow[]>(WINDOWS_LAST_KEY);
      this.logger.warn(
        `openWindows: subgraph unavailable — serving ${last?.length ?? 0} last-known window(s)`,
      );
      return last ?? [];
    }
    const windows = normalizeWindows(data.windows ?? []);
    await this.write(WINDOWS_KEY, windows);
    await this.writeLast(WINDOWS_LAST_KEY, windows);
    return windows;
  }

  /** The handle's most recent settled window before `beforeSec` (for funding
   *  sizing — the next window is funded from the last window's volume). */
  async previousSettledWindow(
    handleId: string,
    beforeSec: number,
  ): Promise<SettledWindow | null> {
    const data = await this.gql<{ windows?: unknown[] }>(
      `query($handleId: String!, $beforeSec: BigInt!) {
        windows(
          where: { handle: $handleId, settled: true, windowStart_lt: $beforeSec }
          orderBy: windowStart
          orderDirection: desc
          first: 1
        ) { id windowStart }
      }`,
      { handleId, beforeSec: String(beforeSec) },
    );
    const row = data?.windows?.[0];
    if (!row) return null;
    const w = row as Record<string, unknown>;
    return {
      id: String(w.id ?? ""),
      windowStart: Number(w.windowStart ?? "0"),
    };
  }

/** Trading volume (USDC 1e18) for a window — O(1) single-entity read: the
   *  subgraph accumulates buy premium onto Window.volume at index time, so
   *  funding sizing never scans the trade set. */
  async windowVolume(windowId: string): Promise<bigint> {
    const data = await this.gql<{ windows?: { volume?: string }[] }>(
      `query($id: ID!) { windows(id: $id) { volume } }`,
      { id: windowId },
    );
    return BigInt(data?.windows?.[0]?.volume ?? "0");
  }

  // --- orderbook fills (direct subgraph reads — never mirrored into the backend) ---

  /** Fills newer than `sinceTs` (epoch s) for a window — marker-driven, fresh
   *  GraphQL per call. Used by the fills webhook watcher; the orderbook itself
   *  is read directly by the frontend from the subgraph. */
  async fillsSince(windowId: string, sinceTs: number): Promise<SubgraphOrderFill[]> {
    const data = await this.gql<{ orderFills?: unknown[] }>(
      `query($id: ID!, $since: BigInt!) {
        orderFills(where: { window: $id, ts_gt: $since }, first: 500, orderBy: ts, orderDirection: asc) {
          id order { id } taker { id } outcome shares price ts
        }
      }`,
      { id: windowId, since: String(sinceTs) },
    );
    return normalizeFills(data?.orderFills ?? []);
  }

  private async read<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }

  private async write(key: string, value: unknown): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), "PX", this.ttlMs);
    } catch {
      /* redis down — refetch next time */
    }
  }

  /**
   * The LAST KNOWN GOOD value, kept far longer than the TTL. A subgraph outage
   * serves this instead of an empty list, so a wedged indexer degrades the
   * engine (stale labels) rather than stopping it (no handles, no windows).
   */
  private async writeLast(key: string, value: unknown): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), "PX", 24 * 60 * 60 * 1000);
    } catch {
      /* redis down — the TTL cache still serves the fresh copy */
    }
  }
}

function normalizeHandles(rows: unknown[]): AuraHandle[] {
  return rows
    .filter(
      (r): r is Record<string, unknown> => typeof r === "object" && r !== null,
    )
    .map((r) => {
      // label = the on-chain handleId ("ronaldo"), NOT the symbol ("ron"):
      // chain calls (oracleOf/openWindow) and source→handle rules are keyed
      // by the bytes32 handleId. Fall back to the symbol if the id isn't
      // decodable ASCII.
      const idHex = String(r.id ?? "");
      const decoded = bytes32ToId(idHex);
      const label =
        decoded === idHex ? String(r.symbol ?? "").toLowerCase() : decoded;
      return {
        id: idHex,
        label,
        contract: String(r.contract ?? ""),
        sources: Array.isArray(r.sources) ? r.sources.map(String) : [],
        aura: Number(r.aura ?? "0"),
        graduated: Boolean(r.graduated ?? false),
        category: Number(r.category ?? "0"),
        windowMinutes: Number(r.windowMinutes ?? "15"),
        metadata: r.metadata === undefined ? undefined : String(r.metadata),
      };
    })
    .filter((h) => h.id.length > 0 && h.contract.startsWith("0x"))
    // A registered-but-never-created handle (a seed that ran out of gas) has the
    // ZERO address: reading `aura()` on it wastes an RPC call and warns loudly.
    .filter((h) => h.contract !== "0x0000000000000000000000000000000000000000");
}

function normalizeWindows(rows: unknown[]): SubgraphWindow[] {
  return rows
    .filter(
      (r): r is Record<string, unknown> => typeof r === "object" && r !== null,
    )
    .map((r) => ({
      id: String(r.id ?? ""),
      handleId: String((r.handle as { id?: string } | undefined)?.id ?? ""),
      oracle: String(r.oracle ?? ""),
      windowStart: Number(r.windowStart ?? "0"),
      windowEnd: Number(r.windowEnd ?? "0"),
      outcomes: Array.isArray(r.outcomes) ? r.outcomes.map(String) : [],
      settled: Boolean(r.settled ?? false),
    }))
    .filter((w) => w.id.length > 0 && w.handleId.length > 0);
}

function normalizeFills(rows: unknown[]): SubgraphOrderFill[] {
  return rows
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => ({
      id: String(r.id ?? ""),
      orderId: String((r.order as { id?: string } | undefined)?.id ?? ""),
      taker: String((r.taker as { id?: string } | undefined)?.id ?? ""),
      outcome: Number(r.outcome ?? 0),
      shares: String(r.shares ?? "0"),
      price: String(r.price ?? "0"),
      ts: Number(r.ts ?? "0"),
    }))
    .filter((f) => f.id.length > 0);
}
