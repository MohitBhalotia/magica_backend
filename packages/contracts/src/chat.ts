import { z } from "zod";

import { ContentBlocksSchema, MessageMetadataSchema } from "./blocks.ts";
import { ErrorCodeSchema } from "./errors.ts";
import { pageSchema, PageQuerySchema } from "./pagination.ts";
import { RunHandleSchema } from "./run.ts";

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

/**
 * A message. `contentBlocks` is the ordered content (assistant turns); `text` is the plain-text
 * projection for search, copy and the user bubble. Failed/cancelled turns keep their partial blocks.
 */
export const MessageSchema = z.object({
  id: z.string(),
  role: MessageRoleSchema,
  status: MessageStatusSchema,
  text: z.string(),
  contentBlocks: ContentBlocksSchema,
  metadata: MessageMetadataSchema.nullable(),
  errorCode: ErrorCodeSchema.nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
export type Message = z.infer<typeof MessageSchema>;

/**
 * `GET /chats/:id`: the chat, its newest messages (`messages.nextCursor` loads older ones) and the
 * run in progress, if any, with a fresh token so a reload can resume the live stream.
 */
export const ChatDetailSchema = ChatSummarySchema.extend({
  messages: pageSchema(MessageSchema),
  activeRun: RunHandleSchema.nullable(),
});
export type ChatDetail = z.infer<typeof ChatDetailSchema>;

/**
 * `POST /chats` (first message) and `POST /chats/:id/messages` (follow-up). Resending the same
 * clientMessageId returns the same chat, messages and run: no duplicates.
 */
export const SendMessageRequestSchema = z.object({
  clientMessageId: z.uuid(),
  text: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

/** Both sends: the new messages plus the run that answers them. */
export const SendResponseSchema = z.object({
  chatId: z.string(),
  userMessageId: z.string(),
  assistantMessageId: z.string(),
  run: RunHandleSchema,
});
export type SendResponse = z.infer<typeof SendResponseSchema>;

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
