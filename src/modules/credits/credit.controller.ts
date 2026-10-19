import { NextResponse } from "next/server";

import {
  PageQuerySchema,
  ToolNameSchema,
  UsageSummarySchema,
  type CreditBalance,
  type UsageExecutionPage,
  type UsageSummary,
} from "@mohitbhalotia/magica-contracts";

import { withHandler } from "@/lib/withHandler";
import { creditService } from "@/modules/credits/credit.service";

const query = (req: Request) => Object.fromEntries(new URL(req.url).searchParams);

/** The credits pill. The first call also makes the user's seed grant. */
export const getBalance = withHandler(async (_req, { userId }) => {
  const balance = await creditService.balance(userId);
  return NextResponse.json<CreditBalance>({ balanceMicro: Number(balance) });
});

/** The /usage page: spending per tool. Tool names come from SQL, so they're checked here. */
export const getUsage = withHandler(async (_req, { userId }) =>
  NextResponse.json<UsageSummary>(UsageSummarySchema.parse(await creditService.usage(userId))),
);

/** The /usage Detailed View: one tool's charges, newest first. */
export const listToolUsage = withHandler<{ tool: string }>(async (req, { userId, params }) => {
  const tool = ToolNameSchema.parse((await params).tool);
  const { limit, cursor } = PageQuerySchema.parse(query(req));
  const page = await creditService.toolCharges(userId, tool, limit, cursor);
  return NextResponse.json<UsageExecutionPage>({
    ...page,
    items: page.items.map((entry) => ({
      id: entry.id,
      debitedMicro: -Number(entry.amountMicro),
      createdAt: entry.createdAt.toISOString(),
    })),
  });
});
