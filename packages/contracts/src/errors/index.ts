export enum ErrorCode {
  AuthFailed = 'AUTH_FAILED',
  RateLimited = 'RATE_LIMITED',
  ContentModeration = 'CONTENT_MODERATION',
  ServiceUnavailable = 'SERVICE_UNAVAILABLE',
  Timeout = 'TIMEOUT',
  InvalidRequest = 'INVALID_REQUEST',
  NotFound = 'NOT_FOUND',
  Unknown = 'UNKNOWN',
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
