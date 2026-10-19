import { z } from "zod";

import type { MediaAsset, MediaToolOutput } from "@mohitbhalotia/magica-contracts";

import type { ToolContext } from "@/agent/tools/define";
import { runMagicaModel } from "@/agent/tools/magicaRun";
import { waitForUser } from "@/agent/tools/waitForUser";
import { AppError } from "@/lib/errors";
import { creditService } from "@/modules/credits/credit.service";
import { toolRepository } from "@/modules/tools/tool.repository";
import { waitpointRepository } from "@/modules/waitpoints/waitpoint.repository";
import { magica, type MagicaJob } from "@/providers/magica";

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

/** Above this a run needs the user's approval first (DEC-055). */
const APPROVAL_THRESHOLD_MICRO = 50_000n;
/** Held for a run whose cost Magica couldn't estimate, once the user approved it. */
const UNKNOWN_COST_MICRO = APPROVAL_THRESHOLD_MICRO;

/**
 * Runs a media model for the user's credits (PRD §6.6):
 * 1. estimate the cost; above the threshold, or unknown, ask the user to approve it first;
 * 2. reserve the cost (402 INSUFFICIENT_CREDITS if the balance can't cover it);
 * 3. run the model and save what it made;
 * 4. charge what Magica actually used and release the reserve, or on any failure (or Stop)
 *    release the reserve only: unfinished work is never charged.
 * Every entry has an idempotency key per call, so a retried call never charges twice.
 */
export async function runMediaTool<S extends z.ZodType>(
  ctx: ToolContext,
  spec: MediaRun<S>,
): Promise<MediaToolOutput> {
  const call = { userId: ctx.userId, runId: ctx.runId, invocationId: ctx.invocationId };
  const cost = await estimate(spec.job, ctx.signal);
  if (cost === null || cost > APPROVAL_THRESHOLD_MICRO) {
    // A model that retries after a decline doesn't get to ask the user again in this turn.
    const approved =
      !(await waitpointRepository.hasDeclined(ctx.runId)) &&
      (
        await waitForUser(ctx, "credit_approval", {
          tool: ctx.toolName,
          estimateMicro: cost === null ? null : Number(cost),
          balanceMicro: Number(await creditService.currentBalance(ctx.userId)),
        })
      ).approved;
    // Worded for the model too: "You declined" made it think the call had failed and retry.
    if (!approved)
      throw new AppError(
        "APPROVAL_DECLINED",
        "The user declined this generation, so it didn't run.",
      );
  }
  await creditService.reserveTool(call, cost ?? UNKNOWN_COST_MICRO);
  try {
    const result = await generate(ctx, spec);
    await creditService.chargeTool(call, BigInt(result.creditUsed));
    return result;
  } catch (err) {
    await creditService.releaseTool(call);
    throw err;
  }
}

/** Magica's estimate in microcredits, or null when it can't give one (seen for some merges). */
async function estimate(job: MagicaJob, signal?: AbortSignal) {
  try {
    return BigInt(Math.ceil(await magica.estimate(job, signal)));
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
}

/** Runs the model, saves what it made as Asset rows, and returns it for the model and the UI. */
async function generate<S extends z.ZodType>(
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
