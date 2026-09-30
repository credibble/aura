import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export interface Verification {
  verified: boolean;
  /** Cleanverse identity credential: "A-Pass" (non-transferable identity token). */
  credential: "A-Pass";
  /** Verification tier (A-Pass may be structured with levels). */
  tier: string | null;
  /** The wallet this A-Pass is cryptographically bound to. */
  did: string | null;
  address: string;
}

/**
 * Cleanverse Verified Identity (CVI) integration — gates creator verification /
 * handle claiming behind an on-chain identity check.
 *
 * Per Cleanverse: a wallet is bound to an A-Pass — a NON-TRANSFERABLE, reusable
 * on-chain identity credential attesting a bank-verified identity (ID/passport
 * + bank credential). No raw PII is stored on-chain; the wallet holds a
 * cryptographic attestation and Cleanverse acts as the credential attestor.
 * Enforcement is on-chain: A-Pass-verified wallets only.
 *
 * This service checks a wallet's A-Pass credential status through the Cleanverse
 * API/SDK seam. When CLEANVERSE_URL + CLEANVERSE_API_KEY are not configured the
 * check FAILS CLOSED (never verified) — no mock identity data.
 */
@Injectable()
export class CleanverseService {
  private readonly logger = new Logger(CleanverseService.name);

  constructor(private readonly config: ConfigService) {}

  /** Whether A-Pass verification is required before a user can claim a handle. */
  get required(): boolean {
    return this.config.get<string>("CLEANVERSE_REQUIRED") === "true";
  }

  /** Check a wallet's A-Pass (CVI) credential status. Fails closed when the
   *  Cleanverse endpoint is unconfigured/unreachable — never returns a mock. */
  async verify(address: string): Promise<Verification> {
    const base = this.config.get<string>("CLEANVERSE_URL");
    const key = this.config.get<string>("CLEANVERSE_API_KEY");

    if (!base || !key) {
      this.logger.warn(
        `Cleanverse unconfigured — verification fails closed for ${address}`,
      );
      return { verified: false, credential: "A-Pass", tier: null, did: null, address };
    }

    try {
      // Cleanverse API seam: A-Pass credential status for a wallet.
      const res = await fetch(`${base.replace(/\/$/, "")}/v1/a-pass/${address}`, {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const json = (await res.json()) as {
          credential?: string;
          status?: string;
          tier?: string | null;
          did?: string | null;
        };
        const verified = json.status === "verified" || json.status === "active";
        return {
          verified,
          credential: "A-Pass",
          tier: verified ? (json.tier ?? "standard") : null,
          did: verified ? (json.did ?? `a-pass:${address}`) : null,
          address,
        };
      }
      this.logger.warn(`Cleanverse A-Pass HTTP ${res.status} for ${address}`);
    } catch (error) {
      this.logger.warn(`Cleanverse unreachable: ${(error as Error).message}`);
    }

    return { verified: false, credential: "A-Pass", tier: null, did: null, address };
  }
}