import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createPublicClient, createWalletClient, http, parseAbi, toHex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { handleIdBytes32 } from "@aura/contracts";
import { PortfolioService } from "./portfolio.service";

/** HandleFactory creator-side surface — `createHandle` is `onlyOwner`, so the
 *  oracle signs with HANDLE_OWNER_PRIVATE_KEY on the user's behalf. */
// Parsed, not raw strings: viem's write path needs a real ABI (raw strings
// throw `Cannot use 'in' operator to search for 'name' in function …`).
const HANDLE_FACTORY_ABI = parseAbi([
  "function createHandle(bytes32 handleId, address creator, string name, string symbol, string metadata, uint256 windowMinutes, uint256[] categories) returns (address)",
  "function handleOf(bytes32 handleId) view returns (address)",
  "function setAuraUpdater(bytes32 handleId, address updater)",
]);

/** Owner-side writes on a deployed Handle (the oracle holds the owner key). */
const HANDLE_ABI = [
  "function setMetadata(string metadata)",
  "function metadata() view returns (string)",
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const WINDOW_MINUTES_ALLOWED = new Set([15, 30, 60, 120, 240, 480, 1440]);
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
/** Mirrors `Handle.MAX_CATEGORIES`. */
const MAX_CATEGORIES = 4;

/**
 * Validate + dedupe the category codes a handle is being created with.
 * A handle belongs to one or more families (a footballer is sport AND people);
 * the first entry is its primary category. Codes are the plain on-chain list:
 * 1 people · 2 crypto · 3 sports · 4 ai · 5 tech · 6 brands · 7 music · 8 memes ·
 * 9 culture.
 */
function normaliseCategories(input: unknown): number[] {
  if (!Array.isArray(input) || input.length === 0)
    throw new BadRequestException("categories must be a non-empty array of codes");
  const codes: number[] = [];
  for (const raw of input) {
    const code = Number(raw);
    if (!Number.isSafeInteger(code) || code < 1 || code > 9)
      throw new BadRequestException("each category must be a known category code (1-9)");
    if (!codes.includes(code)) codes.push(code);
  }
  if (codes.length > MAX_CATEGORIES)
    throw new BadRequestException(`at most ${MAX_CATEGORIES} categories per handle`);
  return codes;
}

export interface HandleCreateInput {
  name: string;
  symbol: string;
  /** One or more category codes - e.g. a footballer is sport AND people. */
  categories: number[];
  windowMinutes: number;
  metadata?: string;
  /** Cloudinary https URL of the uploaded handle photo (multipart `photo`). */
  photo?: string;
}

export interface HandleUpdateInput {
  name?: string;
  symbol?: string;
  /** Cloudinary https URL of the uploaded handle photo (multipart `photo`). */
  photo?: string;
  /** The handle's current metadata JSON (from the indexer) to merge into. */
  current?: string;
}

export interface HandleCreateResult {
  handleId: string;
  label: string;
  address: string;
  tx: string;
}

/**
 * Handle creation (permissionless for users, env-gated for the backend):
 * the frontend posts name/symbol/categories/windowMinutes with a wallet JWT;
 * the oracle validates, runs the claim flow's availability check (reserved /
 * claimed / CVI), then signs `HandleFactory.createHandle(handleId, creator,
 * …)` with the factory owner key. handleId is the left-aligned bytes32 of the
 * lowercased name — `handleIdBytes32` matches `ethers.encodeBytes32String`.
 */
@Injectable()
export class HandleCreateService {
  private readonly logger = new Logger(HandleCreateService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly portfolio: PortfolioService,
  ) {}

  private get signer(): { key: `0x${string}`; factory: Address; rpc: string } | null {
    const key = this.config.get<string>("HANDLE_OWNER_PRIVATE_KEY");
    const factory = this.config.get<string>("HANDLE_FACTORY_ADDRESS");
    const rpc =
      this.config.get<string>("ALCHEMY_RPC_URL") ?? this.config.get<string>("RPC_URL");
    if (!key || !factory || !rpc) return null;
    return { key: key as `0x${string}`, factory: factory as Address, rpc };
  }

  /**
   * The oracle relayer EOA that must be the handle's `auraUpdater` — and, through
   * the curator fallback, its curator. `HandleFactory.createHandle` leaves both
   * roles unset, so without wiring this the oracle cannot push aura
   * (`NotUpdater`) or curate sources (`NotCurator`) on a handle it just created.
   * Null when ORACLE_PRIVATE_KEY is unset (the oracle can't write anyway).
   */
  private get relayer(): Address | null {
    const key = this.config.get<string>("ORACLE_PRIVATE_KEY");
    if (!key) return null;
    try {
      return privateKeyToAccount(key as `0x${string}`).address;
    } catch {
      return null;
    }
  }

  async create(creator: string, input: HandleCreateInput): Promise<HandleCreateResult> {
    const signer = this.signer;
    if (!signer)
      throw new ServiceUnavailableException(
        "Handle creation not configured — set HANDLE_OWNER_PRIVATE_KEY and HANDLE_FACTORY_ADDRESS",
      );

    const name = String(input.name ?? "").trim();
    const label = name.toLowerCase();
    const symbol = String(input.symbol ?? "").trim();
    const categories = normaliseCategories(input.categories);
    const windowMinutes = Number(input.windowMinutes);

    if (!/^[a-z0-9]{3,20}$/.test(label))
      throw new BadRequestException("name must be 3-20 characters of a-z and 0-9");
    if (!/^[A-Za-z0-9]{1,8}$/.test(symbol))
      throw new BadRequestException("symbol must be 1-8 letters or digits");
    if (!WINDOW_MINUTES_ALLOWED.has(windowMinutes))
      throw new BadRequestException(
        "windowMinutes must be one of 15/30/60/120/240/480/1440",
      );
    if (input.metadata !== undefined && typeof input.metadata !== "string")
      throw new BadRequestException("metadata must be a string");
    if (
      input.photo !== undefined &&
      (typeof input.photo !== "string" || !input.photo.startsWith("https://"))
    )
      throw new BadRequestException("photo must be an https URL");
    if (!ADDRESS_RE.test(creator)) throw new BadRequestException("bad creator address");

    // Metadata JSON written on-chain: base {name, label} + optional user
    // metadata + the Cloudinary photo URL, re-checked against the 512-char
    // on-chain bound after merging.
    const meta: Record<string, unknown> = { name, label };
    if (input.metadata) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(input.metadata);
      } catch {
        throw new BadRequestException("metadata must be valid JSON");
      }
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        Object.assign(meta, parsed);
    }
    if (input.photo) meta.photo = input.photo;
    const metadataJson = JSON.stringify(meta);
    if (metadataJson.length > 512)
      throw new BadRequestException("metadata (with photo) must stay under 512 characters");

    // Reserved / already-claimed / CVI-gated names reuse the claim flow's check.
    const availability = await this.portfolio.availability(label, creator);
    if (!availability.available)
      throw new BadRequestException(`handle not available (${availability.reason})`);

    const chain = monadTestnet;
    const account = privateKeyToAccount(signer.key);
    const publicClient = createPublicClient({ chain, transport: http(signer.rpc) });
    const walletClient = createWalletClient({ chain, transport: http(signer.rpc), account });

    const handleId = toHex(handleIdBytes32(label));
    const existing = (await publicClient.readContract({
      address: signer.factory,
      abi: HANDLE_FACTORY_ABI,
      functionName: "handleOf",
      args: [handleId],
    })) as Address;
    if (existing.toLowerCase() !== ZERO_ADDRESS)
      throw new ConflictException(`handle @${label} already exists on-chain`);

    const hash = await walletClient.writeContract({
      address: signer.factory,
      abi: HANDLE_FACTORY_ABI,
      functionName: "createHandle",
      args: [
        handleId,
        creator as Address,
        name,
        symbol,
        metadataJson,
        BigInt(windowMinutes),
        categories.map((code) => BigInt(code)),
      ],
      chain,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    const address = (await publicClient.readContract({
      address: signer.factory,
      abi: HANDLE_FACTORY_ABI,
      functionName: "handleOf",
      args: [handleId],
    })) as Address;

    // Wire the oracle relayer as the handle's auraUpdater (factory owner signs).
    // `createHandle` leaves it unset; the curator role falls back to it, so this
    // is what lets the oracle push aura and add/remove the handle's sources.
    const relayer = this.relayer;
    if (relayer) {
      const wire = await walletClient.writeContract({
        address: signer.factory,
        abi: HANDLE_FACTORY_ABI,
        functionName: "setAuraUpdater",
        args: [handleId, relayer],
        chain,
        account,
      });
      await publicClient.waitForTransactionReceipt({ hash: wire });
    } else {
      this.logger.warn(
        `ORACLE_PRIVATE_KEY unset — @${label} created with no auraUpdater; the oracle cannot curate it until one is set`,
      );
    }

    this.logger.log(`Created handle @${label} → ${address} (tx ${hash})`);
    return { handleId, label, address, tx: hash };
  }

  /**
   * UPDATE a handle's profile — the oracle signs `Handle.setMetadata` with the
   * owner key (the contract is Ownable, so the frontend can't write it itself).
   * Merges into the existing metadata JSON: keep everything, override name /
   * symbol / photo. Returns 503 until the signer is configured.
   */
  async update(label: string, input: HandleUpdateInput): Promise<HandleCreateResult> {
    const signer = this.signer;
    if (!signer)
      throw new ServiceUnavailableException(
        "Handle updates not configured — set HANDLE_OWNER_PRIVATE_KEY and HANDLE_FACTORY_ADDRESS",
      );

    const name = String(input.name ?? "").trim();
    const symbol = String(input.symbol ?? "").trim();
    if (name && (name.length < 1 || name.length > 40))
      throw new BadRequestException("name must be 1-40 characters");
    if (symbol && !/^[A-Za-z0-9]{1,8}$/.test(symbol))
      throw new BadRequestException("symbol must be 1-8 letters or digits");
    if (
      input.photo !== undefined &&
      (typeof input.photo !== "string" || !input.photo.startsWith("https://"))
    )
      throw new BadRequestException("photo must be an https URL");

    const chain = monadTestnet;
    const account = privateKeyToAccount(signer.key);
    const publicClient = createPublicClient({ chain, transport: http(signer.rpc) });
    const walletClient = createWalletClient({ chain, transport: http(signer.rpc), account });

    const handleId = toHex(handleIdBytes32(label));
    const address = (await publicClient.readContract({
      address: signer.factory,
      abi: HANDLE_FACTORY_ABI,
      functionName: "handleOf",
      args: [handleId],
    })) as Address;
    if (address.toLowerCase() === ZERO_ADDRESS)
      throw new NotFoundException(`handle @${label} does not exist`);

    // Merge: existing metadata (indexer copy) + the fields being changed.
    const meta: Record<string, unknown> = {};
    if (input.current) {
      try {
        const parsed = JSON.parse(input.current) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          Object.assign(meta, parsed);
      } catch {
        /* unparsable metadata is replaced, not merged */
      }
    }
    if (name) meta.name = name;
    if (symbol) meta.symbol = symbol;
    if (input.photo) meta.photo = input.photo;
    meta.label = label;
    const metadataJson = JSON.stringify(meta);
    if (metadataJson.length > 512)
      throw new BadRequestException("metadata (with photo) must stay under 512 characters");

    const hash = await walletClient.writeContract({
      address,
      abi: HANDLE_ABI,
      functionName: "setMetadata",
      args: [metadataJson],
      chain,
      account,
    });
    await publicClient.waitForTransactionReceipt({ hash });

    this.logger.log(`Updated handle @${label} (${address}) — tx ${hash}`);
    return { handleId, label, address, tx: hash };
  }
}
