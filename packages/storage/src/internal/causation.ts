import { CausationRefSchema, parseCanonical, type CausationRef } from '@lucid-fin/contracts';
import { StorageError } from '../kernel/errors.js';

export function causationColumns(causation: CausationRef): readonly [string, string] {
  switch (causation.kind) {
    case 'message':
      return [causation.kind, causation.messageId];
    case 'run':
      return [causation.kind, causation.runId];
    case 'user_choice':
      return [causation.kind, causation.choiceId];
    case 'import':
      return [causation.kind, causation.importId];
    case 'direct_ui':
      return [causation.kind, causation.actionId];
    case 'run_inbox':
      return [causation.kind, causation.inboxMessageId];
  }
}

export function causationFromColumns(kind: string, id: string): CausationRef {
  const value =
    kind === 'message'
      ? { kind, messageId: id }
      : kind === 'run'
        ? { kind, runId: id }
        : kind === 'user_choice'
          ? { kind, choiceId: id }
          : kind === 'import'
            ? { kind, importId: id }
            : kind === 'direct_ui'
              ? { kind, actionId: id }
              : kind === 'run_inbox'
                ? { kind, inboxMessageId: id }
                : null;
  if (value === null) {
    throw new StorageError('CORRUPT_DATA', `Unknown persisted causation kind: ${kind}`);
  }
  try {
    return parseCanonical(CausationRefSchema, value);
  } catch (cause) {
    throw new StorageError('CORRUPT_DATA', 'Persisted causation is invalid', { cause });
  }
}
