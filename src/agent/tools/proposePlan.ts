import { WAITPOINTS } from "@mohitbhalotia/magica-contracts";

import { defineTool } from "@/agent/tools/define";
import { waitForUser } from "@/agent/tools/waitForUser";

/** Plan mode is the agent's call (DEC-055): a plan before billable work, approved by the user. */
export const proposePlanTool = defineTool({
  name: "propose_plan",
  description:
    "Before running two or more billable media steps (generate, crop, merge), propose your plan " +
    "as a short Markdown list and wait for the user's approval. If they reject it, follow their " +
    "feedback instead. Not needed for a single step.",
  input: WAITPOINTS.plan_approval.request,
  output: WAITPOINTS.plan_approval.response,
  execute: (input, ctx) => waitForUser(ctx, "plan_approval", input),
});
