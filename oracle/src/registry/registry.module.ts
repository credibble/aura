import { Module } from "@nestjs/common";
import { HandleRegistryService } from "./handle-registry.service";
import { SourceRegistryService } from "./source-registry.service";
import { IndexerHandleSync } from "./indexer-handle-sync.service";
import { HANDLE_REGISTRY, SOURCE_REGISTRY } from "../core/ports/tokens";
import { AdaptersModule } from "../adapters/adapters.module";

@Module({
  imports: [AdaptersModule],
  providers: [
    IndexerHandleSync,
    { provide: HANDLE_REGISTRY, useClass: HandleRegistryService },
    { provide: SOURCE_REGISTRY, useClass: SourceRegistryService },
  ],
  exports: [HANDLE_REGISTRY, SOURCE_REGISTRY, IndexerHandleSync],
})
export class RegistryModule {}