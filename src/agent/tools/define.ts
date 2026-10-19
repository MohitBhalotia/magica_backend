import { tool, zodSchema, type Tool, type ToolSet } from "ai";
import type { z } from "zod";

import { TOOLS, type ToolName } from "@mohitbhalotia/magica-contracts";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { toolRepository } from "@/modules/tools/tool.repository";

import type { Prisma } from "../../../prisma/generated/client";

/** Who the turn belongs to, and its abort signal. Every tool call in the turn gets these. */
export type TurnContext = {
  runId: string;
  chatId: string;
  userId: string;
  /** The assistant message the tool calls belong to. */
  messageId: string;
  signal?: AbortSignal;
};

/** What a tool's `execute` receives: the turn, plus the ids of this one call. */
export type ToolContext = TurnContext & { invocationId: string; toolCallId: string };

type ToolDefinition<I, O> = {
  name: ToolName;
  /** Tells the model when to use the tool and what it returns. */
  description: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  /** A copy of the input that is safe to store and show (no secrets, long prompts cut). */
  sanitize?: (input: I) => unknown;
  execute: (input: I, ctx: ToolContext) => Promise<O>;
};

/** A tool's turn: the context plus a counter that numbers its calls in order. */
type Turn = TurnContext & { calls: number };

export type RegisteredTool = {
  name: ToolName;
  forTurn: (turn: Turn) => Tool;
};

/**
 * Declares a tool (one file per tool, PRD §5.5). Tools only compute their output; recording the
 * call, skipping repeats and handling errors is done for them by `runToolCall`.
 */
export function defineTool<I, O>(def: ToolDefinition<I, O>): RegisteredTool {
  return {
    name: def.name,
    forTurn: (turn) =>
      // Typed as unknown for the AI SDK (its types can't follow our generics); the input is
      // re-parsed with the tool's own schema in runToolCall.
      tool<unknown, unknown, Record<string, unknown>>({
        description: def.description,
        inputSchema: zodSchema(def.input as z.ZodType),
        execute: (input, { toolCallId }) => runToolCall(def, turn, input, toolCallId),
      }),
  };
}

/** The tools for one turn, as the AI SDK expects them. */
export function buildTools(tools: readonly RegisteredTool[], ctx: TurnContext): ToolSet {
  const turn: Turn = { ...ctx, calls: 0 };
  return Object.fromEntries(tools.map((t) => [t.name, t.forTurn(turn)]));
}

/**
 * Runs one tool call:
 * 1. record it (a ToolInvocation row, unique per run and call id);
 * 2. if this exact call already succeeded (a retried step), return the saved result;
 * 3. otherwise run the tool and check its output against the tool's schema;
 * 4. save the result, or save the error and rethrow it for the model to read (on Stop, the call
 *    is marked cancelled instead).
 */
async function runToolCall<I, O>(
  def: ToolDefinition<I, O>,
  turn: Turn,
  rawInput: unknown,
  toolCallId: string,
): Promise<O> {
  // Also fills defaults (e.g. gpt_image_2's Low quality) before the input is stored.
  const input = def.input.parse(rawInput);
  const call = await toolRepository.start({
    runId: turn.runId,
    messageId: turn.messageId,
    toolCallId,
    toolName: def.name,
    kind: TOOLS[def.name],
    ordinal: turn.calls++,
    inputSanitized: (def.sanitize ? def.sanitize(input) : input) as Prisma.InputJsonValue,
  });

  if (call.state === "succeeded") return def.output.parse(call.output);

  try {
    const result = await def.execute(input, { ...turn, invocationId: call.id, toolCallId });
    const output = def.output.parse(result);
    await toolRepository.succeed(call, output as Prisma.InputJsonValue);
    return output;
  } catch (err) {
    if (turn.signal?.aborted) {
      await toolRepository.cancel(call);
      throw err;
    }
    // Our own errors carry a safe message; anything unexpected gets a generic one.
    const error =
      err instanceof AppError
        ? err
        : new AppError("INTERNAL", "The tool failed unexpectedly.", undefined, { cause: err });
    logger.warn({ err, runId: turn.runId, tool: def.name, code: error.code }, "tool call failed");
    await toolRepository.fail(call, error);
    // The AI SDK turns this into a tool error the model can read, and the turn goes on.
    throw error;
  }
}
