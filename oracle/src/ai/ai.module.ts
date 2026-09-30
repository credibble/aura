import { Module } from "@nestjs/common";
import { AI_MODEL, AI_FETCH } from "../core/ports/tokens";
import { KimiAiModel } from "../adapters/ai/llm/kimi-ai.model";
import { KimiWebSearchService } from "../jobs/ai/kimi-web-search.service";

@Module({
  providers: [
    { provide: AI_FETCH, useValue: globalThis.fetch.bind(globalThis) },
    { provide: AI_MODEL, useClass: KimiAiModel },
    KimiWebSearchService,
  ],
  exports: [AI_MODEL, AI_FETCH, KimiWebSearchService],
})
export class AiModule {}