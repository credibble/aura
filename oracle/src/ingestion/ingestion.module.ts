import { Module } from "@nestjs/common";
import { SourceFetcher } from "./source-fetcher.service";
import { RegistryModule } from "../registry/registry.module";
import { AdaptersModule } from "../adapters/adapters.module";

@Module({
  imports: [RegistryModule, AdaptersModule],
  providers: [SourceFetcher],
  exports: [SourceFetcher],
})
export class IngestionModule {}