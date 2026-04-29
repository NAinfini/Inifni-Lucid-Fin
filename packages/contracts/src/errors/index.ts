export const ErrorCode = {
  // Existing codes
  AuthFailed: 'AUTH_FAILED',
  RateLimited: 'RATE_LIMITED',
  ContentModeration: 'CONTENT_MODERATION',
  ServiceUnavailable: 'SERVICE_UNAVAILABLE',
  Timeout: 'TIMEOUT',
  InvalidRequest: 'INVALID_REQUEST',
  NotFound: 'NOT_FOUND',
  Unknown: 'UNKNOWN',
  // Phase A additions
  ValidationFailed: 'VALIDATION_FAILED',
  ResourceNotFound: 'RESOURCE_NOT_FOUND',
  Cancelled: 'CANCELLED',
  Conflict: 'CONFLICT',
  ProviderUnconfigured: 'PROVIDER_UNCONFIGURED',
  ProviderQuota: 'PROVIDER_QUOTA',
  DegradedRead: 'DEGRADED_READ',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ErrorCategory = {
  Auth: 'auth',
  RateLimit: 'rate_limit',
  ContentModeration: 'content_moderation',
  InvalidInput: 'invalid_input',
  ServiceError: 'service_error',
  Timeout: 'timeout',
} as const;

export type ErrorCategory = (typeof ErrorCategory)[keyof typeof ErrorCategory];

export interface AdapterError {
  category: ErrorCategory;
  message: string;
  retryable: boolean;
  retryAfter?: number;
  providerCode?: string;
  originalError?: unknown;
}

export class LucidError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'LucidError';
  }

  /**
   * Wrap any thrown value into a LucidError. Used as a last-resort boundary
   * catch so every handler path returns LucidError, never a bare `Error`.
   */
  static fromUnknown(error: unknown, fallbackCode?: ErrorCode): LucidError {
    if (error instanceof LucidError) return error;
    const code = fallbackCode ?? ErrorCode.Unknown;
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error ? error : undefined;
    const le = new LucidError(code, message);
    if (cause !== undefined) {
      (le as { cause?: unknown }).cause = cause;
    }
    return le;
  }

  // ── Semantic factories ───────────────────────────────────────
  // Keep call-sites terse: `throw LucidError.notFound('character', id)`
  // reads better than `throw new LucidError(ErrorCode.ResourceNotFound, ...)`.

  /** The request validated but the named entity does not exist. */
  static notFound(resource: string, id: string, details?: Record<string, unknown>): LucidError {
    return new LucidError(ErrorCode.ResourceNotFound, `${resource} not found: ${id}`, {
      resource,
      id,
      ...details,
    });
  }

  /** Caller provided semantically bad input that parseStrict can't catch. */
  static validation(message: string, details?: Record<string, unknown>): LucidError {
    return new LucidError(ErrorCode.ValidationFailed, message, details);
  }

  /** Optimistic-concurrency / state-mismatch errors. */
  static conflict(message: string, details?: Record<string, unknown>): LucidError {
    return new LucidError(ErrorCode.Conflict, message, details);
  }

  /** Provider API key / config missing — user-actionable in Settings. */
  static providerUnconfigured(providerId: string, details?: Record<string, unknown>): LucidError {
    return new LucidError(
      ErrorCode.ProviderUnconfigured,
      `Provider '${providerId}' is not configured`,
      { providerId, ...details },
    );
  }

  /** Provider returned rate-limit / billing error — retryable after delay. */
  static providerQuota(
    providerId: string,
    message: string,
    details?: Record<string, unknown>,
  ): LucidError {
    return new LucidError(
      ErrorCode.ProviderQuota,
      `Provider '${providerId}' quota/rate-limit: ${message}`,
      { providerId, retryable: true, ...details },
    );
  }

  /** User-initiated cancellation. The registrar already converts AbortError. */
  static cancelled(message = 'Operation cancelled', details?: Record<string, unknown>): LucidError {
    return new LucidError(ErrorCode.Cancelled, message, details);
  }

  /**
   * A persisted read degraded to a fallback. Non-fatal — typically surfaced
   * alongside the (possibly partial) response so the renderer can show a
   * warning banner. Use `parseOrDegrade` to produce the value itself.
   */
  static degradedRead(resource: string, details?: Record<string, unknown>): LucidError {
    return new LucidError(ErrorCode.DegradedRead, `Degraded read for ${resource}`, {
      resource,
      ...details,
    });
  }
}
