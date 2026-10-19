import { generateText, type LanguageModel } from "ai";

import { PROMPT_TITLE_LENGTH, truncateTitle } from "@/modules/chats/chat.service";

const TITLE_PROMPT =
  "Write a short title (at most 6 words) for the conversation below. Reply with the title only, no quotes or punctuation at the end.";
/** Enough of the conversation to name it; keeps the free-model call small. */
const MAX_CONTEXT_CHARS = 2000;

/** A sidebar title for a chat, or null if the model returned nothing usable. */
export async function generateTitle(
  model: LanguageModel,
  messages: { role: string; text: string }[],
): Promise<string | null> {
  const conversation = messages.map((m) => `${m.role}: ${m.text}`).join("\n\n");
  const { text } = await generateText({
    model,
    system: TITLE_PROMPT,
    prompt: conversation.slice(0, MAX_CONTEXT_CHARS),
    maxRetries: 0,
  });
  const title = text
    .replace(/["*#`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
  return title ? truncateTitle(title, PROMPT_TITLE_LENGTH) : null;
}
