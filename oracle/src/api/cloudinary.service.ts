import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { v2 as cloudinary, type UploadApiResponse } from "cloudinary";

export interface UploadedMedia {
  src: string;
  kind: "image" | "video";
  publicId: string;
}

/**
 * Cloudinary media uploads for user posts. Uploads are compressed server-side
 * (`quality: auto`, `fetch_format: auto`). Disabled (returns []) until the
 * CLOUDINARY_* env vars are configured.
 */
@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly enabled: boolean;
  private readonly folder: string;

  constructor(config: ConfigService) {
    const name = config.get<string>("CLOUDINARY_CLOUD_NAME");
    const key = config.get<string>("CLOUDINARY_API_KEY");
    const secret = config.get<string>("CLOUDINARY_API_SECRET");
    this.folder = config.get<string>("CLOUDINARY_FOLDER") ?? "aura/posts";
    if (name && key && secret) {
      cloudinary.config({ cloud_name: name, api_key: key, api_secret: secret });
      this.enabled = true;
    } else {
      this.enabled = false;
      this.logger.warn("Cloudinary not configured — post media uploads disabled.");
    }
  }

  get available(): boolean {
    return this.enabled;
  }

  /** Upload a buffer to Cloudinary with auto compression. `folder` overrides
   *  the default folder (posts) — e.g. "aura/handles" for handle photos. */
  upload(buffer: Buffer, mime: string, alt: string, folder?: string): Promise<UploadedMedia | null> {
    if (!this.enabled) return Promise.resolve(null);
    const kind = mime.startsWith("video") ? "video" : "image";
    return new Promise((resolve) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: folder ?? this.folder,
          resource_type: kind === "video" ? "video" : "image",
          quality: "auto",
          fetch_format: "auto",
          eager: kind === "image" ? [{ width: 1600, quality: "auto", fetch_format: "auto" }] : undefined,
        },
        (error, result: UploadApiResponse | undefined) => {
          if (error || !result) {
            this.logger.error(`Cloudinary upload failed: ${error?.message ?? "no result"}`);
            resolve(null);
            return;
          }
          resolve({ src: result.secure_url, kind, publicId: result.public_id });
          void alt;
        },
      );
      stream.end(buffer);
    });
  }

  /** Upload many files; returns the media[] for a post (nulls dropped). */
  async uploadMany(files: { buffer: Buffer; mimetype: string }[], alt: string): Promise<UploadedMedia[]> {
    const results = await Promise.all(files.map((f) => this.upload(f.buffer, f.mimetype, alt)));
    return results.filter((r): r is UploadedMedia => r !== null);
  }
}