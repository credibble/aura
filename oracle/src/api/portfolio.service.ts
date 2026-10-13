import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Inject } from "@nestjs/common";
import { IndexerHandleSync } from "../registry/indexer-handle-sync.service";
import { PrismaService } from "../persistence/prisma.service";
import { CONNECTION_STORE } from "../core/ports/tokens";
import type { IConnectionStore } from "../core/ports/connection-store";
import type { OnChainHandleView } from "../core/domain/handle";
import { bytes32ToId } from "../core/domain/handle";
import { ChainGateway } from "../jobs/chain/chain-gateway.service";
import { CleanverseService, type Verification } from "./cleanverse.service";
import {
  connectionPlatformOf,
  connectionSourceJson,
  isConnectionSource,
} from "./connection-source";

/** A handle's linked connection, as stored (the credential key + platform). */
type ConnectionRef = { platform: string; account: string };

/** Protocol-reserved handle names — never claimable. */
const RESERVED_HANDLES = new Set([
  "aura", "aurora", "admin", "protocol", "system", "team", "official", "help",
  "support", "status", "announcements", "api", "app", "blog", "dao", "dev",
  "docs", "faq", "legal", "new", "nft", "oracle", "terms", "treasury", "wallet",
]);

export type HandleAvailability = {
  available: boolean;
  reason: "reserved" | "claimed" | "unverified" | "available";
  claimedBy?: string; // owner address when already claimed on-chain
  verification?: Verification; // CVI check when an address is supplied
};

export interface HandleConnectionView {
  handleId: string;
  platform: string | null;
  account: string | null;
  status: "connected" | "reconnecting" | "disconnected";
  connectedAt: number | null;
}

/** Result of a handle verification: wallet-level CVI status + the on-chain flag. */
export interface HandleVerifyResult {
  verification: Verification;
  /** Final on-chain `Handle.verified` state (null when the chain gateway is off). */
  verifiedOnChain: boolean | null;
}

/**
 * Portfolio/claim services — the profile page flow:
 *  1. a user claims a unique handle (reserved names + names already claimed
 *     on-chain are rejected — picked from the graph),
 *  2. links it to ONE source connection per handle,
 *  3. connect / reconnect / disconnect at will.
 */
