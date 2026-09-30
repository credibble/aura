import { Module } from "@nestjs/common";
import { AI_MODEL, AI_FETCH } from "../core/ports/tokens";
import { KimiAiModel } from "../adapters/ai/llm/kimi-ai.model";
import { KimiWebSearchService } from "../jobs/ai/kimi-web-search.service";

@Module({
  providers: [
    {
      provide: AI_FETCH,
      // Bounded: kimi-k2.* is a reasoning model whose thinking tokens are spent
      // BEFORE any answer, so a large aura prompt with a full token budget can
      // run for minutes. 180s was aborting real calls mid-thinking (the tick then
      // fell back to its mechanical memo); 300s leaves headroom while still
      // ensuring a genuinely hung request can't pin a job forever.
      useValue: ((input: RequestInfo | URL, init?: RequestInit) =>
        globalThis.fetch(input, {
          ...init,
          signal: init?.signal ?? AbortSignal.timeout(300_000),
        })) as typeof fetch,
    },
    { provide: AI_MODEL, useClass: KimiAiModel },
    KimiWebSearchService,
  ],
  exports: [AI_MODEL, AI_FETCH, KimiWebSearchService],
})
export class AiModule {}