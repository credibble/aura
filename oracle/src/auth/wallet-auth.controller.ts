import { Body, Controller, Post } from "@nestjs/common";
import { WalletAuthService } from "./wallet-auth.service";

/** Wallet auth: `POST /v1/auth/login` — verify an EIP-191 signMessage and mint
 *  a JWT for the address. Mutations on the API require it as a bearer token. */
@Controller("v1/auth")
export class WalletAuthController {
  constructor(private readonly auth: WalletAuthService) {}

  @Post("login")
  login(@Body() body: { message: string; signature: string; address: string }): { token: string; address: string } {
    return this.auth.login(body.message, body.signature, body.address);
  }
}