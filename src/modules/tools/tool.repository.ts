import { db as prisma, type DbClient } from "@/lib/db";

import { ToolState, type Prisma } from "../../../prisma/generated/client";

type NewInvocation = {
  runId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  kind: string;
  ordinal: number;
  inputSanitized: Prisma.InputJsonValue;
};

const finished = (startedAt: Date) => ({
  completedAt: new Date(),
  durationMs: Date.now() - startedAt.getTime(),
});

export const toolRepository = {
  /** The row for one tool call; a retried step with the same toolCallId gets the existing row back. */
  start: (data: NewInvocation, db: DbClient = prisma) =>
    db.toolInvocation.upsert({
      where: { runId_toolCallId: { runId: data.runId, toolCallId: data.toolCallId } },
      create: { ...data, state: ToolState.running },
      update: {},
    }),

  get: (id: string, db: DbClient = prisma) =>
    db.toolInvocation.findUniqueOrThrow({ where: { id } }),

  /** Saved straight after the Magica run is created, so a retry never starts a second one. */
  setMagicaRunId: (id: string, magicaRunId: string, db: DbClient = prisma) =>
    db.toolInvocation.update({ where: { id }, data: { magicaRunId } }),

  /** Stop: the call is cancelled, and anything Magica sends later is ignored. */
  cancel: (row: { id: string; startedAt: Date }, db: DbClient = prisma) =>
    db.toolInvocation.update({
      where: { id: row.id },
      data: { state: ToolState.cancelled, ...finished(row.startedAt) },
    }),

  succeed: (
    row: { id: string; startedAt: Date },
    output: Prisma.InputJsonValue,
    db: DbClient = prisma,
  ) =>
    db.toolInvocation.update({
      where: { id: row.id },
      data: { state: ToolState.succeeded, output, ...finished(row.startedAt) },
    }),

  fail: (
    row: { id: string; startedAt: Date },
    error: { code: string; message: string },
    db: DbClient = prisma,
  ) =>
    db.toolInvocation.update({
      where: { id: row.id },
      data: {
        state: ToolState.failed,
        errorCode: error.code,
        errorMessage: error.message,
        ...finished(row.startedAt),
      },
    }),

  /**
   * Records a skill load for the run; true only for the first load. Parallel tool calls can race,
   * so the unique (runId, skillName) decides: a second insert is skipped, not an error.
   */
  async loadSkillOnce(
    runId: string,
    skill: { name: string; hash: string; version: string },
    db: DbClient = prisma,
  ) {
    const { count } = await db.runSkill.createMany({
      data: [{ runId, skillName: skill.name, contentHash: skill.hash, version: skill.version }],
      skipDuplicates: true,
    });
    return count === 1;
  },
};
