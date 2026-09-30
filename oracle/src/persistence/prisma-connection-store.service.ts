import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import type { IConnectionStore } from "../core/ports/connection-store";
import type { AdapterCredentials } from "../core/domain/source";
import { PrismaService } from "./prisma.service";
import { decryptField, deriveKey, encryptField } from "./connection-crypto";

const connectionId = (platform: string, account: string): string => `${platform}::${account}`;

/**
 * Connection store for adapter credentials (OAuth tokens / API keys) —
 * Postgres is the ONLY store (no Redis cache layer). Credentials are
 * AES-256-GCM encrypted at rest with CONNECTION_ENCRYPTION_KEY, so a DB dump
 * never exposes tokens. Credentials are NEVER stored on-chain; they are
 * registered via OAuth (Supabase-facilitated for social platforms) or a
 * manual API key and handed to adapters at fetch time.
 */
@Injectable()
export class PrismaConnectionStore implements IConnectionStore {
  private readonly logger = new Logger(PrismaConnectionStore.name);
  private readonly key: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.key = deriveKey(
      config.get<string>("CONNECTION_ENCRYPTION_KEY") || "aura-dev-connection-key",
    );
  }

  async get(platform: string, account?: string): Promise<AdapterCredentials | null> {
    if (!account) return null;
    const id = connectionId(platform, account);
    try {
      const row = await this.prisma.connection.findUnique({ where: { id } });
      if (!row) return null;
      const { secrets, apiKey } = readStored(row.secrets, this.key);
      return {
        accessToken: decryptField(row.accessToken, this.key),
        refreshToken: decryptField(row.refreshToken, this.key),
        apiKey,
        account,
        secrets,
      };
    } catch (error) {
      this.logger.warn(`Connection read failed for ${id}: ${(error as Error).message}`);
      return null;
    }
  }

  async set(platform: string, account: string, credentials: AdapterCredentials): Promise<void> {
    const id = connectionId(platform, account);
    try {
      const secrets = writeStored(credentials, this.key);
      await this.prisma.connection.upsert({
        where: { id },
        create: {
          id,
          platform,
          account,
          accessToken: encryptField(credentials.accessToken, this.key),
          refreshToken: encryptField(credentials.refreshToken, this.key),
          secrets: secrets ?? Prisma.DbNull,
        },
        update: {
          accessToken: encryptField(credentials.accessToken, this.key),
          refreshToken: encryptField(credentials.refreshToken, this.key),
          // `undefined` would keep stale secrets on update — DbNull clears them.
          secrets: secrets ?? Prisma.DbNull,
        },
      });
    } catch (error) {
      this.logger.error(`Connection write failed for ${id}: ${(error as Error).message}`);
      throw error;
    }
  }

  async remove(platform: string, account: string): Promise<void> {
    const id = connectionId(platform, account);
    try {
      await this.prisma.connection.delete({ where: { id } });
    } catch (error) {
      if ((error as { code?: string }).code === "P2025") return; // already gone
      this.logger.error(`Connection delete failed for ${id}: ${(error as Error).message}`);
      throw error;
    }
  }

  async accounts(platform: string): Promise<{ account: string; accessToken?: string; apiKey?: string }[]> {
    try {
      const rows = await this.prisma.connection.findMany({ where: { platform } });
      return rows.map((r) => ({
        account: r.account,
        accessToken: decryptField(r.accessToken, this.key),
        apiKey: readStored(r.secrets, this.key).apiKey,
      }));
    } catch (error) {
      this.logger.warn(`Connection listing failed for ${platform}: ${(error as Error).message}`);
      return [];
    }
  }
}

/** Decrypted side-channel of the `secrets` column (payload: `{ s, k }`). */
interface StoredPayload {
  s?: Record<string, string>;
  k?: string;
}

/**
 * Decrypt the `secrets` JSON column — holds both the secrets map and the
 * manual API key under one ciphertext. Legacy plaintext objects (written
 * pre-encryption) pass through as the secrets map.
 */
function readStored(
  value: unknown,
  key: Buffer,
): { secrets?: Record<string, string>; apiKey?: string } {
  if (value && typeof value === "object" && "__enc" in value) {
    const enc = (value as { __enc?: unknown }).__enc;
    if (typeof enc === "string") {
      try {
        const parsed = JSON.parse(decryptField(enc, key) ?? "{}") as StoredPayload;
        return { secrets: parsed.s, apiKey: parsed.k };
      } catch {
        return {};
      }
    }
    return {};
  }
  if (value && typeof value === "object") {
    return { secrets: value as Record<string, string> };
  }
  return {};
}

/** Encrypt the secrets map + API key as one JSON ciphertext in the Json column. */
function writeStored(credentials: AdapterCredentials, key: Buffer): { __enc: string } | undefined {
  if (!credentials.secrets && !credentials.apiKey) return undefined;
  const payload: StoredPayload = { s: credentials.secrets, k: credentials.apiKey };
  return { __enc: encryptField(JSON.stringify(payload), key)! };
}
