import type { ErrorCode } from "@agent-chat/contracts";

/** Expected failure with a user-safe message; mapped to the error envelope at the edge. */
export class AppError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, { cause: options?.cause });
    this.name = "AppError";
    this.retryable = options?.retryable ?? false;
  }
}
