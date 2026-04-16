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
    const message =
      error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error ? error : undefined;
    const le = new LucidError(code, message);
    if (cause !== undefined) {
      (le as { cause?: unknown }).cause = cause;
    }
    return le;
  }
}
