import { simulateReadableStream, tool, type UIMessageChunk } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import { streamTurn, toStored } from "@/agent/turn";

type MockDoStream = NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>["doStream"];

const usage = {
  inputTokens: { total: 3, noCache: 3, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};
const step = (chunks: object[], reason: "stop" | "tool-calls") => ({
  stream: simulateReadableStream({
    chunks: [
      ...chunks,
      { type: "finish", finishReason: { unified: reason, raw: undefined }, usage },
    ],
  }),
});
const callLoadSkill = () =>
  step(
    [
      {
        type: "tool-call",
        toolCallId: "call-1",
        toolName: "load_skill",
        input: JSON.stringify({ name: "crop-image" }),
      },
    ],
    "tool-calls",
  );
const say = (text: string) =>
  step(
    text
      ? [
          { type: "text-start", id: "t" },
          { type: "text-delta", id: "t", delta: text },
          { type: "text-end", id: "t" },
        ]
      : [],
    "stop",
  );

/** A model that answers with `steps` in order, and a stand-in load_skill tool. */
async function run(...steps: (() => ReturnType<typeof step>)[]) {
  const doStream = vi.fn(() =>
    Promise.resolve((steps[doStream.mock.calls.length - 1] ?? steps.at(-1) ?? (() => say("")))()),
  );
  const execute = vi.fn(({ name }: { name: string }) =>
    Promise.resolve({ name, alreadyLoaded: false }),
  );
  const { stream, ended } = streamTurn({
    // Chunks are plain objects in the provider's stream-part shape (its type isn't exported via `ai`).
    model: new MockLanguageModelV4({ doStream: doStream as unknown as MockDoStream }),
    messages: [{ role: "user", content: "Crop it" }],
    tools: { load_skill: tool({ inputSchema: z.object({ name: z.string() }), execute }) },
  });
  const reader = stream.getReader();
  const chunks: UIMessageChunk[] = [];
  for (let r = await reader.read(); !r.done; r = await reader.read()) chunks.push(r.value);
  return { end: await ended, chunks, calls: doStream.mock.calls.length, execute };
}

it("runs a tool, feeds the result back, and saves the tool part before the answer", async () => {
  const { end, calls, execute } = await run(callLoadSkill, () => say("Cropped it."));

  expect(calls).toBe(2);
  expect(execute).toHaveBeenCalledOnce();
  expect(end.status).toBe("completed");
  const { blocks, text, metadata } = toStored(end.message);
  expect(text).toBe("Cropped it.");
  // The step row's duration, streamed and saved as message metadata.
  expect(metadata.toolMs?.["call-1"]).toBeGreaterThanOrEqual(0);
  expect(blocks.map((b) => b.type)).toContain("tool-load_skill");
  expect(blocks.find((b) => b.type === "tool-load_skill")).toMatchObject({
    toolCallId: "call-1",
    state: "output-available",
    input: { name: "crop-image" },
    output: { name: "crop-image", alreadyLoaded: false },
  });
});

it("a turn that called tools but wrote no text isn't retried as empty (tools would run twice)", async () => {
  const { end, calls, execute } = await run(callLoadSkill, () => say(""));

  expect(calls).toBe(2); // the tool step + the empty follow-up; no third, retried attempt
  expect(execute).toHaveBeenCalledOnce();
  expect(end.status).toBe("completed");
});
