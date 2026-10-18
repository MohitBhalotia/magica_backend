import type { z } from "zod";

import type {
  ChatSummary,
  Message,
  MessageRoleSchema,
  MessageStatusSchema,
  SearchResult,
  TitleSourceSchema,
} from "@mohitbhalotia/magica-contracts";

import type * as Db from "../../../prisma/generated/client";

// DEC-048: contract enums mirror the Prisma enums. Any drift fails `pnpm typecheck`.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const enumParity: [
  Same<Db.TitleSource, z.infer<typeof TitleSourceSchema>>,
  Same<Db.MessageRole, z.infer<typeof MessageRoleSchema>>,
  Same<Db.MessageStatus, z.infer<typeof MessageStatusSchema>>,
] = [true, true, true];

export const toChatSummary = (c: Db.Chat): ChatSummary => ({
  id: c.id,
  title: c.title,
  titleSource: c.titleSource,
  isPinned: c.isPinned,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

export const toMessage = (m: Db.Message): Message => ({
  id: m.id,
  role: m.role,
  status: m.status,
  text: m.text,
  createdAt: m.createdAt.toISOString(),
});

const SNIPPET_RADIUS = 60;

/** ~120 chars of plain text around the first match; the client highlights the query. */
export function excerpt(text: string, q: string) {
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return text.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + q.length + SNIPPET_RADIUS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export const toSearchResult = (
  c: Db.Chat & { messages: { text: string }[] },
  q: string,
): SearchResult => ({
  ...toChatSummary(c),
  snippet: excerpt(c.messages[0]?.text ?? c.title, q),
});
