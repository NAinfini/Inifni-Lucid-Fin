import { randomBytes } from 'node:crypto';
import { posix, win32 } from 'node:path';
import {
  IsoTimestampSchema,
  Sha256Schema,
  canonicalJson,
  parseCanonical,
  strictObject,
  z,
} from '@lucid-fin/target-contracts';
import { hashCanonical, hashUtf8 } from '../internal/hashes.js';

const SNAPSHOT_SCHEMA = 'lucid-fin.legacy-browser-state-snapshot/v2' as const;
const BROWSER_CHAT_MIRROR_SCHEMA = 'lucid-fin.legacy-browser-chat-mirror-summary/v1' as const;
const SQLITE_CHAT_MIRROR_SCHEMA = 'lucid-fin.canonical-sqlite-chat-mirror-summary/v1' as const;
const SESSION_COMPARISON_SCHEMA = 'lucid-fin.legacy-browser-session-comparison/v1' as const;
const EMPTY_RENDERER_SKILLS_JSON = canonicalJson({
  builtInCustoms: {},
  builtInNames: {},
  customSkills: [],
});
const MAX_RAW_VALUE_LENGTH = 8_000_000;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,159}$/;
const CAPTURE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const trustedCaptureBrand: unique symbol = Symbol('legacy-browser-state-trusted-capture');
const trustedCaptures = new WeakSet<object>();

/** The only persisted identifier for file:// or opaque Electron storage. */
export const OPAQUE_FILE_STORAGE_ORIGIN = 'opaque:file' as const;

export const LEGACY_BROWSER_STATE_KEYS = [
  'lucid-commander-provider-v1',
  'lucid-commander-sessions-v1',
  'lucid-commander-settings-v1',
  'lucid-skills-v2',
  'lucid-fin:locale',
  'lucid-fin:theme',
  'lucid-fin:onboarding-complete',
  'lucid-fin:left-canvas-panel-width',
  'lucid-fin:right-canvas-panel-width',
  'lucid-commander-first-session-seen',
] as const;

export type LegacyBrowserStateKey = (typeof LEGACY_BROWSER_STATE_KEYS)[number];

export interface ChromiumProfileIdentifier {
  readonly platform: 'win32' | 'posix';
  readonly path: string;
}

/** Identity supplied by the coordinator before its trusted localStorage reader starts. */
export interface LegacyBrowserStateCaptureIdentity {
  readonly captureRunId: string;
  readonly captureSessionId: string;
  readonly chromiumProfile: ChromiumProfileIdentifier;
  readonly origin: string;
  readonly challenge: string;
  readonly capturedAt: string;
}

export type LegacyBrowserStateCaptureEntry =
  | { readonly key: LegacyBrowserStateKey; readonly state: 'absent' }
  | { readonly key: LegacyBrowserStateKey; readonly state: 'present'; readonly rawValue: string }
  | { readonly key: LegacyBrowserStateKey; readonly state: 'capture_error' };

/**
 * Branded result of the only supported capture boundary. Callers cannot construct this from a
 * hand-authored values object, so an absent state always follows a successful reader invocation.
 */
export interface LegacyBrowserStateTrustedCapture {
  readonly [trustedCaptureBrand]: true;
  readonly identity: LegacyBrowserStateCaptureIdentity;
  readonly entries: readonly LegacyBrowserStateCaptureEntry[];
}

export type LegacyBrowserStateEntry =
  | { readonly key: LegacyBrowserStateKey; readonly state: 'absent' }
  | {
      readonly key: LegacyBrowserStateKey;
      readonly state: 'present';
      readonly rawValue: string;
      readonly rawHash: string;
    };

export interface LegacyBrowserStateSnapshot {
  readonly schema: typeof SNAPSHOT_SCHEMA;
  readonly capture: LegacyBrowserStateCaptureIdentity;
  readonly entries: readonly LegacyBrowserStateEntry[];
  readonly fingerprint: string;
}

