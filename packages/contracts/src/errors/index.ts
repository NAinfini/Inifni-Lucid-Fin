export const ErrorCode = {
  AuthFailed: 'AUTH_FAILED',
  RateLimited: 'RATE_LIMITED',
  ContentModeration: 'CONTENT_MODERATION',
  ServiceUnavailable: 'SERVICE_UNAVAILABLE',
  Timeout: 'TIMEOUT',
  InvalidRequest: 'INVALID_REQUEST',
  NotFound: 'NOT_FOUND',
  Unknown: 'UNKNOWN',
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
}
