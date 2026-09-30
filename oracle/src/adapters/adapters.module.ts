import { Module } from "@nestjs/common";
import { TIME_SERIES_STORE } from "../core/ports/tokens";
import { AdapterRegistry } from "./adapter-registry.service";
import { PrismaTimeSeriesStore } from "./prisma-time-series.service";

/**
 * Adapter framework: platform adapters (BaseSource subclasses) that extract
 * each source's own metrics into the shared time-series store.
 */
@Module({
  providers: [
    AdapterRegistry,
    { provide: TIME_SERIES_STORE, useClass: PrismaTimeSeriesStore },
  ],
  exports: [AdapterRegistry, TIME_SERIES_STORE],
})
export class AdaptersModule {}