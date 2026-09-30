import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { WalletAuthService } from "./wallet-auth.service";

/**
 * Guards mutation endpoints: requires `Authorization: Bearer <jwt>` minted by
 * WalletAuthService (EIP-191 signMessage login). Attaches `request.user.userId`
 * (the wallet address) for the handler.
 */
@Injectable()
export class WalletAuthGuard implements CanActivate {
  constructor(private readonly auth: WalletAuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: { userId: string } }>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new UnauthorizedException("Missing bearer token");
    const token = header.slice("Bearer ".length).trim();
    const { userId } = this.auth.verify(token);
    req.user = { userId };
    return true;
  }
}