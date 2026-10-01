import { Injectable, Inject, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type Redis from "ioredis";
import { REDIS } from "../../queue/queue.constants";
import type { AuraHandle } from "../jobs.types";
import { bytes32ToId } from "../../core/domain/handle";

const HANDLES_KEY = "jobs:handles:v1";
const WINDOWS_KEY = "jobs:windows:v1";
/** Last known GOOD copies — served when the indexer query fails. */
const HANDLES_LAST_KEY = "jobs:handles:last";
const WINDOWS_LAST_KEY = "jobs:windows:last";

const HANDLE_QUERY = `
{
  Handle(where: { active: { _eq: true } }, order_by: { aura: desc }) {
    id
    contract
    symbol
    metadata
    sources
    aura
    graduated
    categories
    windowMinutes
  }
}`;

const WINDOW_QUERY = `
{
  Window(where: { settled: { _eq: false } }) {
    id
    handle { id }
    oracle
    windowStart
    windowEnd
    strike
    outcomes
    settled
  }
}`;

export interface IndexerWindow {
  /** `${handleId}-${windowStart}`. */
  id: string;
  handleId: string;
  oracle: string;
  windowStart: number;
  windowEnd: number;
  /** The aura level the window was priced from at open (1e2) — the YES strike. */
  strike: number;
  outcomes: string[];
  settled: boolean;
}

/** The most recent settled window before `beforeSec` for a handle. */
export interface SettledWindow {
  id: string;
  windowStart: number;
}

/** A taker execution against a resting order (from the indexer OrderFill). */
export interface IndexerOrderFill {
  id: string;
  orderId: string;
  taker: string;
  outcome: number;
  shares: string;
  price: string;
  ts: number;
}

/**
 * Indexer reader — the oracle's source of truth for on-chain state. Handles
 * and windows come from the Envio indexer (created on-chain via HandleFactory /
 * MarketMaker), cached in Redis for the job schedulers. No backend seeding.
 */
@Injectable()
export class IndexerReader {
  private readonly logger = new Logger(IndexerReader.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private get url(): string | undefined {
    return this.config.get<string>("INDEXER_URL");
  }

  private get ttlMs(): number {
    return this.config.get<number>("INDEXER_CACHE_TTL_MS") ?? 60_000;
  }

  private async gql<T>(
    query: string,
    variables?: Record<string, unknown>,
  ): Promise<T | null> {
    const url = this.url;
    if (!url) {
      this.logger.warn("INDEXER_URL unset — returning no on-chain data.");
      return null;
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, variables: variables ?? {} }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`indexer HTTP ${res.status}`);
      const json = (await res.json()) as {
        data?: T;
        errors?: { message?: string }[];
      };
      if (json.errors?.length)
        throw new Error(json.errors[0]?.message ?? "graphql error");
      return json.data ?? null;
    } catch (error) {
      this.logger.warn(`Indexer query failed: ${(error as Error).message}`);
      return null;
    }
  }

  /** Every active handle (aura desc) — cached for INDEXER_CACHE_TTL_MS. */
  async handles(): Promise<AuraHandle[]> {
    const cached = await this.read<AuraHandle[]>(HANDLES_KEY);
    if (cached !== null) return cached;
    const data = await this.gql<{ Handle?: unknown[] }>(HANDLE_QUERY);
    if (data === null) {
      // A FAILED query must never be cached as "no handles": that turned an
      // indexer outage into a silent, total market outage for the whole TTL.
      const last = await this.read<AuraHandle[]>(HANDLES_LAST_KEY);
      this.logger.warn(
        `handles: indexer unavailable — serving ${last?.length ?? 0} last-known handle(s)`,
      );
      return last ?? [];
    }
    const handles = normalizeHandles(data.Handle ?? []);
    await this.write(HANDLES_KEY, handles);
    await this.writeLast(HANDLES_LAST_KEY, handles);
    return handles;
  }

  /** Graduated handles only (the only ones that can open windows). */
  async graduatedHandles(): Promise<AuraHandle[]> {
    const all = await this.handles();
    return all.filter((h) => h.graduated);
  }

  /** Open (not settled) windows — cached. */
  async openWindows(): Promise<IndexerWindow[]> {
    const cached = await this.read<IndexerWindow[]>(WINDOWS_KEY);
    if (cached !== null) return cached;
    const data = await this.gql<{ Window?: unknown[] }>(WINDOW_QUERY);
    if (data === null) {
      // Same rule as handles(): serve the last good list, never cache "none".
      const last = await this.read<IndexerWindow[]>(WINDOWS_LAST_KEY);
      this.logger.warn(
        `openWindows: indexer unavailable — serving ${last?.length ?? 0} last-known window(s)`,
      );
      return last ?? [];
    }
    const windows = normalizeWindows(data.Window ?? []);
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
    const data = await this.gql<{ Window?: unknown[] }>(
      `query($handleId: String!, $beforeSec: numeric!) {
        Window(
          where: { handle_id: { _eq: $handleId }, settled: { _eq: true }, windowStart: { _lt: $beforeSec } }
          order_by: { windowStart: desc }
          limit: 1
        ) { id windowStart }
      }`,
      { handleId, beforeSec: String(beforeSec) },
    );
    const row = data?.Window?.[0];
    if (!row) return null;
    const w = row as Record<string, unknown>;
    return {
      id: String(w.id ?? ""),
      windowStart: Number(w.windowStart ?? "0"),
    };
  }

/** Trading volume (USDC 1e18) for a window — O(1) single-entity read: the
   *  indexer accumulates buy premium onto Window.volume at index time, so
   *  funding sizing never scans the trade set. */
  async windowVolume(windowId: string): Promise<bigint> {
    const data = await this.gql<{ Window_by_pk?: { volume?: string } | null }>(
      `query($id: String!) { Window_by_pk(id: $id) { volume } }`,
      { id: windowId },
    );
    return BigInt(data?.Window_by_pk?.volume ?? "0");
  }

  // --- orderbook fills (direct indexer reads — never mirrored into the backend) ---

  /** Fills newer than `sinceTs` (epoch s) for a window — marker-driven, fresh
   *  GraphQL per call. Used by the fills webhook watcher; the orderbook itself
   *  is read directly by the frontend from the indexer. */
  async fillsSince(windowId: string, sinceTs: number): Promise<IndexerOrderFill[]> {
    const data = await this.gql<{ OrderFill?: unknown[] }>(
      `query($id: String!, $since: numeric!) {
        OrderFill(
          where: { window_id: { _eq: $id }, ts: { _gt: $since } }
          limit: 500
          order_by: { ts: asc }
        ) {
          id order { id } taker { id } outcome shares price ts
        }
      }`,
      { id: windowId, since: String(sinceTs) },
    );
    return normalizeFills(data?.OrderFill ?? []);
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
   * The LAST KNOWN GOOD value, kept far longer than the TTL. An indexer outage
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
        // Several families per handle (sport + people, tech + people, …). The
        // indexer carries the raw on-chain category CODES.
        categories: (Array.isArray(r.categories) ? r.categories : []).map((c) => Number(c)),
        windowMinutes: Number(r.windowMinutes ?? "15"),
        metadata: r.metadata === undefined ? undefined : String(r.metadata),
      };
    })
    .filter((h) => h.id.length > 0 && h.contract.startsWith("0x"))
    // A registered-but-never-created handle (a seed that ran out of gas) has the
    // ZERO address: reading `aura()` on it wastes an RPC call and warns loudly.
    .filter((h) => h.contract !== "0x0000000000000000000000000000000000000000");
}

function normalizeWindows(rows: unknown[]): IndexerWindow[] {
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
      strike: Number(r.strike ?? "0"),
      outcomes: Array.isArray(r.outcomes) ? r.outcomes.map(String) : [],
      settled: Boolean(r.settled ?? false),
    }))
    .filter((w) => w.id.length > 0 && w.handleId.length > 0);
}

function normalizeFills(rows: unknown[]): IndexerOrderFill[] {
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
