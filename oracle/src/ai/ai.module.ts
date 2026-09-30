import { Module } from "@nestjs/common";
import { AI_MODEL, AI_FETCH } from "../core/ports/tokens";
import { KimiAiModel } from "../adapters/ai/llm/kimi-ai.model";
import { KimiWebSearchService } from "../jobs/ai/kimi-web-search.service";

@Module({
  providers: [
    {
      provide: AI_FETCH,
      // Bounded: a reasoning-model call can take 40s+ (thinking happens before
      // the answer), so the limit is generous — but a hung request must not pin a
      // job forever.
      useValue: ((input: RequestInfo | URL, init?: RequestInit) =>
        globalThis.fetch(input, {
          ...init,
          signal: init?.signal ?? AbortSignal.timeout(180_000),
        })) as typeof fetch,
    },
    { provide: AI_MODEL, useClass: KimiAiModel },
    KimiWebSearchService,
  ],
  exports: [AI_MODEL, AI_FETCH, KimiWebSearchService],
})
export class AiModule {}