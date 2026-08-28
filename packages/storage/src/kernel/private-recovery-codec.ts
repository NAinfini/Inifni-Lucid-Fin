import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { StorageError } from './errors.js';

export const PRIVATE_RECOVERY_ALGORITHM = 'aes-256-gcm' as const;
export const PRIVATE_RECOVERY_KEY_BYTES = 32;
export const PRIVATE_RECOVERY_NONCE_BYTES = 12;
export const PRIVATE_RECOVERY_AUTHENTICATION_TAG_BYTES = 16;

export interface PrivateRecoverySealInput {
  readonly plaintext: Uint8Array;
  readonly aad: Uint8Array;
}

export interface PrivateRecoverySealedEnvelope {
  readonly algorithm: typeof PRIVATE_RECOVERY_ALGORITHM;
  readonly encryptionKeyId: string;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
  readonly authenticationTag: Uint8Array;
}

export interface PrivateRecoveryOpenInput extends PrivateRecoverySealedEnvelope {
  readonly aad: Uint8Array;
}

export interface PrivateRecoveryCodec {
  readonly algorithm: typeof PRIVATE_RECOVERY_ALGORITHM;
  readonly encryptionKeyId: string;
  seal(input: PrivateRecoverySealInput): PrivateRecoverySealedEnvelope;
  open(input: PrivateRecoveryOpenInput): Uint8Array;
}

export interface Aes256GcmPrivateRecoveryCodecOptions {
  readonly encryptionKeyId: string;
  readonly encryptionKey: Uint8Array;
  readonly resolveEncryptionKey?: (encryptionKeyId: string) => Uint8Array | undefined;
}

function securityConfigurationFailed(): StorageError {
  return new StorageError(
    'SECURITY_CONFIGURATION_FAILED',
    'Private recovery encryption is not configured securely',
  );
}

function corruptRecoveryData(): StorageError {
  return new StorageError('CORRUPT_DATA', 'Private recovery data cannot be authenticated');
}

function validEncryptionKeyId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 160 &&
    /^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(value)
  );
}

function copyKey(value: unknown): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength !== PRIVATE_RECOVERY_KEY_BYTES) {
    throw securityConfigurationFailed();
  }
  return Buffer.from(value);
}

function copyAuthenticatedBytes(value: unknown): Buffer {
  if (!(value instanceof Uint8Array)) throw corruptRecoveryData();
  return Buffer.from(value);
}

function copyAad(value: unknown): Buffer {
  const aad = copyAuthenticatedBytes(value);
  if (aad.byteLength === 0) throw corruptRecoveryData();
  return aad;
}

export function createAes256GcmPrivateRecoveryCodec(
  options: Aes256GcmPrivateRecoveryCodecOptions,
): PrivateRecoveryCodec {
  if (!validEncryptionKeyId(options?.encryptionKeyId)) throw securityConfigurationFailed();
  const encryptionKeyId = options.encryptionKeyId;
  const encryptionKey = copyKey(options.encryptionKey);
  const resolveEncryptionKey = options.resolveEncryptionKey;

  const keyFor = (keyId: unknown): Buffer => {
    if (!validEncryptionKeyId(keyId)) throw corruptRecoveryData();
    if (keyId === encryptionKeyId) return Buffer.from(encryptionKey);
    if (resolveEncryptionKey === undefined) throw securityConfigurationFailed();
    let resolved: Uint8Array | undefined;
    try {
      resolved = resolveEncryptionKey(keyId);
    } catch {
      throw securityConfigurationFailed();
    }
    if (resolved === undefined) throw securityConfigurationFailed();
    return copyKey(resolved);
  };

  return Object.freeze({
    algorithm: PRIVATE_RECOVERY_ALGORITHM,
    encryptionKeyId,
    seal({ plaintext, aad }: PrivateRecoverySealInput): PrivateRecoverySealedEnvelope {
      const authenticatedData = copyAad(aad);
      const nonce = randomBytes(PRIVATE_RECOVERY_NONCE_BYTES);
      try {
        const cipher = createCipheriv(PRIVATE_RECOVERY_ALGORITHM, encryptionKey, nonce, {
          authTagLength: PRIVATE_RECOVERY_AUTHENTICATION_TAG_BYTES,
        });
        cipher.setAAD(authenticatedData);
        const ciphertext = Buffer.concat([
          cipher.update(copyAuthenticatedBytes(plaintext)),
          cipher.final(),
        ]);
        return Object.freeze({
          algorithm: PRIVATE_RECOVERY_ALGORITHM,
          encryptionKeyId,
          nonce: Buffer.from(nonce),
          ciphertext,
          authenticationTag: Buffer.from(cipher.getAuthTag()),
        });
      } catch (cause) {
        if (cause instanceof StorageError) throw cause;
        throw securityConfigurationFailed();
      }
    },
    open(input: PrivateRecoveryOpenInput): Uint8Array {
      const {
        algorithm,
        encryptionKeyId: keyId,
        nonce,
        ciphertext,
        authenticationTag,
        aad,
      } = input;
      if (algorithm !== PRIVATE_RECOVERY_ALGORITHM) throw corruptRecoveryData();
      const authenticatedData = copyAad(aad);
      const nonceBytes = copyAuthenticatedBytes(nonce);
      const ciphertextBytes = copyAuthenticatedBytes(ciphertext);
      const authenticationTagBytes = copyAuthenticatedBytes(authenticationTag);
      if (
        nonceBytes.byteLength !== PRIVATE_RECOVERY_NONCE_BYTES ||
        ciphertextBytes.byteLength === 0 ||
        authenticationTagBytes.byteLength !== PRIVATE_RECOVERY_AUTHENTICATION_TAG_BYTES
      ) {
        throw corruptRecoveryData();
      }
      const key = keyFor(keyId);
      try {
        const decipher = createDecipheriv(PRIVATE_RECOVERY_ALGORITHM, key, nonceBytes, {
          authTagLength: PRIVATE_RECOVERY_AUTHENTICATION_TAG_BYTES,
        });
        decipher.setAAD(authenticatedData);
        decipher.setAuthTag(authenticationTagBytes);
        return Buffer.concat([decipher.update(ciphertextBytes), decipher.final()]);
      } catch (cause) {
        if (cause instanceof StorageError) throw cause;
        throw corruptRecoveryData();
      }
    },
  });
}
