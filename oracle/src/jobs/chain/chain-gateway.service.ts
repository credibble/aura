import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  toHex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import Redis from "ioredis";
import { handleIdBytes32 } from "@aura/contracts";
import type { Abi } from "viem";
import MarketMakerArtifact from "../../relay/abis/MarketMaker.json";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
import OracleFactoryArtifact from "../../relay/abis/OracleFactory.json";
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
import HandleArtifact from "../../relay/abis/Handle.json";

// The relay JSONs are inconsistent: some are full hardhat artifacts
// (hh-sol-artifact-1), some are a bare ABI array. viem needs the ABI *array* —
// passing an artifact object fails every call with "abi.filter is not a
// function".
const abiOf = (json: unknown): Abi =>
  (Array.isArray(json) ? json : (json as { abi: Abi }).abi) as Abi;
const MarketMakerAbi = abiOf(MarketMakerArtifact);
const OracleFactoryAbi = abiOf(OracleFactoryArtifact);
const HandleAbi = abiOf(HandleArtifact);

/**
 * Token-bucket throttle for RPC calls. The public Monad endpoint answers bursts
 * but caps at ~15 req/s and rejects the excess with "requests limited to 15/sec"
 * — which surfaced as failed reads and retried ticks. Spacing the calls out is
 * strictly better than erroring: same work, no wasted round trips.
 */
function createRateLimiter(rps: number): <T>(fn: () => Promise<T>) => Promise<T> {
  const gapMs = 1000 / Math.max(1, rps);
  let nextAt = 0;
  return async <T>(fn: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    const wait = nextAt - now;
    nextAt = Math.max(now, nextAt) + gapMs;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return fn();
  };
}

/**
 * Owner-side Oracle surface — resolution submission (the market settles after).
 *
 * MUST be `parseAbi`d: viem reads accept human-readable strings, but any WRITE
 * path (`encodeFunctionData`) needs a real ABI — raw strings fail every call
 * with `Cannot use 'in' operator to search for 'name' in function …`, which is
 * exactly how every settle silently failed before.
 */
const OracleAbi = parseAbi([
  "function submitResolution((bytes32,uint256,uint256,uint256,uint256,int256,uint256,uint256,bool,uint32,bytes32,uint256,bytes32) receipt, bytes signature)",
  "function windowStatus() view returns (uint8)",
  "function windowEnd() view returns (uint256)",
]);

/** EIP-712 struct — must match ResolutionReceiptLib's field order/types. */
const RESOLUTION_TYPES = {
  ResolutionReceipt: [
    { name: "handleId", type: "bytes32" },
    { name: "windowStart", type: "uint256" },
    { name: "windowEnd", type: "uint256" },
    { name: "s", type: "uint256" },
    { name: "expectation", type: "uint256" },
    { name: "delta", type: "int256" },
    { name: "indexOpen", type: "uint256" },
    { name: "indexClose", type: "uint256" },
    { name: "direction", type: "bool" },
    { name: "itemCount", type: "uint32" },
    { name: "outcomesHash", type: "bytes32" },
    { name: "resolvedAt", type: "uint256" },
    { name: "inputsHash", type: "bytes32" },
  ],
} as const;

/**
 * The window engine hands the receipt AURA values, which are 1e2 on-chain
 * (4150 = 41.50). The EIP-712 receipt struct is 1e4-scaled (PRICE_SCALE: a real
 * value × 10_000 — the contract tests sign `SCALED(64.1)`), so an aura has to be
 * converted 1e2 → 1e4 by ×100. Scaling an already-1e2 value by 1e4 would land
 * 100× too high (41.50 → 41,500,000 instead of 415,000).
 */
const AURA_PER_RECEIPT_UNIT = 100n;
const scaled = (aura1e2: number): bigint => BigInt(Math.round(aura1e2)) * AURA_PER_RECEIPT_UNIT;
const scaledSigned = (aura1e2: number): bigint => BigInt(Math.round(aura1e2)) * AURA_PER_RECEIPT_UNIT;

/**
 * viem gateway to the Aura contracts (MarketMaker, OracleFactory, Handle).
 * Read path is `publicClient`; every write goes through the protocol signer
 * (`ORACLE_PRIVATE_KEY`). The relayer is the handle's `auraUpdater`, so
 * `updateAura` and `setGraduated` are authorized; open/settle are the oracle
 * relayer's responsibility. All actions are best-effort and idempotent via the
 * job schedulers' stable jobIds. The ABIs come from runtime JSON artifacts, so
 * the viem calls are loosely typed (the JSON ABI can't be narrowed statically).
 */
