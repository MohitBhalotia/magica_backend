import { z } from "zod";

import { pageSchema } from "./pagination.ts";
import { ToolNameSchema } from "./tools.ts";

/** `GET /credits`: the user's balance in microcredits, shown as `0.98M` (DESIGN §6). */
export const CreditBalanceSchema = z.object({ balanceMicro: z.number() });
export type CreditBalance = z.infer<typeof CreditBalanceSchema>;

/** One tool's spending on the /usage page (Overview table, DESIGN §4.9). */
export const ToolUsageSchema = z.object({
  tool: ToolNameSchema,
  debitedMicro: z.number(),
  executions: z.number(),
  latestAt: z.iso.datetime(),
});
export type ToolUsage = z.infer<typeof ToolUsageSchema>;

/** `GET /credits/usage`: what the user's tools were charged since their first credits. */
export const UsageSummarySchema = z.object({
  debitedMicro: z.number(),
  executions: z.number(),
  periodStart: z.iso.datetime(),
  periodEnd: z.iso.datetime(),
  tools: z.array(ToolUsageSchema),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;

/** `GET /credits/usage/{tool}`: that tool's charges, newest first (Detailed View). */
export const UsageExecutionSchema = z.object({
  id: z.string(),
  debitedMicro: z.number(),
  createdAt: z.iso.datetime(),
});
export const UsageExecutionPageSchema = pageSchema(UsageExecutionSchema);
export type UsageExecutionPage = z.infer<typeof UsageExecutionPageSchema>;
