import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";

import { generateTitle } from "@/agent/title";

const modelSaying = (text: string) =>
  new MockLanguageModelV4({
    doGenerate: () =>
      Promise.resolve({
        content: [{ type: "text", text }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      }),
  });

const chat = [
  { role: "user", text: "Plan a weekend in Paris" },
  { role: "assistant", text: "Day 1: ..." },
];

describe("generateTitle", () => {
  it("strips quotes, markdown and trailing punctuation", async () => {
    expect(await generateTitle(modelSaying('**"Weekend in Paris."**\n'), chat)).toBe(
      "Weekend in Paris",
    );
  });

  it("truncates long titles to 50 characters", async () => {
    const title = await generateTitle(modelSaying("word ".repeat(30)), chat);
    expect(title?.length).toBeLessThanOrEqual(50);
    expect(title?.endsWith("…")).toBe(true);
  });

  it("drops a refusal or apology instead of using it as the title", async () => {
    const said = [
      "I cannot generate or create images as I am a text-based model.",
      "I'm sorry, but I can't help with that",
      "Sorry, I am unable to do this",
    ];
    for (const text of said) expect(await generateTitle(modelSaying(text), chat)).toBeNull();
  });

  it("returns null when the model says nothing", async () => {
    expect(await generateTitle(modelSaying("  "), chat)).toBeNull();
  });
});
