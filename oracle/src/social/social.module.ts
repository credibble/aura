import { Module, forwardRef } from "@nestjs/common";
import { SocialService } from "./social.service";
import { SocialController } from "./social.controller";
import { AuthModule } from "../auth/auth.module";
import { OrchestrationModule } from "../orchestration/orchestration.module";
import { RegistryModule } from "../registry/registry.module";
import { CloudinaryService } from "../api/cloudinary.service";
import { JobsModule } from "../jobs/jobs.module";

/** Social layer — likes, following, subscribing, notifications, reposting,
 *  user posts (Cloudinary media). Mutations are guarded by wallet JWT.
 *  JobsModule is imported with forwardRef (JobsModule imports SocialModule for
 *  feed notifications). Handle profile metadata is written by the handles API
 *  (`PATCH /v1/handles/:id`), not here. */
@Module({
  imports: [
    AuthModule,
    OrchestrationModule,
    RegistryModule,
    forwardRef(() => JobsModule),
  ],
  providers: [SocialService, CloudinaryService],
  controllers: [SocialController],
  exports: [SocialService, CloudinaryService],
})
export class SocialModule {}