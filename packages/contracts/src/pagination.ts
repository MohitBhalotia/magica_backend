import { z } from "zod";

export const MAX_PAGE_LIMIT = 50;

/** Keyset pagination query; the cursor is opaque to clients (the server encodes its sort key). */
export const PageQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(20),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;

/** Wraps a list item schema in the standard page response. */
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });
