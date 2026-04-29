import type { AdapterError } from '@lucid-fin/contracts';
import { ErrorCategory, ErrorCode, LucidError } from '@lucid-fin/contracts';

type ParseAdapterErrorInput = {
  provider: string;
  status?: number;
  error: unknown;
  fallbackCategory?: ErrorCategory;
};

export function parseAdapterError(input: ParseAdapterErrorInput): AdapterError {
  const status = input.status;
  const message = extractMessage(input.error) ?? `${input.provider} request failed`;
  const providerCode = extractProviderCode(input.error);
  const retryAfter = extractRetryAfter(input.error);
  const category =
    classifyByProviderCode(providerCode) ??
    classifyByStatus(status, message) ??
    input.fallbackCategory ??
    ErrorCategory.ServiceError;

  return {
    category,
    message,
    retryable: isRetryable(category, status),
    retryAfter,
    providerCode,
    originalError: input.error,
  };
}

export function adapterErrorToLucidError(error: AdapterError): LucidError {
  const code = adapterCategoryToLucidCode(error.category);
  return new LucidError(code, error.message, {
    retryable: error.retryable,
    retryAfter: error.retryAfter,
    providerCode: error.providerCode,
    originalError: error.originalError,
  });
}

function adapterCategoryToLucidCode(category: ErrorCategory): ErrorCode {
  switch (category) {
    case ErrorCategory.Auth:
      return ErrorCode.AuthFailed;
    case ErrorCategory.RateLimit:
      return ErrorCode.RateLimited;
    case ErrorCategory.ContentModeration:
      return ErrorCode.ContentModeration;
    case ErrorCategory.InvalidInput:
      return ErrorCode.InvalidRequest;
    case ErrorCategory.Timeout:
      return ErrorCode.Timeout;
    case ErrorCategory.ServiceError:
    default:
      return ErrorCode.ServiceUnavailable;
  }
}

function classifyByStatus(status: number | undefined, message: string): ErrorCategory | undefined {
  if (status === 401 || status === 403) return ErrorCategory.Auth;
  if (status === 408 || status === 504) return ErrorCategory.Timeout;
  if (status === 429) return ErrorCategory.RateLimit;
  if (status === 400) {
    return looksLikeModeration(message)
      ? ErrorCategory.ContentModeration
      : ErrorCategory.InvalidInput;
  }
  if (typeof status === 'number' && status >= 500) return ErrorCategory.ServiceError;
  return looksLikeModeration(message) ? ErrorCategory.ContentModeration : undefined;
}

function classifyByProviderCode(providerCode: string | undefined): ErrorCategory | undefined {
  if (!providerCode) return undefined;
  const normalized = providerCode.toLowerCase();
  if (normalized.includes('auth') || normalized.includes('key')) return ErrorCategory.Auth;
  if (normalized.includes('rate') || normalized.includes('quota')) return ErrorCategory.RateLimit;
  if (
    normalized.includes('moderation') ||
    normalized.includes('policy') ||
    normalized.includes('safety')
  ) {
    return ErrorCategory.ContentModeration;
  }
  if (normalized.includes('timeout')) return ErrorCategory.Timeout;
  if (normalized.includes('input') || normalized.includes('invalid'))
    return ErrorCategory.InvalidInput;
  return undefined;
}

function isRetryable(category: ErrorCategory, status: number | undefined): boolean {
  if (category === ErrorCategory.Auth) return false;
  if (category === ErrorCategory.InvalidInput) return false;
  if (category === ErrorCategory.ContentModeration) return false;
  if (category === ErrorCategory.RateLimit) return true;
  if (category === ErrorCategory.Timeout) return true;
  return typeof status === 'number' ? status >= 500 : true;
}

function extractMessage(error: unknown): string | undefined {
  if (typeof error === 'string') return error;
  if (!error || typeof error !== 'object') return undefined;

  const record = error as Record<string, unknown>;
  const nestedError = asRecord(record['error']);
  const directMessage = firstString(record['message'], record['detail'], record['title']);
  const nestedMessage = nestedError
    ? firstString(nestedError['message'], nestedError['detail'], nestedError['type'])
    : undefined;
  return directMessage ?? nestedMessage;
}

function extractProviderCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as Record<string, unknown>;
  const nestedError = asRecord(record['error']);
  return firstString(
    record['code'],
    record['type'],
    nestedError?.['code'],
    nestedError?.['type'],
    nestedError?.['param'],
  );
}

function extractRetryAfter(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const record = error as Record<string, unknown>;
  const nestedError = asRecord(record['error']);
  const raw = firstNumber(
    record['retry_after'],
    record['retryAfter'],
    nestedError?.['retry_after'],
    nestedError?.['retryAfter'],
  );
  return raw != null && raw >= 0 ? raw : undefined;
}

function looksLikeModeration(message: string): boolean {
  const normalized = message.toLowerCase();
  return ['moderation', 'policy', 'safety', 'blocked', 'disallowed'].some((token) =>
    normalized.includes(token),
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}
