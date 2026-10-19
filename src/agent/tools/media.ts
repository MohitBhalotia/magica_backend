import { z } from "zod";

import type { MediaAsset, MediaToolOutput } from "@mohitbhalotia/magica-contracts";

import type { ToolContext } from "@/agent/tools/define";
import { runMagicaModel } from "@/agent/tools/magicaRun";
import { AppError } from "@/lib/errors";
import { toolRepository } from "@/modules/tools/tool.repository";
import type { MagicaJob } from "@/providers/magica";

/** Magica only fetches public HTTPS media. */
export const HttpsUrlSchema = z.url({ protocol: /^https$/ });

type MediaRun<S extends z.ZodType> = {
  job: MagicaJob;
  /** The model's `output` when COMPLETED; each model has its own shape. */
  output: S;
  toAssets: (output: z.infer<S>) => MediaAsset[];
  /** Saved with the assets for the files modal. */
  prompt?: string;
};

/** Runs a media model, saves what it made as Asset rows, and returns it for the model and the UI. */
export async function runMediaTool<S extends z.ZodType>(
  ctx: ToolContext,
  { job, output, toAssets, prompt }: MediaRun<S>,
): Promise<MediaToolOutput> {
  const run = await runMagicaModel(job, ctx);
  const parsed = output.safeParse(run.output);
  if (!parsed.success) {
    throw new AppError("GENERATION_FAILED", "Magica's result couldn't be read.", {
      magicaRunId: run.id,
    });
  }
  const assets = toAssets(parsed.data);

  await toolRepository.saveAssets(
    ctx.invocationId,
    assets.map((asset) => ({
      ...asset,
      userId: ctx.userId,
      chatId: ctx.chatId,
      messageId: ctx.messageId,
      prompt,
      model: job.subModelId ?? job.nodeType,
    })),
  );
  return { assets, creditUsed: run.creditUsed ?? 0 };
}
