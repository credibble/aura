import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac, timingSafeEqual } from "node:crypto";
import { verifyMessage } from "ethers";

const HS256 = "HS256";

/** Minimal HS256 JWT (header.payload.signature) — no external deps. */
@Injectable()
export class WalletAuthService {
  private readonly secret: string;
  private readonly ttlSeconds: number;

  constructor(config: ConfigService) {
    this.secret = config.get<string>("AUTH_JWT_SECRET") ?? "dev-secret-change-me";
    this.ttlSeconds = config.get<number>("AUTH_JWT_TTL") ?? 24 * 60 * 60;
  }

  /** Verify an EIP-191 wallet signature and mint a JWT for the address. */
  login(message: string, signature: string, address: string): { token: string; address: string } {
    let recovered: string;
    try {
      recovered = verifyMessage(message, signature);
    } catch {
      throw new UnauthorizedException("Invalid signature");
    }
    if (recovered.toLowerCase() !== address.toLowerCase()) {
      throw new UnauthorizedException("Signature does not match address");
    }
    return { token: this.sign({ sub: address.toLowerCase() }), address: address.toLowerCase() };
  }

  /** Verify a JWT and return the authenticated userId (the wallet address). */
  verify(token: string): { userId: string } {
    const parts = token.split(".");
    if (parts.length !== 3) throw new UnauthorizedException("Malformed token");
    const [h, p, sig] = parts as [string, string, string];

    const expected = this.hmac(`${h}.${p}`);
    const sigBuf = Buffer.from(sig, "base64url");
    if (sigBuf.length !== expected.length || !timingSafeEqual(sigBuf, expected)) {
      throw new UnauthorizedException("Bad signature");
    }

    let payload: { sub?: string; exp?: number };
    try {
      payload = JSON.parse(Buffer.from(p, "base64url").toString("utf8")) as { sub?: string; exp?: number };
    } catch {
      throw new UnauthorizedException("Bad payload");
    }
    if (!payload.sub || (payload.exp ?? 0) < Math.floor(Date.now() / 1000)) {
      throw new UnauthorizedException("Token expired");
    }
    return { userId: payload.sub };
  }

  private sign(payload: { sub: string }): string {
    const header = Buffer.from(JSON.stringify({ alg: HS256, typ: "JWT" })).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + this.ttlSeconds }),
    ).toString("base64url");
    return `${header}.${body}.${this.hmac(`${header}.${body}`).toString("base64url")}`;
  }

  private hmac(data: string): Buffer {
    return createHmac("sha256", this.secret).update(data).digest();
  }
}