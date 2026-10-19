import { schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import { generateTitle } from "@/agent/title";
import { chatRepository } from "@/modules/chats/chat.repository";
import { openRouterFree } from "@/providers/openrouter";

/** After a chat's first answer: replaces the truncated-prompt title with a short AI title. */
export const chatTitle = schemaTask({
  id: "chat-title",
  schema: z.object({ chatId: z.string() }),
  // Nice to have: a busy free model gets one more try, then the prompt title simply stays.
  retry: { maxAttempts: 2 },
  run: async ({ chatId }) => {
    const title = await generateTitle(openRouterFree(), await chatRepository.history(chatId, 2));
    if (title) await chatRepository.setGeneratedTitle(chatId, title);
    return { title };
  },
});
