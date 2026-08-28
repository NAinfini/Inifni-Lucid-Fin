export type StorageErrorCode =
  | 'CORRUPT_DATA'
  | 'DATABASE_ALREADY_EXISTS'
  | 'FOREIGN_KEY_CHECK_FAILED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INTEGRITY_CHECK_FAILED'
  | 'INVALID_REQUEST'
  | 'NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'SCHEMA_ARTIFACT_HASH_MISMATCH'
  | 'SCHEMA_ARTIFACT_INVALID'
  | 'SCHEMA_DRIFT'
  | 'SECURITY_CONFIGURATION_FAILED'
  | 'STORE_NOT_OPEN';

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StorageError';
    this.code = code;
  }
}
