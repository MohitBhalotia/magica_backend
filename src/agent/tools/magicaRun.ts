import { wait } from "@trigger.dev/sdk";

import type { ToolContext } from "@/agent/tools/define";
import { AppError } from "@/lib/errors";
import { toolRepository } from "@/modules/tools/tool.repository";
import { magica, type MagicaJob, type MagicaRun } from "@/providers/magica";

/** Most runs finish in under a minute; past this we stop trusting the webhook and poll. */
const WEBHOOK_WAIT = "3m";
const POLL_SECONDS = 30;
/** Hard cap from the call's start, so a stuck run can't hold the turn forever (DEC-054). */
const MAX_WAIT_MS = 15 * 60_000;

/**
 * Runs a Magica model for a media tool call and returns the completed run (DEC-054):
 * 1. create the Magica run at most once: its id is saved before any wait, so a retried call
 *    picks it up instead of starting (and paying for) a second run;
 * 2. wait on a Trigger.dev token whose URL is Magica's webhook, which costs no compute;
 * 3. read the result with our key: the webhook only wakes us, so a forged call can't inject output;
 * 4. if the webhook doesn't come, poll until the cap.
 */
export async function runMagicaModel(job: MagicaJob, ctx: ToolContext): Promise<MagicaRun> {
  const call = await toolRepository.get(ctx.invocationId);
  // The same key on a retry gives back the same token, which Magica may already have completed.
  const token = await wait.createToken({
    idempotencyKey: `magica:${call.id}`,
    timeout: WEBHOOK_WAIT,
  });

  let runId = call.magicaRunId;
  if (!runId) {
    ({ runId } = await magica.createRun(job, token.url, ctx.signal));
    await toolRepository.setMagicaRunId(call.id, runId);
  }

  // Woken by the webhook, or by the timeout: either way the run's status decides.
  await untilStopped(wait.forToken(token), ctx.signal);

  const deadline = call.startedAt.getTime() + MAX_WAIT_MS;
  for (;;) {
    const run = await magica.getRun(runId, ctx.signal);
    if (run.status === "COMPLETED") return run;
    if (run.status === "FAILED" || run.status === "CANCELED") {
      const message = run.userMessage ?? "Magica couldn't finish this. Try again.";
      throw new AppError("GENERATION_FAILED", message, { magicaRunId: runId });
    }
    if (Date.now() >= deadline) {
      throw new AppError("GENERATION_TIMEOUT", "Magica is taking too long. Try again later.", {
        magicaRunId: runId,
      });
    }
    await untilStopped(wait.for({ seconds: POLL_SECONDS }), ctx.signal);
  }
}

/** Stop shouldn't wait for Magica: the wait is dropped as soon as the turn is aborted. */
export function untilStopped<T>(waiting: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.resolve(waiting);
  signal.throwIfAborted();
  const stopped = new Promise<never>((_, reject) => {
    signal.addEventListener(
      "abort",
      () => {
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });
  return Promise.race([waiting, stopped]);
}
