import { describe, expect, it } from 'vitest';
import {
  createAes256GcmPrivateRecoveryCodec,
  PRIVATE_RECOVERY_ALGORITHM,
  PRIVATE_RECOVERY_AUTHENTICATION_TAG_BYTES,
  PRIVATE_RECOVERY_KEY_BYTES,
  PRIVATE_RECOVERY_NONCE_BYTES,
} from './private-recovery-codec.js';

const CURRENT_KEY = Buffer.alloc(PRIVATE_RECOVERY_KEY_BYTES, 0x11);
const PREVIOUS_KEY = Buffer.alloc(PRIVATE_RECOVERY_KEY_BYTES, 0x22);
const WRONG_KEY = Buffer.alloc(PRIVATE_RECOVERY_KEY_BYTES, 0x33);
const PLAINTEXT = Buffer.from('PRIVATE_CHILD_OBJECTIVE_SENTINEL', 'utf8');

function aad(algorithm: string, encryptionKeyId: string): Buffer {
  return Buffer.from(`private-recovery|${algorithm}|${encryptionKeyId}|run.child.1`, 'utf8');
}

function expectStorageError(action: () => unknown, code: string): void {
  try {
    action();
  } catch (cause) {
    expect(cause).toMatchObject({ code });
    expect(cause).not.toMatchObject({
      message: expect.stringContaining(PLAINTEXT.toString('utf8')),
    });
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe('AES-256-GCM private recovery codec', () => {
  it('round-trips authenticated payloads and resolves a historical key by ID', () => {
    const codec = createAes256GcmPrivateRecoveryCodec({
      encryptionKeyId: 'key.current',
      encryptionKey: CURRENT_KEY,
      resolveEncryptionKey: (keyId) => (keyId === 'key.previous' ? PREVIOUS_KEY : undefined),
    });
    const sealed = codec.seal({
      plaintext: PLAINTEXT,
      aad: aad(codec.algorithm, codec.encryptionKeyId),
    });

    expect(codec.algorithm).toBe(PRIVATE_RECOVERY_ALGORITHM);
    expect(sealed).toMatchObject({
      algorithm: PRIVATE_RECOVERY_ALGORITHM,
      encryptionKeyId: 'key.current',
    });
    expect(
      Buffer.from(codec.open({ ...sealed, aad: aad(codec.algorithm, codec.encryptionKeyId) })),
    ).toEqual(PLAINTEXT);

    const previous = createAes256GcmPrivateRecoveryCodec({
      encryptionKeyId: 'key.previous',
      encryptionKey: PREVIOUS_KEY,
    });
    const historical = previous.seal({
      plaintext: PLAINTEXT,
      aad: aad(previous.algorithm, previous.encryptionKeyId),
    });
    expect(
      Buffer.from(
        codec.open({ ...historical, aad: aad(historical.algorithm, historical.encryptionKeyId) }),
      ),
    ).toEqual(PLAINTEXT);
  });

  it('rejects missing and wrong keys without a fallback', () => {
    const codec = createAes256GcmPrivateRecoveryCodec({
      encryptionKeyId: 'key.current',
      encryptionKey: CURRENT_KEY,
    });
    const sealed = codec.seal({
      plaintext: PLAINTEXT,
      aad: aad(codec.algorithm, codec.encryptionKeyId),
    });

    expectStorageError(
      () =>
        codec.open({
          ...sealed,
          encryptionKeyId: 'key.missing',
          aad: aad(codec.algorithm, 'key.missing'),
        }),
      'SECURITY_CONFIGURATION_FAILED',
    );
    const wrongKeyCodec = createAes256GcmPrivateRecoveryCodec({
      encryptionKeyId: 'key.current',
      encryptionKey: WRONG_KEY,
    });
    expectStorageError(
      () => wrongKeyCodec.open({ ...sealed, aad: aad(codec.algorithm, codec.encryptionKeyId) }),
      'CORRUPT_DATA',
    );
    expectStorageError(
      () =>
        createAes256GcmPrivateRecoveryCodec({
          encryptionKeyId: 'key.current',
          encryptionKey: Buffer.alloc(PRIVATE_RECOVERY_KEY_BYTES - 1),
        }),
      'SECURITY_CONFIGURATION_FAILED',
    );
  });

  it('rejects tampered ciphertext, tags, and AAD', () => {
    const codec = createAes256GcmPrivateRecoveryCodec({
      encryptionKeyId: 'key.current',
      encryptionKey: CURRENT_KEY,
    });
    const sealed = codec.seal({
      plaintext: PLAINTEXT,
      aad: aad(codec.algorithm, codec.encryptionKeyId),
    });
    const ciphertext = Buffer.from(sealed.ciphertext);
    ciphertext[0] = ciphertext[0]! ^ 0x01;
    const authenticationTag = Buffer.from(sealed.authenticationTag);
    authenticationTag[0] = authenticationTag[0]! ^ 0x01;

    expectStorageError(
      () => codec.open({ ...sealed, ciphertext, aad: aad(codec.algorithm, codec.encryptionKeyId) }),
      'CORRUPT_DATA',
    );
    expectStorageError(
      () =>
        codec.open({
          ...sealed,
          authenticationTag,
          aad: aad(codec.algorithm, codec.encryptionKeyId),
        }),
      'CORRUPT_DATA',
    );
    expectStorageError(
      () => codec.open({ ...sealed, aad: Buffer.from('different authenticated data', 'utf8') }),
      'CORRUPT_DATA',
    );
  });

  it('uses a fresh 12-byte nonce and a 16-byte authentication tag for each seal', () => {
    const codec = createAes256GcmPrivateRecoveryCodec({
      encryptionKeyId: 'key.current',
      encryptionKey: CURRENT_KEY,
    });
    const first = codec.seal({
      plaintext: PLAINTEXT,
      aad: aad(codec.algorithm, codec.encryptionKeyId),
    });
    const second = codec.seal({
      plaintext: PLAINTEXT,
      aad: aad(codec.algorithm, codec.encryptionKeyId),
    });

    expect(first.nonce).toHaveLength(PRIVATE_RECOVERY_NONCE_BYTES);
    expect(first.authenticationTag).toHaveLength(PRIVATE_RECOVERY_AUTHENTICATION_TAG_BYTES);
    expect(Buffer.from(first.nonce)).not.toEqual(Buffer.from(second.nonce));
    expect(Buffer.from(first.ciphertext).toString('utf8')).not.toContain(
      PLAINTEXT.toString('utf8'),
    );
  });
});
