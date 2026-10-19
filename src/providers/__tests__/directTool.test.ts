import { tool, type UIMessageChunk } from "ai";
import { expect, it, vi } from "vitest";
import { z } from "zod";

import { streamTurn, toStored } from "@/agent/turn";
import { directTool } from "@/providers/directTool";

it("runs exactly the requested tool once, with exactly the caller's input, then ends", async () => {
  const execute = vi.fn((input: { image_url: string }) =>
    Promise.resolve({ cropped: input.image_url }),
  );
  const input = { image_url: "https://x.test/a.png", x_percent: 10 };
  const { stream, ended } = streamTurn({
    model: directTool("crop_image", input),
    messages: [{ role: "user", content: "Run crop_image" }],
    tools: {
      crop_image: tool({
        inputSchema: z.object({ image_url: z.string(), x_percent: z.number() }),
        execute,
      }),
    },
  });
  const reader = stream.getReader();
  const chunks: UIMessageChunk[] = [];
  for (let r = await reader.read(); !r.done; r = await reader.read()) chunks.push(r.value);
  const end = await ended;

  expect(execute).toHaveBeenCalledOnce();
  expect(execute.mock.calls[0]?.[0]).toEqual(input);
  expect(end.status).toBe("completed");
  // The saved turn is the tool step and nothing the model "wrote".
  const { blocks, text } = toStored(end.message);
  expect(text).toBe("");
  expect(blocks.find((b) => b.type === "tool-crop_image")).toMatchObject({
    state: "output-available",
    output: { cropped: input.image_url },
  });
});
