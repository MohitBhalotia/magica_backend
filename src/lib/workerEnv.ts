import { z } from "zod";

import { CoreEnvSchema } from "@/lib/coreEnv";

/** Trigger.dev worker env: the only place the OpenRouter and Magica keys are read. */
export const WorkerEnvSchema = CoreEnvSchema.extend({
  // Brief: OpenRouter Free only, no paid fallback. Any other value fails boot.
  OPENROUTER_MODEL: z.literal("openrouter/free").default("openrouter/free"),
  // trim() also drops a BOM (U+FEFF): a secret piped through PowerShell once broke every prod call.
  OPENROUTER_API_KEY: z.string().trim().min(1),
  MAGICA_API_KEY: z.string().trim().min(1),
  MAGICA_BASE_URL: z.url().default("https://inference.magica.com/v1"),
});

export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

// Parsed on first use, not at import: task files are also loaded when Trigger.dev indexes them.
let parsed: WorkerEnv | undefined;
export const workerEnv = (): WorkerEnv => (parsed ??= WorkerEnvSchema.parse(process.env));
