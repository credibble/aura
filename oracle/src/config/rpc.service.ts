import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * RPC resolution — prefers an explicit Alchemy RPC URL (the Alchemy bounty
 * path: real on-chain reads for the relay + frontend through Alchemy), then
 * RPC_URL, then a public Monad default. Exposes helpers to build Alchemy URLs
 * from just an API key.
 */
@Injectable()
export class RpcService {
  constructor(private readonly config: ConfigService) {}

  /** The active RPC URL for the oracle's on-chain reads. */
  get url(): string {
    const alchemy = this.config.get<string>("ALCHEMY_RPC_URL") ?? this.alchemyFromKey();
    return alchemy ?? this.config.get<string>("RPC_URL") ?? "https://rpc.testnet.monad.xyz";
  }

  /** Build `https://monad-testnet.g.alchemy.com/v2/{key}` from the API key. */
  alchemyFromKey(): string | null {
    const key = this.config.get<string>("ALCHEMY_API_KEY");
    return key ? `https://monad-testnet.g.alchemy.com/v2/${key}` : null;
  }
}