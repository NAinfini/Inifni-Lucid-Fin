import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '@lucid-fin/target-contracts';
import { hashCanonical } from '../internal/hashes.js';
import {
  compareLegacyBrowserSessionMirror,
  createCanonicalSqliteChatMirrorSummary,
  groupLegacyBrowserStateSnapshot,
  parseLegacyBrowserStateSnapshot,
  summarizeLegacyBrowserStateCaptureIdentity,
  toRendererSkillsExport,
  type CanonicalSqliteChatMirrorSummary,
  type LegacyBrowserSessionComparison,
  type LegacyBrowserStatePublicCaptureIdentity,
  type LegacyBrowserStateEntry,
  type LegacyBrowserStateKey,
  type LegacyRendererSkillsExport,
} from './legacy-browser-state.js';

const EVIDENCE_SCHEMA = 'lucid-fin.legacy-browser-state-migration-evidence/v2' as const;

export interface LegacyBrowserStateEntryEvidence {
  readonly key: LegacyBrowserStateKey;
  readonly state: 'present' | 'absent';
  readonly rawHash: string | null;
}

export interface LegacyBrowserStateMigrationEvidence {
  readonly schema: typeof EVIDENCE_SCHEMA;
  readonly snapshotFingerprint: string;
  readonly capture: LegacyBrowserStatePublicCaptureIdentity;
  readonly entries: readonly LegacyBrowserStateEntryEvidence[];
  readonly dispositions: Readonly<{
    targetUserSettings: readonly LegacyBrowserStateKey[];
    sessionEvidence: LegacyBrowserStateKey;
    skillRendererExport: LegacyBrowserStateKey;
    deleteOnCutover: readonly LegacyBrowserStateKey[];
  }>;
  readonly rendererExportHash: string;
  readonly sessionComparison: LegacyBrowserSessionComparison;
  readonly fingerprint: string;
  readonly ok: boolean;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function entryEvidence(entry: LegacyBrowserStateEntry): LegacyBrowserStateEntryEvidence {
  return {
    key: entry.key,
    state: entry.state,
    rawHash: entry.state === 'present' ? entry.rawHash : null,
  };
}

/** Reads stable Chat and Message identities only; no message content leaves this boundary. */
export function createLegacySqliteChatMirrorSummary(
  database: DatabaseSync,
): CanonicalSqliteChatMirrorSummary {
  const rows = database
    .prepare('SELECT id, messages FROM commander_sessions ORDER BY id')
    .all() as unknown as readonly { readonly id: unknown; readonly messages: unknown }[];
  const chats = rows.map((row) => {
    if (typeof row.id !== 'string' || typeof row.messages !== 'string') {
      throw new TypeError('Legacy SQLite Chat mirror row is invalid');
    }
    let messages: unknown;
    try {
      messages = JSON.parse(row.messages) as unknown;
    } catch (cause) {
      throw new TypeError(`Legacy SQLite Chat ${row.id} messages are invalid`, { cause });
    }
    if (!Array.isArray(messages)) {
      throw new TypeError(`Legacy SQLite Chat ${row.id} messages are not an array`);
    }
    const messageIds = messages.map((message) => {
      const candidate = record(message);
      if (typeof candidate?.id !== 'string') {
        throw new TypeError(`Legacy SQLite Chat ${row.id} contains a Message without an ID`);
      }
      return candidate.id;
    });
    return { chatId: row.id, messageIds };
  });
  return createCanonicalSqliteChatMirrorSummary({ chats });
}

/**
 * Binds one sealed browser snapshot to the Skill renderer export and the canonical SQLite mirror.
 * The returned report carries hashes and stable IDs only; raw localStorage values stay private.
 */
export function buildLegacyBrowserStateMigrationEvidence(input: {
  readonly snapshot: unknown;
  readonly rendererExport: LegacyRendererSkillsExport;
  readonly sqliteMirror: unknown;
}): LegacyBrowserStateMigrationEvidence {
  const snapshot = parseLegacyBrowserStateSnapshot(input.snapshot);
  const capturedRendererExport = toRendererSkillsExport(snapshot);
  if (canonicalJson(capturedRendererExport) !== canonicalJson(input.rendererExport)) {
    throw new TypeError('Legacy browser Skill export differs from the migration Skill bundle');
  }
  const groups = groupLegacyBrowserStateSnapshot(snapshot);
  const sessionComparison = compareLegacyBrowserSessionMirror(snapshot, input.sqliteMirror);
  const withoutFingerprint = {
    schema: EVIDENCE_SCHEMA,
    snapshotFingerprint: snapshot.fingerprint,
    capture: summarizeLegacyBrowserStateCaptureIdentity(snapshot),
    entries: snapshot.entries.map(entryEvidence),
    dispositions: {
      targetUserSettings: groups.targetUserSettings.map(({ key }) => key),
      sessionEvidence: groups.sessionEvidence.key,
      skillRendererExport: groups.skillRendererExport.key,
      deleteOnCutover: groups.deleteOnCutover.map(({ key }) => key),
    },
    rendererExportHash: capturedRendererExport.rawHash,
    sessionComparison,
    ok: sessionComparison.status !== 'blocking',
  };
  return Object.freeze({
    ...withoutFingerprint,
    fingerprint: hashCanonical(withoutFingerprint),
  });
}
