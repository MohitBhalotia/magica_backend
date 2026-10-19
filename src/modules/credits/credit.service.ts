import { db, type DbClient } from "@/lib/db";
import { creditRepository } from "@/modules/credits/credit.repository";
import { userService } from "@/modules/users/user.service";

import { LedgerType } from "../../../prisma/generated/client";

/** Amounts in microcredits (DEC-055); shown as millions ("1M"). */
export const SEED_GRANT_MICRO = 1_000_000n;
export const ADMISSION_MICRO = 10_000n;

/** The ids a tool call's credit entries hang off. */
type Call = { userId: string; runId: string; invocationId: string };

const toolReserveKey = (call: Call) => `tool:${call.invocationId}`;

/** The user's one-time seed grant. Safe to repeat: the grant's key makes it once. */
const grantSeed = (userId: string, tx: DbClient) =>
  creditRepository.post(
    {
      userId,
      type: LedgerType.grant,
      amountMicro: SEED_GRANT_MICRO,
      idempotencyKey: `grant:seed:${userId}`,
      note: "Welcome credits",
    },
    tx,
  );

/** Gives back what a reserve held, once. Nothing happens if the reserve was never made. */
async function release(reserveKey: string, tx: DbClient) {
  const reserve = await creditRepository.findByKey(reserveKey, tx);
  if (!reserve?.userId) return;
  await creditRepository.post(
    {
      userId: reserve.userId,
      type: LedgerType.release,
      amountMicro: -reserve.amountMicro,
      idempotencyKey: `${reserveKey}:release`,
      runId: reserve.runId ?? undefined,
      invocationId: reserve.invocationId ?? undefined,
    },
    tx,
  );
}

export const creditService = {
  balance: (userId: string) =>
    db.$transaction(async (tx) => {
      // The pill can load before the user's first send: make their row first (the ledger FK).
      await userService.ensure(userId, tx);
      await grantSeed(userId, tx);
      return creditRepository.balance(userId, tx);
    }),

  /** A plain read for the worker (the grant already happened when the turn was admitted). */
  currentBalance: (userId: string) => creditRepository.balance(userId),

  /** The /usage page: what each tool was charged, from the user's first credits until now. */
  async usage(userId: string) {
    const [tools, periodStart] = await Promise.all([
      creditRepository.usageByTool(userId),
      creditRepository.firstEntryAt(userId),
    ]);
    const now = new Date();
    return {
      debitedMicro: tools.reduce((sum, t) => sum + Number(t.debited), 0),
      executions: tools.reduce((sum, t) => sum + Number(t.executions), 0),
      periodStart: (periodStart ?? now).toISOString(),
      periodEnd: now.toISOString(),
      tools: tools.map((t) => ({
        tool: t.tool,
        debitedMicro: Number(t.debited),
        executions: Number(t.executions),
        latestAt: t.latest.toISOString(),
      })),
    };
  },

  toolCharges: (userId: string, tool: string, limit: number, cursor?: string) =>
    creditRepository.toolCharges(userId, tool, limit, cursor),

  /** Inside the send transaction: hold the admission reserve, or refuse the send with a 402. */
  async admit(run: { id: string; userId: string }, tx: DbClient) {
    // A send always has the user's row already (the chat needs it); users from before M4 get
    // their grant here on their next send.
    await grantSeed(run.userId, tx);
    await creditRepository.post(
      {
        userId: run.userId,
        type: LedgerType.reserve,
        amountMicro: -ADMISSION_MICRO,
        idempotencyKey: `admission:${run.id}`,
        runId: run.id,
      },
      tx,
    );
  },

  /** When the turn ends, in its settle transaction. */
  endAdmission: (runId: string, tx: DbClient) => release(`admission:${runId}`, tx),

  /** Before a Magica run: hold its estimated cost (402 if the balance can't cover it). */
  reserveTool: (call: Call, estimateMicro: bigint) =>
    db.$transaction((tx) =>
      creditRepository.post(
        {
          userId: call.userId,
          type: LedgerType.reserve,
          amountMicro: -estimateMicro,
          idempotencyKey: toolReserveKey(call),
          runId: call.runId,
          invocationId: call.invocationId,
        },
        tx,
      ),
    ),

  /** After a Magica run: release the reserve and charge what Magica actually used, once. */
  chargeTool: (call: Call, usedMicro: bigint) =>
    db.$transaction(async (tx) => {
      await release(toolReserveKey(call), tx);
      if (usedMicro > 0n)
        await creditRepository.post(
          {
            userId: call.userId,
            type: LedgerType.charge,
            amountMicro: -usedMicro,
            idempotencyKey: `charge:${call.invocationId}`,
            runId: call.runId,
            invocationId: call.invocationId,
          },
          tx,
        );
    }),

  /** A failed or stopped Magica run costs nothing: just release its reserve. */
  releaseTool: (call: Call) => db.$transaction((tx) => release(toolReserveKey(call), tx)),

  chargedForRun: (runId: string) => creditRepository.chargedForRun(runId),
};
