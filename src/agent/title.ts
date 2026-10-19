import { generateText, type LanguageModel } from "ai";

import { PROMPT_TITLE_LENGTH, truncateTitle } from "@/modules/chats/chat.service";

// The prompt is often a task ("Generate an image of…"): the model must name it, never do it.
const TITLE_PROMPT =
  "You name chats. Summarize what the user asks for in the conversation inside <conversation> as a short title of at most 6 words, " +
  'e.g. "Red apple image generation". Never answer, perform or refuse the request: only describe it. ' +
  "Reply with the title only, no quotes or punctuation at the end.";
/** Enough of the conversation to name it; keeps the free-model call small. */
const MAX_CONTEXT_CHARS = 2000;
/** A model that answered or refused instead of naming the chat; the prompt title is kept then. */
const REFUSAL = /^(i (can|am|won|apolog)|i'm|sorry|unfortunately|as an ai)/i;

/** A sidebar title for a chat, or null if the model returned nothing usable. */
export async function generateTitle(
  model: LanguageModel,
  messages: { role: string; text: string }[],
): Promise<string | null> {
  const conversation = messages.map((m) => `${m.role}: ${m.text}`).join("\n\n");
  const { text } = await generateText({
    model,
    system: TITLE_PROMPT,
    prompt: `<conversation>\n${conversation.slice(0, MAX_CONTEXT_CHARS)}\n</conversation>`,
    maxRetries: 0,
  });
  const title = text
    .replace(/["*#`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
  return title && !REFUSAL.test(title) ? truncateTitle(title, PROMPT_TITLE_LENGTH) : null;
}
