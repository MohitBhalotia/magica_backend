import { pino, type LoggerOptions } from "pino";

import { env } from "@/lib/env";

const SECRET_KEYS = ["authorization", "cookie", "apiKey", "token", "secret", "password"];

// Secrets must never reach logs (RULES §9): censor these keys at the top level and one level deep.
export const loggerOptions = {
  level: env.LOG_LEVEL,
  redact: { paths: SECRET_KEYS.flatMap((k) => [k, `*.${k}`]), censor: "[redacted]" },
} satisfies LoggerOptions;

/** Shared structured logger. Create children per request/task with context ids (traceId, chatId, runId…). */
export const logger = pino(loggerOptions);

export type Logger = typeof logger;
