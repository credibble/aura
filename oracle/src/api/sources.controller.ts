import { Controller, Get, Inject } from "@nestjs/common";
import type { Source } from "../core/domain/source";
import type { SourceRegistry } from "../core/ports/source-registry";
import { SOURCE_REGISTRY } from "../core/ports/tokens";

@Controller("v1/sources")
export class SourcesController {
  constructor(@Inject(SOURCE_REGISTRY) private readonly sources: SourceRegistry) {}

  @Get()
  async all(): Promise<Source[]> {
    return this.sources.all();
  }
}