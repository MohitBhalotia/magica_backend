import { z } from "zod";

import { pageSchema, PageQuerySchema } from "./pagination.ts";

export const MAX_TITLE_LENGTH = 200;
export const MAX_MESSAGE_LENGTH = 10_000;

// API enums. They mirror the Prisma enums; a backend type check fails CI on any drift (DEC-048).
export const TitleSourceSchema = z.enum(["placeholder", "prompt", "generated", "user"]);
export const MessageRoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export const MessageStatusSchema = z.enum([
  "pending",
  "streaming",
  "success",
  "failed",
  "cancelled",
]);

const TitleSchema = z.string().trim().min(1).max(MAX_TITLE_LENGTH);

/** A sidebar row. */
export const ChatSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  titleSource: TitleSourceSchema,
  isPinned: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ChatSummary = z.infer<typeof ChatSummarySchema>;

/** `GET /chats`: pinned first, then most recently updated. */
export const ChatListSchema = pageSchema(ChatSummarySchema);
export type ChatList = z.infer<typeof ChatListSchema>;

/** M1 subset; content blocks (text, thinking, tool use…) join in M2. */
export const MessageSchema = z.object({
  id: z.string(),
  role: MessageRoleSchema,
  status: MessageStatusSchema,
  text: z.string(),
  createdAt: z.iso.datetime(),
});
export type Message = z.infer<typeof MessageSchema>;

/** `GET /chats/:id`: the chat plus its newest messages; `messages.nextCursor` loads older ones. */
export const ChatDetailSchema = ChatSummarySchema.extend({ messages: pageSchema(MessageSchema) });
export type ChatDetail = z.infer<typeof ChatDetailSchema>;

/** `POST /chats`. Resending the same clientMessageId returns the same chat (no duplicates). */
export const CreateChatRequestSchema = z.object({
  clientMessageId: z.uuid(),
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});
export type CreateChatRequest = z.infer<typeof CreateChatRequestSchema>;

export const CreateChatResponseSchema = z.object({ chatId: z.string(), userMessageId: z.string() });
export type CreateChatResponse = z.infer<typeof CreateChatResponseSchema>;

/** `PATCH /chats/:id`: rename and/or pin. */
export const UpdateChatRequestSchema = z
  .object({ title: TitleSchema.optional(), isPinned: z.boolean().optional() })
  .refine((v) => v.title !== undefined || v.isPinned !== undefined, {
    message: "Provide a title or isPinned.",
  });
export type UpdateChatRequest = z.infer<typeof UpdateChatRequestSchema>;

/** `GET /chats/search`: titles and message text. */
export const SearchQuerySchema = PageQuerySchema.extend({ q: z.string().trim().min(1).max(200) });
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

/** A search hit; `snippet` is plain text around the first match (the client highlights the query). */
export const SearchResultSchema = ChatSummarySchema.extend({ snippet: z.string() });
export type SearchResult = z.infer<typeof SearchResultSchema>;
export const SearchResultListSchema = pageSchema(SearchResultSchema);
export type SearchResultList = z.infer<typeof SearchResultListSchema>;
