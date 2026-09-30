import { BadRequestException, Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query, Req, ServiceUnavailableException, UploadedFile, UnauthorizedException, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import multer from "multer";
import type { Request } from "express";
import type { HandleSnapshot } from "@aura/contracts";
import { IndexerReader } from "../jobs/indexer/indexer-reader.service";
import { handleSnapshot } from "../jobs/indexer/handle-snapshot";
import {
  PortfolioService,
  type HandleAvailability,
  type HandleConnectionView,
  type HandleVerifyResult,
} from "./portfolio.service";
import { CleanverseService, type Verification } from "./cleanverse.service";
import { HandleCreateService, type HandleCreateInput, type HandleCreateResult, type HandleUpdateInput } from "./handle-create.service";
import { CloudinaryService } from "./cloudinary.service";
import { WalletAuthGuard } from "../auth/wallet-auth.guard";

type AuthedRequest = Request & { user?: { userId: string } };

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** The JWT's wallet address (lowercased) — the creator comes from the token,
 *  never from a spoofable body. */
function actorOf(req: AuthedRequest): string {
  const userId = req.user?.userId;
  if (!userId || !ADDRESS_RE.test(userId)) throw new UnauthorizedException("Bad auth subject");
  return userId.toLowerCase();
}

/**
 * Frontend-shaped handle endpoints — `GET /v1/handles...`.
 * On-chain handles come from the INDEXER (the single source of truth), not a
 * Postgres mirror.
 */
@Controller("v1/handles")
export class HandlesController {
  constructor(
    private readonly indexer: IndexerReader,
    private readonly portfolio: PortfolioService,
    private readonly cleanverse: CleanverseService,
    private readonly handleCreate: HandleCreateService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  @Get()
  async all(): Promise<HandleSnapshot[]> {
    const handles = await this.indexer.handles();
    return handles.map((h) => handleSnapshot(h));
  }

  /**
   * CREATE a handle — wallet-JWT required (creator = token subject); the
   * oracle signs `HandleFactory.createHandle` with the owner key. 503 until
   * HANDLE_OWNER_PRIVATE_KEY + HANDLE_FACTORY_ADDRESS are configured.
   * Accepts multipart/form-data with an optional `photo` (image ≤5 MB) which
   * is uploaded to Cloudinary and stored as `metadata.photo` on-chain; plain
   * JSON bodies still work when no photo is sent.
   */
  @Post()
  @UseGuards(WalletAuthGuard)
  @UseInterceptors(
    FileInterceptor("photo", {
      storage: multer.memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith("image/")) cb(null, true);
        else cb(new BadRequestException("photo must be an image"), false);
      },
    }),
  )
  async create(
    @Req() req: AuthedRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: HandleCreateInput,
  ): Promise<HandleCreateResult> {
    let photo: string | undefined;
    if (file) {
      const media = await this.cloudinary.upload(
        file.buffer,
        file.mimetype,
        String(body?.name ?? "handle"),
        "aura/handles",
      );
      if (!media)
        throw new ServiceUnavailableException(
          "Handle photo upload unavailable — Cloudinary not configured",
        );
      photo = media.src;
    }
    return this.handleCreate.create(actorOf(req), { ...body, photo });
  }

  /**
   * UPDATE a handle's profile — wallet-JWT required. Multipart with an optional
   * `photo` image (≤5 MB) uploaded to Cloudinary; name/symbol ride in the same
   * metadata JSON. The oracle signs `Handle.setMetadata` with the owner key, so
   * the frontend never has to hold the handle contract's owner rights.
   */
  @Patch(":id")
  @UseGuards(WalletAuthGuard)
  @UseInterceptors(
    FileInterceptor("photo", {
      storage: multer.memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith("image/")) cb(null, true);
        else cb(new BadRequestException("photo must be an image"), false);
      },
    }),
  )
  async update(
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: HandleUpdateInput,
  ): Promise<HandleCreateResult> {
    const label = String(id ?? "").toLowerCase();
    if (!/^[a-z0-9]{3,20}$/.test(label)) throw new BadRequestException("bad handle id");

    let photo: string | undefined;
    if (file) {
      const media = await this.cloudinary.upload(
        file.buffer,
        file.mimetype,
        String(body?.name ?? label),
        "aura/handles",
      );
      if (!media)
        throw new ServiceUnavailableException(
          "Handle photo upload unavailable — Cloudinary not configured",
        );
      photo = media.src;
    }

    // Merge source: the handle's current metadata as indexed by the indexer.
    const existing = (await this.indexer.handles()).find(
      (h) => h.label?.toLowerCase() === label || h.id.toLowerCase() === label,
    );

    return this.handleCreate.update(label, { ...body, photo, current: existing?.metadata ?? undefined });
  }

  // --- portfolio: CVI verification (Cleanverse) + claiming ------------------
  // NOTE: single-segment routes (`verify`) must be declared BEFORE `:id` or
  // Express matches them as a handle id first.

  /** CVI identity verification status for a wallet (Cleanverse). */
  @Get("verify")
  async verify(@Query("address") address: string): Promise<Verification> {
    return this.cleanverse.verify(address);
  }

  /** Claim availability — reserved names, names picked on the graph, and
   *  (when required) the creator's CVI verification. */
  @Get("availability/check")
  async availability(@Query("name") name: string, @Query("address") address?: string): Promise<HandleAvailability> {
    return this.portfolio.availability(name, address);
  }

  /** Frontend → backend → onchain: verify the handle's creator (Cleanverse
   *  A-Pass) and write `Handle.setVerified` on-chain. */
  @Post(":id/verify")
  async verifyHandle(@Param("id") id: string): Promise<HandleVerifyResult> {
    return this.portfolio.verifyHandle(id);
  }

  /** Current on-chain `Handle.verified` flag (drives the UI badge). */
  @Get(":id/verified")
  async handleVerified(@Param("id") id: string): Promise<{ verified: boolean | null }> {
    return this.portfolio.handleVerified(id);
  }

  @Get(":id")
  async one(@Param("id") id: string): Promise<HandleSnapshot> {
    const handles = await this.indexer.handles();
    const handle = handles.find((h) => h.label === id.toLowerCase());
    if (!handle) throw new NotFoundException(`No handle ${id}`);
    return handleSnapshot(handle);
  }

  // --- portfolio: handle claiming + one source connection per handle --------

  /** The handle's current social connection (one per handle). */
  @Get(":id/connection")
  async connection(@Param("id") id: string): Promise<HandleConnectionView> {
    return this.portfolio.connection(id);
  }

  /** CONNECT or RECONNECT a handle to a platform account. */
  @Put(":id/connection")
  async connect(
    @Param("id") id: string,
    @Body() body: { platform: string; account: string; reconnect?: boolean },
  ): Promise<HandleConnectionView> {
    return this.portfolio.connect(id, body.platform, body.account, body.reconnect ? "reconnecting" : "connected");
  }

  /** DISCONNECT the handle's connection. */
  @Delete(":id/connection")
  async disconnect(@Param("id") id: string): Promise<HandleConnectionView> {
    return this.portfolio.disconnect(id);
  }
}