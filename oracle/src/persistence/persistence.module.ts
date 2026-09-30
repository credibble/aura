import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { PrismaConnectionStore } from "./prisma-connection-store.service";
import { CONNECTION_STORE } from "../core/ports/tokens";

@Global()
@Module({
  providers: [
    PrismaService,
    { provide: CONNECTION_STORE, useClass: PrismaConnectionStore },
  ],
  exports: [PrismaService, CONNECTION_STORE],
})
export class PersistenceModule {}