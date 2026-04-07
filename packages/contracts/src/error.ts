/**
 * Error handling types and utilities for AI provider adapters.
 *
 * This module provides standardized error categorization and handling
 * for all adapter implementations.
 *
 * @module error
 */

import { ErrorCategory } from './errors/index.js';
import type { AdapterError } from './errors/index.js';

export { ErrorCode, ErrorCategory, LucidError } from './errors/index.js';
export type { AdapterError } from './errors/index.js';

/**
 * Parse a raw error into a standardized AdapterError.
 *
 * @param error - The raw error from the provider
 * @param defaultCategory - Default category if parsing fails
 * @returns Standardized adapter error
 */
export function parseAdapterError(
  error: unknown,
  defaultCategory: ErrorCategory = ErrorCategory.ServiceError
): AdapterError {
  if (isAdapterError(error)) {
    return error;
  }

  if (error instanceof Error) {
    return {
      category: defaultCategory,
      message: error.message,
      retryable: false,
      originalError: error,
    };
  }

  return {
    category: defaultCategory,
    message: String(error),
    retryable: false,
    originalError: error,
  };
}

/**
 * Type guard to check if an error is an AdapterError.
 */
export function isAdapterError(error: unknown): error is AdapterError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'category' in error &&
    'message' in error &&
    'retryable' in error
  );
}
