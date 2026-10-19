import { WAITPOINTS } from "@mohitbhalotia/magica-contracts";

import { defineTool } from "@/agent/tools/define";
import { waitForUser } from "@/agent/tools/waitForUser";

/** J7 "ambiguous": the user picks one of a few answers; the run waits meanwhile (DEC-055). */
export const askUserTool = defineTool({
  name: "ask_user",
  description:
    "Ask the user to pick one of 2–6 short options when the request is genuinely ambiguous and " +
    "the choice changes what you do (e.g. which style, size or clip order). Don't ask about " +
    "things you can decide sensibly yourself. Returns the option they chose.",
  input: WAITPOINTS.options.request,
  output: WAITPOINTS.options.response,
  execute: (input, ctx) => waitForUser(ctx, "options", input),
});
