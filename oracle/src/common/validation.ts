import { BadRequestException, type PipeTransform } from "@nestjs/common";
import { z } from "zod";

/**
 * Zod body validation at the edge. Nest's body types are erased at runtime, so
 * without this a malformed payload reaches the service (and Prisma) unchecked.
 *
 *   @Body(new ZodBodyPipe(CreateComment)) body: z.infer<typeof CreateComment>
 */
export class ZodBodyPipe<T> implements PipeTransform {
  constructor(private readonly schema: z.ZodType<T>) {}

  transform(value: unknown): T {
    const parsed = this.schema.safeParse(value);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues
          .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
          .join("; "),
      );
    }
    return parsed.data;
  }
}

const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x address")
  .transform((v) => v.toLowerCase());
/** A comment's reaction GIF: a bundled /gifs path or an https URL. */
const media = z
  .string()
  .max(300)
  .regex(/^(\/gifs\/[a-z0-9_.-]+|https:\/\/)/i, "must be a /gifs path or https URL");

export const Schemas = {
  /** POST /social/posts/:id/comments */
  addComment: z
    .object({
      user: address,
      handle: z.string().min(1).max(80),
      text: z.string().max(2000).optional().default(""),
      media: media.optional(),
    })
    .refine((v) => v.text.trim().length > 0 || !!v.media, {
      message: "comment needs text or a GIF",
      path: ["text"],
    }),

  /** POST /social/like · /social/repost · /social/bookmark (body: target) */
  engagement: z.object({
    userId: address,
    targetId: z.string().min(1).max(120),
    targetType: z.enum(["feed", "window", "handle"]).optional(),
  }),

  /** POST /social/follow · /social/subscribe */
  edge: z.object({
    userId: address,
    targetId: z.string().min(1).max(120),
  }),

  /** POST /v1/handles — handle creation. */
  createHandle: z.object({
    name: z
      .string()
      .trim()
      .regex(/^[a-z0-9]{3,20}$/, "name must be 3-20 chars of a-z and 0-9"),
    symbol: z.string().trim().regex(/^[A-Za-z0-9]{1,8}$/, "symbol must be 1-8 chars"),
    categories: z.array(z.coerce.number().int().min(0).max(999_999_999)).min(1).max(4),
    windowMinutes: z.coerce.number().int(),
    metadata: z.string().max(500).optional(),
  }),

  /** PATCH /v1/handles/:id — profile update (multipart, same fields). */
  updateHandle: z.object({
    name: z.string().trim().min(1).max(40).optional(),
    symbol: z.string().trim().regex(/^[A-Za-z0-9]{1,8}$/).optional(),
  }),
};

export type AddCommentInput = z.infer<typeof Schemas.addComment>;
export type EngagementInput = z.infer<typeof Schemas.engagement>;
export type EdgeInput = z.infer<typeof Schemas.edge>;