/** Safe-to-publish capture identity. It deliberately contains no absolute profile path. */
export interface LegacyBrowserStatePublicCaptureIdentity {
  readonly captureRunFingerprint: string;
  readonly captureSessionFingerprint: string;
  readonly profileFingerprint: string;
  readonly origin: string;
  readonly challengeFingerprint: string;
  readonly capturedAt: string;
  readonly fingerprint: string;
}

export type LegacyBrowserStateValidationResult =
  | { readonly ok: true; readonly snapshot: LegacyBrowserStateSnapshot }
  | { readonly ok: false; readonly error: 'invalid_legacy_browser_state_snapshot' };

export interface LegacyBrowserStateDispositionGroups {
  readonly targetUserSettings: readonly LegacyBrowserStateEntry[];
  readonly sessionEvidence: LegacyBrowserStateEntry;
  readonly skillRendererExport: LegacyBrowserStateEntry;
  readonly deleteOnCutover: readonly LegacyBrowserStateEntry[];
}

/** Structurally identical to the renderer export accepted by legacy-skill-migration. */
export interface LegacyRendererSkillsExport {
  readonly storageKey: 'lucid-skills-v2';
  readonly rawJson: string;
  readonly rawHash: string;
}

export interface LegacyBrowserChatMirrorSummary {
  readonly schema: typeof BROWSER_CHAT_MIRROR_SCHEMA;
  readonly captureState: 'present' | 'absent';
  readonly chats: readonly CanonicalChatMirrorEntry[];
  readonly chatIds: readonly string[];
  readonly messageIds: readonly string[];
  readonly chatCount: number;
  readonly messageCount: number;
  readonly fingerprint: string;
}

export interface CanonicalSqliteChatMirrorSummary {
  readonly schema: typeof SQLITE_CHAT_MIRROR_SCHEMA;
  readonly chats: readonly CanonicalChatMirrorEntry[];
  readonly chatIds: readonly string[];
  readonly messageIds: readonly string[];
  readonly chatCount: number;
  readonly messageCount: number;
  readonly fingerprint: string;
}

export interface LegacyBrowserSessionComparison {
  readonly schema: typeof SESSION_COMPARISON_SCHEMA;
  readonly status: 'matched' | 'no_mirror' | 'blocking';
  readonly browser: LegacyBrowserChatMirrorSummary;
  readonly sqlite: CanonicalSqliteChatMirrorSummary;
  readonly fingerprint: string;
}

interface CanonicalChatMirrorEntry {
  readonly chatId: string;
  readonly messageIds: readonly string[];
}

const ChromiumProfileIdentifierSchema = strictObject({
  platform: z.enum(['win32', 'posix']),
  path: z.string().min(1).max(4_096),
});

const CaptureIdentitySchema = strictObject({
  captureRunId: z.string().min(1).max(160),
  captureSessionId: z.string().min(1).max(160),
  chromiumProfile: ChromiumProfileIdentifierSchema,
  origin: z.string().min(1).max(2_048),
  challenge: z.string().min(1).max(160),
  capturedAt: IsoTimestampSchema,
});

const StoredEntrySchema = z.union([
  strictObject({ key: z.string(), state: z.literal('absent') }),
  strictObject({
    key: z.string(),
    state: z.literal('present'),
    rawValue: z.string().max(MAX_RAW_VALUE_LENGTH),
    rawHash: Sha256Schema,
  }),
]);

const SnapshotSchema = strictObject({
  schema: z.literal(SNAPSHOT_SCHEMA),
  capture: CaptureIdentitySchema,
  entries: z.array(StoredEntrySchema),
  fingerprint: Sha256Schema,
});

const ChatMirrorEntrySchema = strictObject({
  chatId: z.string(),
  messageIds: z.array(z.string()),
});

const SqliteChatMirrorInputSchema = strictObject({ chats: z.array(ChatMirrorEntrySchema) });

