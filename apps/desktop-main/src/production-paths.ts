import path from 'node:path';

export interface CanonicalUserDataLayout {
  readonly root: string;
  readonly databasePath: string;
  readonly mediaRoot: string;
  readonly recoveryKeyAccount: 'recovery-key-v1';
}

/**
 * The development cutover deliberately owns a new profile. It never probes,
 * imports, or aliases a previous application database or media directory.
 */
export function canonicalUserDataLayout(userDataPath: string): CanonicalUserDataLayout {
  const root = path.join(userDataPath, 'lucid-fin-v1');
  return Object.freeze({
    root,
    databasePath: path.join(root, 'project.sqlite'),
    mediaRoot: path.join(root, 'media'),
    recoveryKeyAccount: 'recovery-key-v1',
  });
}
