import { Module } from "@nestjs/common";
import { HandleRegistryService } from "./handle-registry.service";
import { SourceRegistryService } from "./source-registry.service";
import { SubgraphHandleSync } from "./subgraph-handle-sync.service";
import { HANDLE_REGISTRY, SOURCE_REGISTRY } from "../core/ports/tokens";
import { AdaptersModule } from "../adapters/adapters.module";

@Module({
  imports: [AdaptersModule],
  providers: [
    SubgraphHandleSync,
    { provide: HANDLE_REGISTRY, useClass: HandleRegistryService },
    { provide: SOURCE_REGISTRY, useClass: SourceRegistryService },
  ],
  exports: [HANDLE_REGISTRY, SOURCE_REGISTRY, SubgraphHandleSync],
})
export class RegistryModule {}