const SqliteChatMirrorSummarySchema = strictObject({
  schema: z.literal(SQLITE_CHAT_MIRROR_SCHEMA),
  chats: z.array(ChatMirrorEntrySchema),
  chatIds: z.array(z.string()),
  messageIds: z.array(z.string()),
  chatCount: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  fingerprint: Sha256Schema,
});

function fail(detail: string): never {
  throw new TypeError(`Legacy browser state ${detail}`);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertUtf8(value: string, label: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) fail(`${label} is not valid UTF-8`);
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail(`${label} is not valid UTF-8`);
    }
  }
}

function normalizeChromiumProfileIdentifier(
  value: ChromiumProfileIdentifier,
): ChromiumProfileIdentifier {
  assertUtf8(value.path, 'profile path');
  if (containsAsciiControl(value.path)) fail('profile path is ambiguous');
  const pathApi = value.platform === 'win32' ? win32 : posix;
  if (!pathApi.isAbsolute(value.path)) fail('profile path must be absolute');
  const normalized = pathApi.normalize(value.path);
  const root = pathApi.parse(normalized).root;
  if (!pathApi.isAbsolute(normalized) || normalized === root) {
    fail('profile path must identify a Chromium profile directory');
  }
  return { platform: value.platform, path: normalized };
}

function containsAsciiControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x1f || unit === 0x7f) return true;
  }
  return false;
}

function assertCaptureIdentifier(value: string, label: string): void {
  assertUtf8(value, label);
  if (!STABLE_ID_PATTERN.test(value)) fail(`${label} is invalid`);
}

function normalizeCaptureIdentity(
  value: LegacyBrowserStateCaptureIdentity,
): LegacyBrowserStateCaptureIdentity {
  let input: z.output<typeof CaptureIdentitySchema>;
  try {
    input = parseCanonical(CaptureIdentitySchema, value);
  } catch {
    fail('capture identity is invalid');
  }
  assertCaptureIdentifier(input.captureRunId, 'capture run ID');
  assertCaptureIdentifier(input.captureSessionId, 'capture session ID');
  if (!CAPTURE_CHALLENGE_PATTERN.test(input.challenge)) {
    fail('capture challenge must be a 256-bit base64url nonce');
  }
  return Object.freeze({
    captureRunId: input.captureRunId,
    captureSessionId: input.captureSessionId,
    chromiumProfile: Object.freeze(normalizeChromiumProfileIdentifier(input.chromiumProfile)),
    origin: normalizeBrowserOrigin(input.origin),
    challenge: input.challenge,
    capturedAt: input.capturedAt,
  });
}

function normalizeBrowserOrigin(value: string): string {
  assertUtf8(value, 'origin');
  if (value !== value.trim()) fail('origin is ambiguous');
  if (value === OPAQUE_FILE_STORAGE_ORIGIN) return value;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail('origin is invalid');
  }
  if (parsed.protocol === 'file:') {
    if (
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.host !== '' ||
      parsed.pathname === '/' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      fail('file storage origin is ambiguous');
    }
    return OPAQUE_FILE_STORAGE_ORIGIN;
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.origin === 'null' ||
    parsed.origin !== value
  ) {
    fail('origin must be an unambiguous canonical http or https origin');
  }
  return parsed.origin;
}

function assertStableId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !STABLE_ID_PATTERN.test(value)) fail(`${label} is invalid`);
}

function snapshotFingerprintInput(snapshot: Omit<LegacyBrowserStateSnapshot, 'fingerprint'>) {
  return {
    schema: snapshot.schema,
    capture: snapshot.capture,
    entries: snapshot.entries,
  };
}