@Injectable()
export class PortfolioService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    private readonly sync: IndexerHandleSync,
    private readonly prisma: PrismaService,
    @Inject(CONNECTION_STORE) private readonly connections: IConnectionStore,
    private readonly cleanverse: CleanverseService,
    private readonly chain: ChainGateway,
    private readonly config: ConfigService,
  ) {}

  /**
   * The on-chain source of a connected handle must track the connection, or the
   * aura engine keeps reading a platform the handle disconnected (and never
   * reads one it just connected). Connect/disconnect write it inline; this timer
   * is the safety net that heals drift after an RPC outage or a failed write.
   * `CONNECTION_RECONCILE_MS=0` disables it.
   */
  private reconcileTimer: NodeJS.Timeout | null = null;

  onModuleInit(): void {
    const everyMs = this.config.get<number>("CONNECTION_RECONCILE_MS") ?? 0;
    if (everyMs <= 0) return;
    this.reconcileTimer = setInterval(() => {
      void this.reconcileSources().catch((e) =>
        this.logger.warn(`Connection source reconcile failed: ${(e as Error).message}`),
      );
    }, everyMs);
    this.reconcileTimer.unref?.();
    this.logger.log(`Connection source reconcile every ${everyMs}ms`);
  }

  onModuleDestroy(): void {
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
  }

  /**
   * Cleanverse CVI verification for a handle — frontend → backend → onchain:
   *   1. resolve the handle on-chain (indexer) to its creator,
   *   2. check the creator's A-Pass through Cleanverse,
   *   3. write the result to `Handle.setVerified` (onlyProtocol) when it differs
   *      from the current on-chain flag.
   */
  async verifyHandle(handleId: string): Promise<HandleVerifyResult> {
    const key = handleId.trim().toLowerCase();
    const views = await this.sync.handles();
    const view = views.find(
      (v) => bytes32ToId(v.id).toLowerCase() === key || v.id.toLowerCase() === key,
    );
    if (!view) throw new NotFoundException(`No handle ${handleId}`);

    const verification = await this.cleanverse.verify(view.owner);
    const current = await this.chain.isVerified(view.contract);
    if (current === null || current === verification.verified) {
      return { verification, verifiedOnChain: current };
    }
    const written = await this.chain.setVerified(view.contract, verification.verified);
    return { verification, verifiedOnChain: written ? verification.verified : current };
  }

  /** Current on-chain `Handle.verified` flag (null when the chain gateway is off). */
  async handleVerified(handleId: string): Promise<{ verified: boolean | null }> {
    const key = handleId.trim().toLowerCase();
    const views = await this.sync.handles();
    const view = views.find(
      (v) => bytes32ToId(v.id).toLowerCase() === key || v.id.toLowerCase() === key,
    );
    if (!view) throw new NotFoundException(`No handle ${handleId}`);
    return { verified: await this.chain.isVerified(view.contract) };
  }

  /** Whether a handle name is free to claim (and, with an address, verifiable). */
  async availability(name: string, address?: string): Promise<HandleAvailability> {
    const normalized = name.trim().toLowerCase();
    if (!normalized) return { available: false, reason: "reserved" };
    if (RESERVED_HANDLES.has(normalized)) return { available: false, reason: "reserved" };

    const views = await this.sync.handles();
    const claimed = views.find((v) => bytes32ToId(v.id).toLowerCase() === normalized);
    if (claimed) return { available: false, reason: "claimed", claimedBy: claimed.owner };

    // Creator verification (Cleanverse CVI) gates claiming when enabled.
    if (address) {
      const verification = await this.cleanverse.verify(address);
      if (this.cleanverse.required && !verification.verified) {
        return { available: false, reason: "unverified", verification };
      }
      return { available: true, reason: "available", verification };
    }

    return { available: true, reason: "available" };
  }

  /** The handle's current social connection (one per handle). */
  async connection(handleId: string): Promise<HandleConnectionView> {
    try {
      const row = await this.prisma.handleConnection.findUnique({ where: { id: handleId } });
      if (!row) return { handleId, platform: null, account: null, status: "disconnected", connectedAt: null };
      return {
        handleId,
        platform: row.platform,
        account: row.account,
        status: (row.status as HandleConnectionView["status"]) ?? "connected",
        connectedAt: row.connectedAt.getTime(),
      };
    } catch {
      return this.localConnections.get(handleId) ?? { handleId, platform: null, account: null, status: "disconnected", connectedAt: null };
    }
  }

  /**
   * Connect (or RECONNECT) a handle to a platform account. One source
   * connection per handle: the credential must already exist in the
   * ConnectionStore (OAuth via Supabase, or a manual API key), then this links
   * the handle to it — the platform token is never stored here — and mirrors it
   * as a `Handle.sources[]` entry so the aura engine actually reads it.
   */
  async connect(handleId: string, platform: string, account: string, status: "connected" | "reconnecting" = "connected"): Promise<HandleConnectionView> {
    const credentials = await this.connections.get(platform, account);
    if (!credentials) throw new Error(`No credential for ${platform}::${account} — connect it first`);
    if (!(await this.isHandleId(handleId))) throw new Error(`Unknown handle ${handleId}`);

    // The row this connect replaces — a platform SWITCH must drop the OLD source
    // on-chain, not merely overwrite the single connection row.
    const previous = await this.readConnectionRef(handleId);

    const connectedAt = new Date();
    const view: HandleConnectionView = { handleId, platform, account, status, connectedAt: connectedAt.getTime() };
    try {
      await this.prisma.handleConnection.upsert({
        where: { id: handleId },
        create: { id: handleId, handleId, platform, account, status, connectedAt },
        update: { platform, account, status },
      });
    } catch {
      this.localConnections.set(handleId, view);
      this.logger.debug(`Postgres unavailable — handle connection ${handleId} held locally`);
    }
    await this.syncSources(handleId, previous, { platform, account });
    return view;
  }

  /**
   * Disconnect a handle — unlinks the connection (credential stays usable) and
   * removes its on-chain source so the platform stops feeding the aura.
   */
  async disconnect(handleId: string): Promise<HandleConnectionView> {
    const previous = await this.readConnectionRef(handleId);
    try {
      await this.prisma.handleConnection.delete({ where: { id: handleId } });
    } catch {
      this.localConnections.delete(handleId);
    }
    await this.syncSources(handleId, previous, null);
    return { handleId, platform: null, account: null, status: "disconnected", connectedAt: null };
  }

  private readonly localConnections = new Map<string, HandleConnectionView>();

  // --- on-chain source mirroring --------------------------------------------

  /** The stored connection ref (platform + credential key), or null. */
  private async readConnectionRef(handleId: string): Promise<ConnectionRef | null> {
    try {
      const row = await this.prisma.handleConnection.findUnique({ where: { id: handleId } });
      return row ? { platform: row.platform, account: row.account } : null;
    } catch {
      const local = this.localConnections.get(handleId);
      return local?.platform && local.account
        ? { platform: local.platform, account: local.account }
        : null;
    }
  }

  /**
   * Reconcile the handle's on-chain sources with the connection change: drop the
   * previous platform's source when it is being replaced/removed, then add the
   * next one. Best-effort — the reconcile sweep heals a dropped write — and a
   * no-op when the chain is disabled or the handle isn't indexed yet.
   */
  private async syncSources(
    handleId: string,
    previous: ConnectionRef | null,
    next: ConnectionRef | null,
  ): Promise<void> {
    try {
      if (!this.chain.ready) return;
      const view = await this.handleView(handleId);
      if (!view) return;

      const unchanged =
        previous !== null &&
        next !== null &&
        previous.platform.toLowerCase() === next.platform.toLowerCase() &&
        previous.account === next.account;
      if (previous && !unchanged) {
        await this.removeConnectionSource(view.contract, previous.platform, previous.account);
      }
      if (next) {
        const json = connectionSourceJson(next.platform, next.account);
        if (json) await this.chain.addSource(view.contract, json);
        else this.logger.debug(`"${next.platform}" has no per-user adapter — no on-chain source added`);
      }
    } catch (error) {
      // The connection itself is already stored; a chain hiccup here must not
      // fail the request. The reconcile sweep picks it up.
      this.logger.warn(`Source mirror failed for ${handleId}: ${(error as Error).message}`);
    }
  }

  /** Remove the on-chain source matching `(platform, account)`, if present. */
  private async removeConnectionSource(
    contract: string,
    platform: string,
    account: string,
  ): Promise<void> {
    const sources = await this.chain.handleSources(contract);
    if (sources === null) return; // RPC unknown — the reconcile sweep retries
    const index = sources.findIndex((json) => isConnectionSource(json, platform, account));
    if (index < 0) return; // already absent
    await this.chain.removeSource(contract, index);
  }

  /**
   * Bring every handle's on-chain sources back in line with its connection row:
   * ensure the connected platform's canonical source is present and remove any
   * connection-adapter source that no longer has a connection. Seeded feeds and
   * app-key sources are never touched. Idempotent; safe to run anywhere.
   */
  async reconcileSources(): Promise<void> {
    if (!this.chain.ready) return;
    const views = await this.sync.handles();
    let repaired = 0;
    for (const view of views) {
      const ref = await this.readConnectionRef(view.id);
      const desired = ref ? connectionSourceJson(ref.platform, ref.account) : null;
      const sources = await this.chain.handleSources(view.contract);
      if (sources === null) continue;

      // Stale connection sources: still present but not the desired one. Remove
      // descending so each swap-pop leaves the earlier indexes valid.
      const stale = sources
        .map((json, index) => ({ json, index }))
        .filter(({ json }) => connectionPlatformOf(json) !== null && json !== desired)
        .map(({ index }) => index)
        .sort((a, b) => b - a);
      for (const index of stale) {
        if (await this.chain.removeSource(view.contract, index)) repaired++;
      }
      if (desired && !sources.includes(desired)) {
        if (await this.chain.addSource(view.contract, desired)) repaired++;
      }
    }
    if (repaired > 0) this.logger.log(`Connection source reconcile: ${repaired} fix(es)`);
  }

  /** Resolve a handle (by bytes32 id or label) to its on-chain view. */
  private async handleView(handleId: string): Promise<OnChainHandleView | undefined> {
    const key = handleId.trim().toLowerCase();
    const views = await this.sync.handles();
    return views.find(
      (v) => v.id.toLowerCase() === key || bytes32ToId(v.id).toLowerCase() === key,
    );
  }

  /** Confirm the handle exists on-chain (from the graph). */
  private async isHandleId(handleId: string): Promise<boolean> {
    const views = await this.sync.handles();
    return views.some((v) => bytes32ToId(v.id) === handleId || v.id === handleId);
  }
}