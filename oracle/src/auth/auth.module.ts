import { Module } from "@nestjs/common";
import { SupabaseAuthService } from "./supabase-auth.service";
import { ShopifyAuthService } from "./shopify-auth.service";
import { WalletAuthService } from "./wallet-auth.service";
import { WalletAuthGuard } from "./wallet-auth.guard";
import { WalletAuthController } from "./wallet-auth.controller";

/** OAuth facilitation — Supabase runs the social OAuth dance (Spotify, X,
 *  GitHub, ...) and Shopify runs its own merchant OAuth; provider tokens land
 *  in the ConnectionStore. WalletAuthService mints HS256 JWTs from EIP-191
 *  signMessage logins for mutation endpoints. */
@Module({
  controllers: [WalletAuthController],
  providers: [SupabaseAuthService, ShopifyAuthService, WalletAuthService, WalletAuthGuard],
  exports: [SupabaseAuthService, ShopifyAuthService, WalletAuthService, WalletAuthGuard],
})
export class AuthModule {}