import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@lucid-fin/target-contracts';
import {
  LEGACY_BROWSER_STATE_KEYS,
  OPAQUE_FILE_STORAGE_ORIGIN,
  captureLegacyBrowserState,
  compareLegacyBrowserSessionMirror,
  createCanonicalSqliteChatMirrorSummary,
  createLegacyBrowserStateSnapshot,
  groupLegacyBrowserStateSnapshot,
  parseLegacyBrowserStateSnapshot,
  summarizeLegacyBrowserSessions,
  toRendererSkillsExport,
  validateLegacyBrowserStateSnapshot,
  type LegacyBrowserStateSnapshot,
} from './legacy-browser-state.js';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const rendererSkillsJson = canonicalJson({
  builtInCustoms: {},
  builtInNames: {},
  customSkills: [],
});

function values(overrides: Readonly<Record<string, string | null>> = {}) {
  return Object.fromEntries(
    LEGACY_BROWSER_STATE_KEYS.map((key) => [
      key,
      Object.hasOwn(overrides, key) ? overrides[key] : `captured:${key}`,
    ]),
  );
}

function capture(
  overrides: Readonly<Record<string, string | null>> = {},
  identityOverrides: Partial<{
    readonly captureRunId: string;
    readonly captureSessionId: string;
    readonly chromiumProfile: { readonly platform: 'win32'; readonly path: string };
    readonly origin: string;
    readonly challenge: string;
    readonly capturedAt: string;
  }> = {},
) {
  const captured = values({ 'lucid-skills-v2': rendererSkillsJson, ...overrides });
  return captureLegacyBrowserState(
    {
      captureRunId: 'capture-run-1',
      captureSessionId: 'capture-session-1',
      chromiumProfile: {
        platform: 'win32',
        path: 'C:/Users/Example/AppData/Local/Lucid/Profile 1',
      },
      origin: 'https://localhost:5173',
      challenge: 'A'.repeat(43),
      capturedAt: '2026-08-25T12:00:00.000Z',
      ...identityOverrides,
    },
    (key) => captured[key]!,
  );
}

function snapshot(
  overrides: Readonly<Record<string, string | null>> = {},
): LegacyBrowserStateSnapshot {
  return createLegacyBrowserStateSnapshot(capture(overrides));
}

function reseal(
  input: LegacyBrowserStateSnapshot,
  changes: Partial<Omit<LegacyBrowserStateSnapshot, 'fingerprint'>>,
): LegacyBrowserStateSnapshot {
  const withoutFingerprint = {
    schema: changes.schema ?? input.schema,
    capture: changes.capture ?? input.capture,
    entries: changes.entries ?? input.entries,
  };
  return {
    ...withoutFingerprint,
    fingerprint: sha256(canonicalJson(withoutFingerprint)),
  } as LegacyBrowserStateSnapshot;
}

