import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IndexerHandleSync } from "../registry/indexer-handle-sync.service";
import { PrismaService } from "../persistence/prisma.service";
import { CONNECTION_STORE } from "../core/ports/tokens";
import type { IConnectionStore } from "../core/ports/connection-store";
import { bytes32ToId } from "../core/domain/handle";
import { ChainGateway } from "../jobs/chain/chain-gateway.service";
import { CleanverseService, type Verification } from "./cleanverse.service";

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
export class PortfolioService {
  private readonly logger = new Logger(PortfolioService.name);

  constructor(
    private readonly sync: IndexerHandleSync,
    private readonly prisma: PrismaService,
    @Inject(CONNECTION_STORE) private readonly connections: IConnectionStore,
    private readonly config: ConfigService,
    private readonly cleanverse: CleanverseService,
    private readonly chain: ChainGateway,
  ) {}

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
   * the handle to it — the platform token is never stored here.
   */
  async connect(handleId: string, platform: string, account: string, status: "connected" | "reconnecting" = "connected"): Promise<HandleConnectionView> {
    const credentials = await this.connections.get(platform, account);
    if (!credentials) throw new Error(`No credential for ${platform}::${account} — connect it first`);
    if (!(await this.isHandleId(handleId))) throw new Error(`Unknown handle ${handleId}`);

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
    return view;
  }

  /** Disconnect a handle — unlinks the connection (credential stays usable). */
  async disconnect(handleId: string): Promise<HandleConnectionView> {
    try {
      await this.prisma.handleConnection.delete({ where: { id: handleId } });
    } catch {
      this.localConnections.delete(handleId);
    }
    return { handleId, platform: null, account: null, status: "disconnected", connectedAt: null };
  }

  private readonly localConnections = new Map<string, HandleConnectionView>();

  /** Confirm the handle exists on-chain (from the graph). */
  private async isHandleId(handleId: string): Promise<boolean> {
    const views = await this.sync.handles();
    return views.some((v) => bytes32ToId(v.id) === handleId || v.id === handleId);
  }
}