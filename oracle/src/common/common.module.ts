import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { RateLimitGuard } from "./rate-limit.guard";

/** Cross-cutting HTTP concerns that apply to every controller. */
@Module({
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class CommonModule {}
