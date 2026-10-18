import { logger, task, wait } from "@trigger.dev/sdk";

/** M0 smoke task: proves the worker builds, runs and resumes after a durable wait. Replaced by agent-turn in M2. */
export const ping = task({
  id: "ping",
  run: async (payload: { message?: string }) => {
    logger.info("ping", { message: payload.message });
    await wait.for({ seconds: 1 });
    return { pong: payload.message ?? "pong", at: new Date().toISOString() };
  },
});
