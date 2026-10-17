import { z } from "zod";

/** Brief: OpenRouter Free only. Any other model id fails parsing (→ UNSUPPORTED_MODEL). */
export const ModelIdSchema = z.literal("openrouter/free");
export type ModelId = z.infer<typeof ModelIdSchema>;