function assertExactCaptureEntries(entries: readonly LegacyBrowserStateCaptureEntry[]): void {
  if (entries.length !== LEGACY_BROWSER_STATE_KEYS.length) {
    fail('capture entries must contain every I0 localStorage key exactly once');
  }
  for (const [index, entry] of entries.entries()) {
    if (entry.key !== LEGACY_BROWSER_STATE_KEYS[index]) {
      fail('capture entries are unknown, duplicate, missing, or not canonically ordered');
    }
    if (entry.state === 'capture_error') fail(`capture did not complete for ${entry.key}`);
    if (entry.state === 'present') assertUtf8(entry.rawValue, `entry ${entry.key}`);
  }
}

function assertExactEntries(entries: readonly LegacyBrowserStateEntry[]): void {
  if (entries.length !== LEGACY_BROWSER_STATE_KEYS.length) {
    fail('entries must contain every I0 localStorage key exactly once');
  }
  for (const [index, entry] of entries.entries()) {
    if (entry.key !== LEGACY_BROWSER_STATE_KEYS[index]) {
      fail('entries are unknown, duplicate, missing, or not canonically ordered');
    }
    if (entry.state === 'present') {
      assertUtf8(entry.rawValue, `entry ${entry.key}`);
      if (hashUtf8(entry.rawValue) !== entry.rawHash) {
        fail(`entry ${entry.key} raw hash does not match`);
      }
    }
  }
}

function storedEntryByKey(
  snapshot: LegacyBrowserStateSnapshot,
  key: LegacyBrowserStateKey,
): LegacyBrowserStateEntry {
  const entry = snapshot.entries[LEGACY_BROWSER_STATE_KEYS.indexOf(key)];
  if (entry === undefined) fail(`entry ${key} is missing`);
  return entry;
}