describe('Legacy browser-state authority', () => {
  it('seals exactly the ten I0 keys from a trusted capture with explicit states and fixed disposition groups', () => {
    const complete = snapshot();
    const captured = snapshot({
      'lucid-commander-sessions-v1': null,
      'lucid-fin:onboarding-complete': null,
    });
    const parsed = parseLegacyBrowserStateSnapshot(captured);
    const groups = groupLegacyBrowserStateSnapshot(parsed);

    expect(parsed.capture.chromiumProfile).toEqual({
      platform: 'win32',
      path: 'C:\\Users\\Example\\AppData\\Local\\Lucid\\Profile 1',
    });
    expect(parsed.capture).toMatchObject({
      captureRunId: 'capture-run-1',
      captureSessionId: 'capture-session-1',
      origin: 'https://localhost:5173',
      challenge: 'A'.repeat(43),
    });
    expect(parsed.entries).toHaveLength(10);
    expect(parsed.entries.map(({ key }) => key)).toEqual(LEGACY_BROWSER_STATE_KEYS);
    expect(
      complete.entries.every((entry) => entry.state === 'present' && entry.rawValue.length > 0),
    ).toBe(true);
    expect(parsed.entries.find(({ key }) => key === 'lucid-commander-sessions-v1')).toEqual({
      key: 'lucid-commander-sessions-v1',
      state: 'absent',
    });
    expect(groups.targetUserSettings.map(({ key }) => key)).toEqual([
      'lucid-commander-provider-v1',
      'lucid-commander-settings-v1',
      'lucid-fin:locale',
      'lucid-fin:theme',
    ]);
    expect(groups.sessionEvidence.key).toBe('lucid-commander-sessions-v1');
    expect(groups.skillRendererExport.key).toBe('lucid-skills-v2');
    expect(groups.deleteOnCutover.map(({ key }) => key)).toEqual([
      'lucid-fin:onboarding-complete',
      'lucid-fin:left-canvas-panel-width',
      'lucid-fin:right-canvas-panel-width',
      'lucid-commander-first-session-seen',
    ]);
    expect(validateLegacyBrowserStateSnapshot(captured)).toMatchObject({ ok: true });
  });

  it('rejects unknown, duplicate, missing, noncanonical profile, and ambiguous origins', () => {
    const captured = snapshot();
    const duplicate = reseal(captured, {
      entries: [...captured.entries, captured.entries[0]!],
    });
    const unknown = reseal(captured, {
      entries: [
        ...captured.entries.slice(0, -1),
        { key: 'lucid-fin:unknown', state: 'absent' },
      ] as typeof captured.entries,
    });
    const missing = reseal(captured, { entries: captured.entries.slice(1) });

    expect(() => parseLegacyBrowserStateSnapshot(duplicate)).toThrow('entries');
    expect(() => parseLegacyBrowserStateSnapshot(unknown)).toThrow('entries');
    expect(() => parseLegacyBrowserStateSnapshot(missing)).toThrow('entries');
    expect(() =>
      captureLegacyBrowserState(
        {
          captureRunId: 'capture-run-1',
          captureSessionId: 'capture-session-1',
          chromiumProfile: { platform: 'win32', path: 'Profile 1' },
          origin: 'https://localhost:5173',
          challenge: 'A'.repeat(43),
          capturedAt: '2026-08-25T12:00:00.000Z',
        },
        () => null,
      ),
    ).toThrow('profile');
    expect(() =>
      captureLegacyBrowserState(
        {
          ...captured.capture,
          chromiumProfile: { platform: 'win32', path: 'C:\\Profiles\\Profile\u0000One' },
        },
        () => null,
      ),
    ).toThrow('ambiguous');
    expect(() =>
      captureLegacyBrowserState(
        {
          ...captured.capture,
          origin: 'https://localhost:5173/path',
        },
        () => null,
      ),
    ).toThrow('origin');
  });

  it('redacts an Electron file document URL to one opaque storage-origin identifier', () => {
    const documentPath = 'file:///C:/Users/Example/AppData/Local/Lucid/app/index.html';
    const captured = createLegacyBrowserStateSnapshot(capture({}, { origin: documentPath }));

    expect(captured.capture.origin).toBe(OPAQUE_FILE_STORAGE_ORIGIN);
    expect(canonicalJson(captured)).not.toContain('index.html');
    expect(() =>
      parseLegacyBrowserStateSnapshot(
        reseal(captured, { capture: { ...captured.capture, origin: documentPath } }),
      ),
    ).toThrow('capture is not normalized');
  });

  it('does not turn a failed trusted read into absent evidence and binds the capture challenge', () => {
    const failed = captureLegacyBrowserState(
      {
        captureRunId: 'capture-run-1',
        captureSessionId: 'capture-session-1',
        chromiumProfile: {
          platform: 'win32',
          path: 'C:/Users/Example/AppData/Local/Lucid/Profile 1',
        },
        origin: 'https://localhost:5173',
        challenge: 'A'.repeat(43),
        capturedAt: '2026-08-25T12:00:00.000Z',
      },
      (key) => {
        if (key === 'lucid-fin:theme') throw new Error('storage unavailable');
        return null;
      },
    );
    const withFirstChallenge = snapshot();
    const withSecondChallenge = createLegacyBrowserStateSnapshot(
      capture({}, { challenge: 'B'.repeat(43) }),
    );

    expect(failed.entries.find(({ key }) => key === 'lucid-fin:theme')).toEqual({
      key: 'lucid-fin:theme',
      state: 'capture_error',
    });
    expect(() => createLegacyBrowserStateSnapshot(failed)).toThrow('capture did not complete');
    expect(withFirstChallenge.fingerprint).not.toBe(withSecondChallenge.fingerprint);
  });

  it('rejects a caller-constructed capture object rather than accepting caller-supplied absent values', () => {
    const trusted = capture();
    expect(() =>
      createLegacyBrowserStateSnapshot({
        capture: snapshot().capture,
        entries: LEGACY_BROWSER_STATE_KEYS.map((key) => ({ key, state: 'absent' })),
      } as never),
    ).toThrow('trusted reader boundary');
    expect(() =>
      createLegacyBrowserStateSnapshot({
        ...trusted,
        entries: LEGACY_BROWSER_STATE_KEYS.map((key) => ({ key, state: 'absent' })),
      } as never),
    ).toThrow('trusted reader boundary');
  });

  it('rejects raw hashes and snapshot fingerprints that drift even when resealed', () => {
    const captured = snapshot();
    const entries = captured.entries.map((entry) => ({ ...entry }));
    const first = entries[0]!;
    expect(first.state).toBe('present');
    if (first.state !== 'present') throw new Error('fixture must be present');
    entries[0] = { ...first, rawHash: sha256('different bytes') };
    const hashDrift = reseal(captured, { entries });

    expect(() => parseLegacyBrowserStateSnapshot(hashDrift)).toThrow('raw hash');
    expect(() =>
      parseLegacyBrowserStateSnapshot({ ...captured, fingerprint: sha256('drift') }),
    ).toThrow('fingerprint');
  });

  it('converts the captured Skill entry to the existing renderer export shape with its exact hash', () => {
    const captured = snapshot();
    expect(toRendererSkillsExport(captured)).toEqual({
      storageKey: 'lucid-skills-v2',
      rawJson: rendererSkillsJson,
      rawHash: sha256(rendererSkillsJson),
    });
    const absent = toRendererSkillsExport(snapshot({ 'lucid-skills-v2': null }));
    expect(absent).toEqual({
      storageKey: 'lucid-skills-v2',
      rawJson: rendererSkillsJson,
      rawHash: sha256(rendererSkillsJson),
    });
  });

  it('compares only canonical stable Chat and Message IDs, and blocks any mismatch without a merge path', () => {
    const privateText = 'private session text must never appear in the comparison report';
    const browserSessions = canonicalJson([
      {
        id: 'chat.beta',
        messages: [{ id: 'message.beta', content: privateText }],
      },
      {
        id: 'chat.alpha',
        messages: [
          { id: 'message.alpha.2', content: privateText },
          { id: 'message.alpha.1', content: privateText },
        ],
      },
    ]);
    const captured = snapshot({ 'lucid-commander-sessions-v1': browserSessions });
    const sqlite = createCanonicalSqliteChatMirrorSummary({
      chats: [
        { chatId: 'chat.alpha', messageIds: ['message.alpha.1', 'message.alpha.2'] },
        { chatId: 'chat.beta', messageIds: ['message.beta'] },
      ],
    });
    const matched = compareLegacyBrowserSessionMirror(captured, sqlite);
    const blocking = compareLegacyBrowserSessionMirror(
      captured,
      createCanonicalSqliteChatMirrorSummary({
        chats: [
          { chatId: 'chat.alpha', messageIds: ['message.alpha.1'] },
          { chatId: 'chat.beta', messageIds: ['message.beta'] },
        ],
      }),
    );
    const noMirror = compareLegacyBrowserSessionMirror(
      snapshot({ 'lucid-commander-sessions-v1': null }),
      sqlite,
    );
    const presentEmpty = compareLegacyBrowserSessionMirror(
      snapshot({ 'lucid-commander-sessions-v1': canonicalJson([]) }),
      sqlite,
    );

    expect(summarizeLegacyBrowserSessions(captured)).toMatchObject({
      captureState: 'present',
      chatCount: 2,
      messageCount: 3,
      chats: [
        { chatId: 'chat.alpha', messageIds: ['message.alpha.1', 'message.alpha.2'] },
        { chatId: 'chat.beta', messageIds: ['message.beta'] },
      ],
    });
    expect(matched.status).toBe('matched');
    expect(blocking.status).toBe('blocking');
    expect(noMirror.status).toBe('no_mirror');
    expect(presentEmpty.status).toBe('blocking');
    expect(blocking.browser.chatIds).toEqual(['chat.alpha', 'chat.beta']);
    expect(blocking.sqlite.messageIds).toEqual(['message.alpha.1', 'message.beta']);
    expect(canonicalJson(blocking)).not.toContain(privateText);
  });
});