@Injectable()
export class ChainGateway implements OnModuleInit {
  private readonly logger = new Logger(ChainGateway.name);
  private publicClient!: PublicClient;
  private walletClient!: WalletClient;
  private account!: PrivateKeyAccount;
  private enabled = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const rpc = this.config.get<string>("ALCHEMY_RPC_URL") ?? this.config.get<string>("RPC_URL");
    const pk = this.config.get<string>("ORACLE_PRIVATE_KEY");
    if (!rpc || !pk) {
      this.logger.warn("Chain gateway disabled — set RPC_URL + ORACLE_PRIVATE_KEY.");
      return;
    }
    const chain = this.config.get<number>("CHAIN_ID") === 10_143 ? monadTestnet : monadTestnet;
    this.account = privateKeyToAccount(pk as `0x${string}`);
    // The public Monad testnet RPC rate-limits under load — retry transient
    // rejections with backoff instead of surfacing them as failures.
    const retryOpts = {
      retryCount: this.config.get<number>("RPC_RETRY_COUNT") ?? 4,
      retryDelay: this.config.get<number>("RPC_RETRY_DELAY_MS") ?? 1_500,
    };
    // Throttle every RPC call (reads AND writes) under the public endpoint's cap.
    const limit = createRateLimiter(this.config.get<number>("RPC_MAX_RPS") ?? 10);
    const transport = (url: string) =>
      http(url, {
        ...retryOpts,
        fetchFn: ((input: RequestInfo | URL, init?: RequestInit) =>
          limit(() => fetch(input, init))) as typeof fetch,
      });
    this.publicClient = createPublicClient({ chain, transport: transport(rpc) });
    this.walletClient = createWalletClient({
      chain,
      transport: transport(rpc),
      account: this.account,
    });
    this.enabled = true;
    this.logger.log(`Chain gateway enabled (signer=${this.account.address})`);
  }

  private get market(): string | undefined {
    return this.config.get<string>("MARKET_MAKER_ADDRESS") ?? this.config.get<string>("INDEX_MARKET_ADDRESS");
  }

  /** Chain the signer is bound to — part of the EIP-712 resolution domain. */
  private get chainId(): number {
    return this.config.get<number>("CHAIN_ID") ?? 10_143;
  }

  private get factory(): string | undefined {
    return this.config.get<string>("ORACLE_FACTORY_ADDRESS");
  }

  // --- reads ----------------------------------------------------------------

  /** True when a signer + RPC + market address are configured. */
  get ready(): boolean {
    return this.enabled;
  }

  async isOpen(oracle: string): Promise<boolean | null> {
    if (!this.enabled || !this.market) return null;
    try {
      return (await this.read({
        address: this.market,
        abi: MarketMakerAbi,
        functionName: "isOpen",
        args: [oracle],
      })) as boolean;
    } catch (error) {
      // `null` = UNKNOWN (RPC problem), deliberately distinct from `false`
      // ("closed"): callers must retry instead of acting on a wrong answer.
      this.logger.warn(`isOpen unknown (${oracle}): ${(error as Error).message}`);
      return null;
    }
  }

  async oracleOf(handleId: string, startSec: number): Promise<string | null> {
    if (!this.enabled || !this.factory) return null;
    try {
      return (await this.read({
        address: this.factory,
        abi: OracleFactoryAbi,
        functionName: "oracleOf",
        args: [toHex(handleIdBytes32(handleId)), BigInt(startSec)],
      })) as string;
    } catch (error) {
      this.logger.warn(`oracleOf failed: ${(error as Error).message}`);
      return null;
    }
  }

  /**
   * The window Oracle's lifecycle status: 0 OPEN, 1 FROZEN, 2 RESOLVED,
   * 3 VOIDED. `null` = RPC couldn't answer (distinct from a status of 0).
   */
  async windowStatus(oracle: string): Promise<number | null> {
    if (!this.enabled) return null;
    try {
      const status = (await this.read({
        address: oracle,
        abi: OracleAbi,
        functionName: "windowStatus",
        args: [],
      })) as bigint | number;
      return Number(status);
    } catch (error) {
      this.logger.warn(`windowStatus unknown (${oracle}): ${(error as Error).message}`);
      return null;
    }
  }

  async onChainAura(handleContract: string): Promise<number | null> {
    if (!this.enabled) return null;
    try {
      const raw = (await this.read({
        address: handleContract,
        abi: HandleAbi,
        functionName: "aura",
        args: [],
      })) as bigint;
      return Number(raw);
    } catch (error) {
      this.logger.warn(`aura read failed: ${(error as Error).message}`);
      return null;
    }
  }

  // --- writes ---------------------------------------------------------------

  async updateAura(handleContract: string, aura: number, summary = ""): Promise<boolean> {
    if (!this.enabled || !this.account) return false;
    try {
      await this.write({
        address: handleContract,
        abi: HandleAbi,
        functionName: "updateAura",
        args: [BigInt(aura), summary],
      });
      return true;
    } catch (error) {
      this.logger.error(`updateAura failed (${handleContract}): ${(error as Error).message}`);
      return false;
    }
  }

  /** Open a window with the category-driven style (binary YES/NO or
   *  multi-outcome). `probabilities` (1e18 each, Σ = 1e18) seed the LMSR's
   *  initial prices; `oracleMetadata` carries the derived question. */
  async openWindow(
    handleId: string,
    startSec: number,
    endSec: number,
    funding: string,
    outcomes: string[],
    probabilities: string[],
    oracleMetadata: string,
  ): Promise<boolean> {
    if (!this.enabled || !this.market) return false;
    try {
      await this.write({
        address: this.market,
        abi: MarketMakerAbi,
        functionName: "openWindow",
        args: [
          toHex(handleIdBytes32(handleId)),
          BigInt(startSec),
          BigInt(endSec),
          outcomes,
          outcomes.map((name, outcome) => JSON.stringify({ handle: handleId, outcome, name })),
          probabilities.map((p) => BigInt(p)),
          oracleMetadata,
          BigInt(funding),
        ],
      });
      return true;
    } catch (error) {
      this.logger.error(`openWindow failed (@${handleId} ${startSec}): ${(error as Error).message}`);
      return false;
    }
  }

  async settle(oracle: string, winningOutcome: number): Promise<boolean> {
    if (!this.enabled || !this.market) return false;
    try {
      await this.write({
        address: this.market,
        abi: MarketMakerAbi,
        functionName: "settle",
        args: [oracle, BigInt(winningOutcome)],
      });
      return true;
    } catch (error) {
      this.logger.error(`settle failed (${oracle}): ${(error as Error).message}`);
      return false;
    }
  }

  /**
   * Resolve THEN settle — the only valid path now that the market requires the
   * window's Oracle to carry a verified resolution:
   *   1. sign the EIP-712 `ResolutionReceipt` with the relayer key (the oracle
   *      signer) and submit it to the window's Oracle;
   *   2. settle the market, which mirrors the outcome the Oracle recorded.
   * Skipping step 1 makes `settle` revert `OracleNotResolved`.
   */
  async resolveAndSettle(
    oracle: string,
    receipt: {
      handleId: string;
      windowStart: number;
      windowEnd: number;
      s: number;
      expectation: number;
      delta: number;
      indexOpen: number;
      indexClose: number;
      direction: boolean;
      itemCount: number;
      outcomesHash: string;
      inputsHash: string;
    },
    winningOutcome: number,
  ): Promise<boolean> {
    if (!this.enabled || !this.market || !this.account) return false;
    try {
      // Already resolved (a previous attempt submitted but its settle failed, or
      // the early-close path resolved on the aura tick): re-submitting reverts
      // `AlreadyResolved`, which would leave the window permanently unsettled.
      // Detect RESOLVED and go straight to settle.
      const status = await this.windowStatus(oracle);
      if (status !== 2) {
        const message = {
          handleId: receipt.handleId as `0x${string}`,
          windowStart: BigInt(Math.floor(receipt.windowStart)),
          windowEnd: BigInt(Math.floor(receipt.windowEnd)),
          s: scaled(receipt.s),
          expectation: scaled(receipt.expectation),
          delta: scaledSigned(receipt.delta),
          indexOpen: scaled(receipt.indexOpen),
          indexClose: scaled(receipt.indexClose),
          direction: receipt.direction,
          itemCount: Math.max(0, Math.floor(receipt.itemCount)),
          outcomesHash: receipt.outcomesHash as `0x${string}`,
          resolvedAt: BigInt(Math.floor(Date.now() / 1000)),
          inputsHash: receipt.inputsHash as `0x${string}`,
        };
        // Domain mirrors ResolutionReceiptLib.domainSeparator exactly.
        const signature = await this.account.signTypedData({
          domain: {
            name: "Aura Oracle",
            version: "1",
            chainId: BigInt(this.chainId),
            verifyingContract: oracle as `0x${string}`,
          },
          types: RESOLUTION_TYPES,
          primaryType: "ResolutionReceipt",
          message,
        });

        await this.write({
          address: oracle,
          abi: OracleAbi,
          functionName: "submitResolution",
          args: [
            [
              message.handleId,
              message.windowStart,
              message.windowEnd,
              message.s,
              message.expectation,
              message.delta,
              message.indexOpen,
              message.indexClose,
              message.direction,
              message.itemCount,
              message.outcomesHash,
              message.resolvedAt,
              message.inputsHash,
            ],
            signature,
          ],
        });
      }
      return await this.settle(oracle, winningOutcome);
    } catch (error) {
      this.logger.error(`resolveAndSettle failed (${oracle}): ${(error as Error).message}`);
      return false;
    }
  }

  /** Read a Handle's on-chain CVI flag (`Handle.verified`). */
  async isVerified(handleContract: string): Promise<boolean | null> {
    if (!this.enabled) return null;
    try {
      return (await this.read({
        address: handleContract,
        abi: HandleAbi,
        functionName: "verified",
        args: [],
      })) as boolean;
    } catch (error) {
      this.logger.warn(`verified read failed (${handleContract}): ${(error as Error).message}`);
      return null;
    }
  }

  /** Mark the Handle CVI-verified on-chain (Handle.setVerified, onlyProtocol). */
  async setVerified(handleContract: string, ok: boolean): Promise<boolean> {
    if (!this.enabled || !this.account) return false;
    try {
      await this.write({
        address: handleContract,
        abi: HandleAbi,
        functionName: "setVerified",
        args: [ok],
      });
      return true;
    } catch (error) {
      this.logger.error(`setVerified failed (${handleContract}): ${(error as Error).message}`);
      return false;
    }
  }

  /** Push a handle's profile metadata JSON on-chain (Handle.setMetadata,
   *  onlyProtocol — the relayer/auraUpdater is authorized). */
  async setMetadata(handleContract: string, metadataJson: string): Promise<boolean> {
    if (!this.enabled || !this.account) return false;
    try {
      await this.write({
        address: handleContract,
        abi: HandleAbi,
        functionName: "setMetadata",
        args: [metadataJson],
      });
      return true;
    } catch (error) {
      this.logger.error(`setMetadata failed (${handleContract}): ${(error as Error).message}`);
      return false;
    }
  }

  // --- loose-typed viem wrappers (runtime JSON ABIs) -------------------------

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async read(params: Record<string, any>): Promise<unknown> {
    return this.publicClient.readContract(params as never);
  }

  /** Serializes every write — concurrent writes from one signer cause nonce
   *  collisions, which the public RPC surfaces as "Missing or invalid
   *  parameters". A send rejection retries; a confirmation timeout re-waits the
   *  SAME hash (never re-sends). Repeats are safe anyway: OracleFactory is
   *  idempotent and openWindow reverts WindowAlreadyOpen.
   *
   *  The in-process chain below only covers ONE process, so the actual send is
   *  additionally wrapped in a **Redis distributed lock**: with a worker and an
   *  API replica both holding this key, the lock is what stops them from racing
   *  on the same nonce. A permanent failure is parked in `chain:dlq` so an
   *  operator can see what the relayer gave up on. */
  private writeChain: Promise<unknown> = Promise.resolve();
  private lockConn: Redis | null = null;

  /**
   * Hard deadline over the WHOLE write: waiting for the predecessor write, the
   * cross-process lock, every send/receipt retry, and the lock release.
   *
   * This matters because the writes are serialized: a single wedged write used
   * to leave `writeChain` unsettled forever, so every later write — including a
   * window SETTLE — queued behind it and never ran, with no error and no log.
   * Blowing the deadline throws, so the BullMQ job retries instead of the
   * process holding it. Repeats are safe: OracleFactory is idempotent and
   * openWindow reverts when a window is already open.
   */
  private boundedWrite(fn: () => Promise<void>): Promise<void> {
    const deadline = this.config.get<number>("CHAIN_WRITE_DEADLINE_MS") ?? 120_000;
    return Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        const t = setTimeout(
          () => reject(new Error(`chain write exceeded the ${deadline}ms deadline`)),
          deadline,
        );
        (t as { unref?: () => void }).unref?.();
      }),
    ]);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => {
      const t = setTimeout(r, ms);
      (t as { unref?: () => void }).unref?.();
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private write(params: Record<string, any>): Promise<void> {
    const run = async (): Promise<void> => {
      const attempts = this.config.get<number>("CHAIN_WRITE_ATTEMPTS") ?? 5;
      const baseDelay = this.config.get<number>("CHAIN_WRITE_RETRY_DELAY_MS") ?? 1_500;
      const isTransient = (error: unknown): boolean =>
        /Missing or invalid parameters|RPC Request failed|timed out|timeout|429|rate.?limit|nonce|not found/i.test(
          (error as Error).message ?? "",
        );
      let lastError: unknown;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        let hash: `0x${string}`;
        try {
          hash = (await this.walletClient.writeContract(params as never)) as `0x${string}`;
        } catch (error) {
          lastError = error;
          if (attempt < attempts && isTransient(error)) {
            await new Promise((r) => setTimeout(r, baseDelay * attempt));
            continue;
          }
          throw error;
        }
        // The tx is accepted — wait on THIS hash (re-wait, never re-send).
        for (let waitTry = 1; waitTry <= attempts; waitTry++) {
          try {
            await this.publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
            return;
          } catch (error) {
            lastError = error;
            if (waitTry < attempts && isTransient(error)) {
              await new Promise((r) => setTimeout(r, baseDelay * waitTry));
              continue;
            }
            throw error;
          }
        }
      }
      throw lastError;
    };
    // Serialize, but never longer than one deadline: a wedged predecessor must
    // not turn into a wedged successor, and the lock + release are inside the
    // same deadline as the send.
    const deadline = this.config.get<number>("CHAIN_WRITE_DEADLINE_MS") ?? 120_000;
    const prev = this.writeChain;
    const next = this.boundedWrite(async () => {
      await Promise.race([prev.catch(() => undefined), this.sleep(deadline)]);
      await this.locked(() => run());
    });
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  /** Run `fn` holding the cross-process relayer lock (best-effort: no Redis = no lock). */
  private async locked<T>(fn: () => Promise<T>): Promise<T> {
    const client = this.relayerLock();
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const key = "relayer:lock";
    let held = false;
    if (client) {
      for (let i = 0; i < 60 && !held; i++) {
        try {
          const res = await Promise.race([
            client.set(key, token, "PX", 20_000, "NX"),
            new Promise<string>((r) => setTimeout(() => r("timeout"), 300)),
          ]);
          held = res === "OK";
        } catch {
          break; // Redis trouble → fall through to the in-process queue
        }
        if (!held) await new Promise((r) => setTimeout(r, 250));
      }
    }
    try {
      return await fn();
    } catch (error) {
      await this.deadLetter(error);
      throw error;
    } finally {
      if (held && client) {
        // Only release a lock we still own.
        await client
          .eval(
            "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
            1,
            key,
            token,
          )
          .catch(() => {});
      }
    }
  }

  /** Park a permanently-failed write for inspection (bounded list). */
  private async deadLetter(error: unknown): Promise<void> {
    const client = this.relayerLock();
    const entry = JSON.stringify({ ts: Date.now(), signer: this.account?.address, error: (error as Error).message });
    this.logger.error(`chain write failed permanently: ${entry}`);
    if (!client) return;
    try {
      await client.lpush("chain:dlq", entry);
      await client.ltrim("chain:dlq", 0, 499);
    } catch {
      /* the log line is the durable record if Redis is unavailable */
    }
  }

  /** Dedicated connection for the lock/DLQ — `enableOfflineQueue: false` so a
   *  down Redis fails fast instead of stalling every write. */
  private relayerLock(): Redis | null {
    if (this.lockConn) return this.lockConn;
    const url = this.config.get<string>("REDIS_URL");
    if (!url) return null;
    try {
      const client = new Redis(url, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 2,
        retryStrategy: (times) => Math.min(times * 500, 5000),
      });
      client.on("error", (e) => this.logger.debug(`relayer lock redis: ${e.message}`));
      void client.connect().catch(() => {});
      this.lockConn = client;
      return client;
    } catch {
      return null;
    }
  }
}