/** Generates a fresh 256-bit challenge for one trusted capture request. */
export function createLegacyBrowserStateCaptureChallenge(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Captures each fixed localStorage key through the supplied trusted reader only. This boundary never
 * reads Chromium itself; a reader failure remains capture_error and therefore cannot become absent.
 */
export function captureLegacyBrowserState(
  identityValue: LegacyBrowserStateCaptureIdentity,
  readLocalStorageValue: (key: LegacyBrowserStateKey) => string | null,
): LegacyBrowserStateTrustedCapture {
  const identity = normalizeCaptureIdentity(identityValue);
  const entries = Object.freeze(
    LEGACY_BROWSER_STATE_KEYS.map((key): LegacyBrowserStateCaptureEntry => {
      let rawValue: unknown;
      try {
        rawValue = readLocalStorageValue(key);
      } catch {
        return Object.freeze({ key, state: 'capture_error' } as const);
      }
      if (rawValue === null) return Object.freeze({ key, state: 'absent' } as const);
      if (typeof rawValue === 'string') {
        return Object.freeze({ key, state: 'present', rawValue } as const);
      }
      return Object.freeze({ key, state: 'capture_error' } as const);
    }),
  );
  const capture = {
    identity,
    entries,
  };
  Object.defineProperty(capture, trustedCaptureBrand, { value: true });
  trustedCaptures.add(capture);
  return Object.freeze(capture) as LegacyBrowserStateTrustedCapture;
}

function isTrustedCapture(value: unknown): value is LegacyBrowserStateTrustedCapture {
  return value !== null && typeof value === 'object' && trustedCaptures.has(value);
}

/** Builds a sealed snapshot from the trusted capture boundary without reading a browser profile directly. */
export function createLegacyBrowserStateSnapshot(
  captureValue: LegacyBrowserStateTrustedCapture,
): LegacyBrowserStateSnapshot {
  if (!isTrustedCapture(captureValue)) fail('capture must come from the trusted reader boundary');
  const capture = normalizeCaptureIdentity(captureValue.identity);
  assertExactCaptureEntries(captureValue.entries);
  const entries = captureValue.entries.map((entry): LegacyBrowserStateEntry => {
    if (entry.state === 'absent')
      return { key: entry.key as LegacyBrowserStateKey, state: 'absent' };
    if (entry.state === 'capture_error') fail(`capture did not complete for ${entry.key}`);
    assertUtf8(entry.rawValue, `entry ${entry.key}`);
    return {
      key: entry.key as LegacyBrowserStateKey,
      state: 'present',
      rawValue: entry.rawValue,
      rawHash: hashUtf8(entry.rawValue),
    };
  });
  assertExactEntries(entries);
  const withoutFingerprint: Omit<LegacyBrowserStateSnapshot, 'fingerprint'> = {
    schema: SNAPSHOT_SCHEMA,
    capture,
    entries,
  };
  return parseLegacyBrowserStateSnapshot({
    ...withoutFingerprint,
    fingerprint: hashCanonical(snapshotFingerprintInput(withoutFingerprint)),
  });
}

/** Parses a serialized snapshot and proves every captured value and binding. */
export function parseLegacyBrowserStateSnapshot(value: unknown): LegacyBrowserStateSnapshot {
  let parsed: z.output<typeof SnapshotSchema>;
  try {
    parsed = parseCanonical(SnapshotSchema, value);
  } catch {
    fail('snapshot shape is invalid');
  }
  const snapshot = parsed as LegacyBrowserStateSnapshot;
  const canonicalCapture = normalizeCaptureIdentity(snapshot.capture);
  if (canonicalJson(canonicalCapture) !== canonicalJson(snapshot.capture))
    fail('capture is not normalized');
  assertExactEntries(snapshot.entries);
  if (hashCanonical(snapshotFingerprintInput(snapshot)) !== snapshot.fingerprint) {
    fail('snapshot fingerprint does not match');
  }
  return snapshot;
}

/** Returns an intentionally non-throwing boundary verdict without exposing captured values. */
export function validateLegacyBrowserStateSnapshot(
  value: unknown,
): LegacyBrowserStateValidationResult {
  try {
    return { ok: true, snapshot: parseLegacyBrowserStateSnapshot(value) };
  } catch {
    return { ok: false, error: 'invalid_legacy_browser_state_snapshot' };
  }
}

/**
 * Returns the capture bindings that may leave the private evidence boundary. Profile, run, session,
 * and challenge values are irreversible fingerprints so public dry-run reports never disclose a path.
 */
export function summarizeLegacyBrowserStateCaptureIdentity(
  snapshotValue: unknown,
): LegacyBrowserStatePublicCaptureIdentity {
  const capture = parseLegacyBrowserStateSnapshot(snapshotValue).capture;
  const withoutFingerprint = {
    captureRunFingerprint: hashUtf8(capture.captureRunId),
    captureSessionFingerprint: hashUtf8(capture.captureSessionId),
    profileFingerprint: hashCanonical(capture.chromiumProfile),
    origin: capture.origin,
    challengeFingerprint: hashUtf8(capture.challenge),
    capturedAt: capture.capturedAt,
  };
  return Object.freeze({ ...withoutFingerprint, fingerprint: hashCanonical(withoutFingerprint) });
}

/** Partitions every frozen key by its only allowed I0 disposition. */
export function groupLegacyBrowserStateSnapshot(
  snapshotValue: unknown,
): LegacyBrowserStateDispositionGroups {
  const snapshot = parseLegacyBrowserStateSnapshot(snapshotValue);
  return Object.freeze({
    targetUserSettings: Object.freeze([
      storedEntryByKey(snapshot, 'lucid-commander-provider-v1'),
      storedEntryByKey(snapshot, 'lucid-commander-settings-v1'),
      storedEntryByKey(snapshot, 'lucid-fin:locale'),
      storedEntryByKey(snapshot, 'lucid-fin:theme'),
    ]),
    sessionEvidence: storedEntryByKey(snapshot, 'lucid-commander-sessions-v1'),
    skillRendererExport: storedEntryByKey(snapshot, 'lucid-skills-v2'),
    deleteOnCutover: Object.freeze([
      storedEntryByKey(snapshot, 'lucid-fin:onboarding-complete'),
      storedEntryByKey(snapshot, 'lucid-fin:left-canvas-panel-width'),
      storedEntryByKey(snapshot, 'lucid-fin:right-canvas-panel-width'),
      storedEntryByKey(snapshot, 'lucid-commander-first-session-seen'),
    ]),
  });
}

/** Produces the exact captured Skill export, or the canonical empty export when the key is absent. */
export function toRendererSkillsExport(snapshotValue: unknown): LegacyRendererSkillsExport {
  const entry = storedEntryByKey(parseLegacyBrowserStateSnapshot(snapshotValue), 'lucid-skills-v2');
  if (entry.state === 'absent') {
    return Object.freeze({
      storageKey: 'lucid-skills-v2',
      rawJson: EMPTY_RENDERER_SKILLS_JSON,
      rawHash: hashUtf8(EMPTY_RENDERER_SKILLS_JSON),
    });
  }
  if (entry.rawValue.length === 0) fail('Skill renderer export is empty');
  return Object.freeze({
    storageKey: 'lucid-skills-v2',
    rawJson: entry.rawValue,
    rawHash: entry.rawHash,
  });
}

function canonicalizeChatEntries(
  entries: readonly { readonly chatId: string; readonly messageIds: readonly string[] }[],
): readonly CanonicalChatMirrorEntry[] {
  const chatIds = new Set<string>();
  const messageIds = new Set<string>();
  const canonical = entries.map(({ chatId, messageIds: sourceMessageIds }) => {
    assertStableId(chatId, 'Chat ID');
    if (chatIds.has(chatId)) fail('Chat IDs are duplicated');
    chatIds.add(chatId);
    const sortedMessageIds = [...sourceMessageIds].map((messageId) => {
      assertStableId(messageId, 'Message ID');
      if (messageIds.has(messageId)) fail('Message IDs are duplicated');
      messageIds.add(messageId);
      return messageId;
    });
    sortedMessageIds.sort(compareText);
    return { chatId, messageIds: sortedMessageIds };
  });
  canonical.sort((left, right) => compareText(left.chatId, right.chatId));
  return canonical;
}

function browserChatMirrorSummary(
  captureState: LegacyBrowserChatMirrorSummary['captureState'],
  chats: readonly CanonicalChatMirrorEntry[],
): LegacyBrowserChatMirrorSummary {
  const chatIds = chats.map(({ chatId }) => chatId);
  const messageIds = chats.flatMap(({ messageIds: ids }) => ids).sort(compareText);
  const withoutFingerprint = {
    schema: BROWSER_CHAT_MIRROR_SCHEMA,
    captureState,
    chats,
    chatIds,
    messageIds,
    chatCount: chats.length,
    messageCount: messageIds.length,
  };
  return Object.freeze({ ...withoutFingerprint, fingerprint: hashCanonical(withoutFingerprint) });
}

function sqliteChatMirrorSummary(
  chats: readonly CanonicalChatMirrorEntry[],
): CanonicalSqliteChatMirrorSummary {
  const chatIds = chats.map(({ chatId }) => chatId);
  const messageIds = chats.flatMap(({ messageIds: ids }) => ids).sort(compareText);
  const withoutFingerprint = {
    schema: SQLITE_CHAT_MIRROR_SCHEMA,
    chats,
    chatIds,
    messageIds,
    chatCount: chats.length,
    messageCount: messageIds.length,
  };
  return Object.freeze({ ...withoutFingerprint, fingerprint: hashCanonical(withoutFingerprint) });
}

function parseBrowserSessionChats(
  snapshot: LegacyBrowserStateSnapshot,
): readonly CanonicalChatMirrorEntry[] {
  const entry = storedEntryByKey(snapshot, 'lucid-commander-sessions-v1');
  if (entry.state === 'absent') return [];
  let payload: unknown;
  try {
    payload = JSON.parse(entry.rawValue);
  } catch {
    fail('session evidence JSON is invalid');
  }
  if (!Array.isArray(payload)) fail('session evidence must be an array');
  const chats = payload.map((session) => {
    if (session === null || typeof session !== 'object' || Array.isArray(session)) {
      fail('session evidence contains an invalid Chat');
    }
    const record = session as Record<string, unknown>;
    if (
      !Object.hasOwn(record, 'id') ||
      !Object.hasOwn(record, 'messages') ||
      !Array.isArray(record.messages)
    ) {
      fail('session evidence is missing stable IDs');
    }
    const messageIds = record.messages.map((message) => {
      if (message === null || typeof message !== 'object' || Array.isArray(message)) {
        fail('session evidence contains an invalid Message');
      }
      const messageRecord = message as Record<string, unknown>;
      if (!Object.hasOwn(messageRecord, 'id')) fail('session evidence is missing stable IDs');
      return messageRecord.id;
    });
    return { chatId: record.id, messageIds };
  });
  return canonicalizeChatEntries(chats as readonly CanonicalChatMirrorEntry[]);
}

/** Reduces browser session evidence to stable identifiers only; no Message text is retained. */
export function summarizeLegacyBrowserSessions(
  snapshotValue: unknown,
): LegacyBrowserChatMirrorSummary {
  const snapshot = parseLegacyBrowserStateSnapshot(snapshotValue);
  const captureState = storedEntryByKey(snapshot, 'lucid-commander-sessions-v1').state;
  return browserChatMirrorSummary(captureState, parseBrowserSessionChats(snapshot));
}

/** Canonicalizes a caller-supplied SQLite Chat mirror before it can be compared. */
export function createCanonicalSqliteChatMirrorSummary(
  inputValue: unknown,
): CanonicalSqliteChatMirrorSummary {
  let input: z.output<typeof SqliteChatMirrorInputSchema>;
  try {
    input = parseCanonical(SqliteChatMirrorInputSchema, inputValue);
  } catch {
    fail('SQLite Chat mirror input is invalid');
  }
  return sqliteChatMirrorSummary(canonicalizeChatEntries(input.chats));
}

/** Validates that a supplied SQLite summary is canonical, complete, and self-fingerprinted. */
export function parseCanonicalSqliteChatMirrorSummary(
  value: unknown,
): CanonicalSqliteChatMirrorSummary {
  let parsed: z.output<typeof SqliteChatMirrorSummarySchema>;
  try {
    parsed = parseCanonical(SqliteChatMirrorSummarySchema, value);
  } catch {
    fail('SQLite Chat mirror summary is invalid');
  }
  const summary = parsed as CanonicalSqliteChatMirrorSummary;
  const expected = sqliteChatMirrorSummary(canonicalizeChatEntries(summary.chats));
  if (canonicalJson(expected) !== canonicalJson(summary)) {
    fail('SQLite Chat mirror summary is not canonical');
  }
  return summary;
}

/** Compares IDs only. Any divergence is blocking and this module intentionally has no merge path. */
export function compareLegacyBrowserSessionMirror(
  snapshotValue: unknown,
  sqliteSummaryValue: unknown,
): LegacyBrowserSessionComparison {
  const browser = summarizeLegacyBrowserSessions(snapshotValue);
  const sqlite = parseCanonicalSqliteChatMirrorSummary(sqliteSummaryValue);
  const status: LegacyBrowserSessionComparison['status'] =
    browser.captureState === 'absent'
      ? 'no_mirror'
      : canonicalJson(browser.chats) === canonicalJson(sqlite.chats)
        ? 'matched'
        : 'blocking';
  const withoutFingerprint = { schema: SESSION_COMPARISON_SCHEMA, status, browser, sqlite };
  return Object.freeze({ ...withoutFingerprint, fingerprint: hashCanonical(withoutFingerprint) });
}
