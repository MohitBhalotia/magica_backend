import { NextResponse } from "next/server";

import type { RunHandle, SendResponse } from "@mohitbhalotia/magica-contracts";

import { withHandler } from "@/lib/withHandler";
import { runService } from "@/modules/runs/run.service";

type RunParams = { runId: string };

/** Stop: idempotent; the reply keeps what was written so far. */
export const cancelRun = withHandler<RunParams>(
  async (_req, { userId, params, traceId, logger }) => {
    const run = await runService.cancel((await params).runId, userId, { traceId, logger });
    return NextResponse.json<RunHandle>(run);
  },
);

/** Retry the chat's latest failed or stopped reply with a new run. */
export const retryRun = withHandler<RunParams>(
  async (_req, { userId, params, traceId, logger }) => {
    const sent = await runService.retry((await params).runId, userId, { traceId, logger });
    return NextResponse.json<SendResponse>(sent, { status: 201 });
  },
);
