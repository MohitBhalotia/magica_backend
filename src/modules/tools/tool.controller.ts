import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  RUNNABLE_TOOLS,
  ToolRunRequestSchema,
  type SendResponse,
} from "@mohitbhalotia/magica-contracts";

import { AGENT_TOOLS } from "@/agent/tools";
import { AppError } from "@/lib/errors";
import { enforceRateLimit } from "@/lib/rateLimiter";
import { withHandler } from "@/lib/withHandler";
import { chatService } from "@/modules/chats/chat.service";

/**
 * `POST /tools/{tool}/run` (PRD §6.8): one Magica tool, run directly. It's an agent run whose
 * "model" calls just this tool with this input (see providers/directTool), so credits, approvals,
 * the saved step and asset, Stop, retry and the sweeper all work as in chat. Magica takes seconds
 * to minutes, so the answer is 202 and the run, to poll or to follow by webhook.
 */
export const runTool = withHandler<{ tool: string }>(
  async (req, { userId, params, traceId, logger }) => {
    await enforceRateLimit("send", userId);
    const name = (await params).tool;
    const tool = AGENT_TOOLS.find(
      (t) => t.name === name && (RUNNABLE_TOOLS as readonly string[]).includes(name),
    );
    if (!tool) throw new AppError("NOT_FOUND", `There is no tool called "${name}".`);

    const body = ToolRunRequestSchema.parse(await req.json());
    // The tool's own schema, before anything is saved: a bad input never starts (or bills) a run.
    const input = tool.input.safeParse(body.input);
    if (!input.success)
      throw new AppError("INVALID_TOOL_INPUT", "The input doesn't fit this tool.", {
        issues: input.error.issues.map(({ path, message }) => ({ path: path.join("."), message })),
      });

    const clientMessageId =
      z
        .uuid()
        .optional()
        .parse(req.headers.get("idempotency-key") ?? undefined) ?? randomUUID();
    // What the chat shows as the user's message.
    const text = `Run ${name}\n\n\`\`\`json\n${JSON.stringify(body.input, null, 2)}\n\`\`\``;
    const direct = { tool: name, input: body.input };
    const ctx = { traceId, logger };
    const sent = body.chat_id
      ? await chatService.send(body.chat_id, userId, clientMessageId, text, ctx, [], direct)
      : await chatService.create(userId, clientMessageId, text, ctx, [], direct);
    return NextResponse.json<SendResponse>(sent, { status: 202 });
  },
);
