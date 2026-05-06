/**
 * Domain-level error types for service layer.
 *
 * These are transport-agnostic errors thrown by services.
 * IPC handlers catch them and map to IPC error codes.
 */

export type IpcErrorCode = 'NOT_FOUND' | 'VALIDATION_ERROR' | 'INTERNAL_ERROR';

export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: IpcErrorCode,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super(message, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

/**
 * Maps a caught error to an IPC-safe error with a known code.
 *
 * - DomainError subclasses keep their code.
 * - Everything else becomes INTERNAL_ERROR.
 */
export function mapToIpcError(err: unknown): { code: IpcErrorCode; message: string } {
  if (err instanceof DomainError) {
    return { code: err.code, message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'INTERNAL_ERROR', message };
}
