import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@lucid-fin/target-contracts';
import {
  LEGACY_BROWSER_STATE_KEYS,
  captureLegacyBrowserState,
  createLegacyBrowserStateSnapshot,
  toRendererSkillsExport,
} from './legacy-browser-state.js';
import {
  buildLegacyBrowserStateMigrationEvidence,
  createLegacySqliteChatMirrorSummary,
} from './legacy-browser-state-migration.js';

function browserState(sessions: string | null) {
  const skills = canonicalJson({ builtInCustoms: {}, builtInNames: {}, customSkills: [] });
  const values = Object.fromEntries(
    LEGACY_BROWSER_STATE_KEYS.map((key) => {
      const rawValue =
        key === 'lucid-skills-v2'
          ? skills
          : key === 'lucid-commander-sessions-v1'
            ? sessions
            : `value:${key}`;
      return [key, rawValue];
    }),
  ) as Readonly<Record<(typeof LEGACY_BROWSER_STATE_KEYS)[number], string | null>>;
  return createLegacyBrowserStateSnapshot(
    captureLegacyBrowserState(
      {
        captureRunId: 'migration-run-1',
        captureSessionId: 'migration-session-1',
        chromiumProfile: { platform: 'win32', path: 'C:/Lucid/Profile 1' },
        origin: 'opaque:file',
        challenge: 'A'.repeat(43),
        capturedAt: '2026-08-25T12:00:00.000Z',
      },
      (key) => values[key],
    ),
  );
}

function database(messages: unknown[]) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE commander_sessions (id TEXT NOT NULL, messages TEXT NOT NULL)');
  db.prepare('INSERT INTO commander_sessions VALUES (?, ?)').run('chat.1', canonicalJson(messages));
  return db;
}

describe('Legacy browser-state migration evidence', () => {
  it('binds the Skill export and exact stable SQLite mirror without retaining private text', () => {
    const privateText = 'private text must not enter evidence';
    const snapshot = browserState(
      canonicalJson([{ id: 'chat.1', messages: [{ id: 'message.1', content: privateText }] }]),
    );
    const db = database([{ id: 'message.1', content: privateText }]);
    try {
      const evidence = buildLegacyBrowserStateMigrationEvidence({
        snapshot,
        rendererExport: toRendererSkillsExport(snapshot),
        sqliteMirror: createLegacySqliteChatMirrorSummary(db),
      });
      expect(evidence).toMatchObject({ ok: true, sessionComparison: { status: 'matched' } });
      expect(canonicalJson(evidence)).not.toContain(privateText);
      expect(canonicalJson(evidence)).not.toContain('Profile 1');
      expect(evidence.capture).toMatchObject({
        origin: 'opaque:file',
        profileFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(evidence.entries).toHaveLength(10);
    } finally {
      db.close();
    }
  });

  it('accepts an explicit absent mirror, blocks a present ID divergence, and rejects Skill drift', () => {
    const db = database([{ id: 'message.sqlite' }]);
    try {
      const absent = browserState(null);
      expect(
        buildLegacyBrowserStateMigrationEvidence({
          snapshot: absent,
          rendererExport: toRendererSkillsExport(absent),
          sqliteMirror: createLegacySqliteChatMirrorSummary(db),
        }).sessionComparison.status,
      ).toBe('no_mirror');

      const divergent = browserState(
        canonicalJson([{ id: 'chat.1', messages: [{ id: 'message.browser' }] }]),
      );
      expect(
        buildLegacyBrowserStateMigrationEvidence({
          snapshot: divergent,
          rendererExport: toRendererSkillsExport(divergent),
          sqliteMirror: createLegacySqliteChatMirrorSummary(db),
        }),
      ).toMatchObject({ ok: false, sessionComparison: { status: 'blocking' } });
      expect(() =>
        buildLegacyBrowserStateMigrationEvidence({
          snapshot: divergent,
          rendererExport: { ...toRendererSkillsExport(divergent), rawHash: '0'.repeat(64) },
          sqliteMirror: createLegacySqliteChatMirrorSummary(db),
        }),
      ).toThrow('Skill export differs');
    } finally {
      db.close();
    }
  });
});
