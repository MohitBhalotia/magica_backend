import { z } from "zod";

import { CoreEnvSchema } from "@/lib/coreEnv";

/** Trigger.dev worker env: the only place the OpenRouter key is read. */
export const WorkerEnvSchema = CoreEnvSchema.extend({
  // Brief: OpenRouter Free only, no paid fallback. Any other value fails boot.
  OPENROUTER_MODEL: z.literal("openrouter/free").default("openrouter/free"),
  OPENROUTER_API_KEY: z.string().min(1),
});

export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

// Parsed on first use, not at import: task files are also loaded when Trigger.dev indexes them.
let parsed: WorkerEnv | undefined;
export const workerEnv = (): WorkerEnv => (parsed ??= WorkerEnvSchema.parse(process.env));
