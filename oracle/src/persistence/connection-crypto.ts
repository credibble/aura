import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** Ciphertext prefix so stored values are recognizable (and migratable). */
const PREFIX = "enc:v1:";

/** Derive the 32-byte AES-256 key from the configured passphrase. */
export function deriveKey(passphrase: string): Buffer {
  return createHash("sha256").update(passphrase).digest();
}

/** AES-256-GCM encrypt a credential for at-rest storage (null-safe). */
export function encryptField(plain: string | null | undefined, key: Buffer): string | null {
  if (plain == null) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag().toString("base64");
  return `${PREFIX}${iv.toString("base64")}:${tag}:${ct.toString("base64")}`;
}

/** Decrypt an at-rest credential; plaintext rows (written pre-encryption) pass through. */
export function decryptField(stored: string | null | undefined, key: Buffer): string | undefined {
  if (stored == null) return undefined;
  if (!stored.startsWith(PREFIX)) return stored;
  const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split(":");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64 ?? "", "base64"));
  decipher.setAuthTag(Buffer.from(tagB64 ?? "", "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64 ?? "", "base64")), decipher.final()]).toString("utf8");
}
