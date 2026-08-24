const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ROOT_FIELDS = ['items', 'revision', 'updatedAt'] as const;
const ITEM_FIELDS = [
  'embeddedAudioEnabled',
  'selectedVideoHash',
  'shotId',
  'trimInMs',
  'trimOutMs',
] as const;

export type OrderedDeliverySequenceInvalidReason =
  | 'column_revision_invalid'
  | 'null_revision_mismatch'
  | 'empty_document'
  | 'not_text'
  | 'invalid_json'
  | 'not_object'
  | 'missing_field'
  | 'unexpected_field'
  | 'not_array'
  | 'not_string'
  | 'blank_string'
  | 'not_boolean'
  | 'not_nonnegative_integer'
  | 'not_positive_integer'
  | 'not_lowercase_sha256'
  | 'duplicate_shot_id'
  | 'trim_not_increasing'
  | 'revision_mismatch';

export interface OrderedDeliverySequenceIssue {
  readonly path: string;
  readonly reason: OrderedDeliverySequenceInvalidReason;
  readonly actual?: string;
}

export interface OrderedDeliverySequenceItem {
  readonly selectedVideoHash: string;
  readonly trimInMs: number;
  readonly trimOutMs: number;
  readonly embeddedAudioEnabled: boolean;
  readonly path: string;
}

export interface OrderedDeliverySequenceDocument {
  readonly revision: number;
  readonly items: readonly OrderedDeliverySequenceItem[];
}

export interface OrderedDeliverySequenceValidation {
  readonly columnRevision: number | null;
  readonly document: OrderedDeliverySequenceDocument | null;
  readonly issues: readonly OrderedDeliverySequenceIssue[];
}

export interface OrderedDeliveryVideoFact {
  readonly type: unknown;
  readonly duration: unknown;
  readonly hasAudio: unknown;
}

export type OrderedDeliveryVideoTargetIssue =
  | {
      readonly kind: 'missing';
      readonly path: string;
    }
  | {
      readonly kind: 'invalid';
      readonly path: string;
      readonly reason:
        | 'not_video'
        | 'duration_unavailable'
        | 'trim_exceeds_duration'
        | 'embedded_audio_unconfirmed';
    };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function valueType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Uint8Array) return 'blob';
  return typeof value;
}

function invalid(
  issues: OrderedDeliverySequenceIssue[],
  path: string,
  reason: OrderedDeliverySequenceInvalidReason,
  actual?: string,
): void {
  issues.push({ path, reason, ...(actual === undefined ? {} : { actual }) });
}

function validateFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: OrderedDeliverySequenceIssue[],
): void {
  const allowedFields = new Set(allowed);
  for (const field of Object.keys(value).sort()) {
    if (!allowedFields.has(field)) invalid(issues, `${path}.${field}`, 'unexpected_field');
  }
}

function requiredValue(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: OrderedDeliverySequenceIssue[],
): unknown {
  if (!Object.hasOwn(value, key)) {
    invalid(issues, path, 'missing_field');
    return undefined;
  }
  return value[key];
}

function positiveInteger(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: OrderedDeliverySequenceIssue[],
): number | undefined {
  const candidate = requiredValue(value, key, path, issues);
  if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate <= 0) {
    if (candidate !== undefined)
      invalid(issues, path, 'not_positive_integer', valueType(candidate));
    return undefined;
  }
  return candidate;
}

function nonnegativeInteger(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: OrderedDeliverySequenceIssue[],
): number | undefined {
  const candidate = requiredValue(value, key, path, issues);
  if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate) || candidate < 0) {
    if (candidate !== undefined) {
      invalid(issues, path, 'not_nonnegative_integer', valueType(candidate));
    }
    return undefined;
  }
  return candidate;
}

function nonblankString(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: OrderedDeliverySequenceIssue[],
): string | undefined {
  const candidate = requiredValue(value, key, path, issues);
  if (typeof candidate !== 'string') {
    if (candidate !== undefined) invalid(issues, path, 'not_string', valueType(candidate));
    return undefined;
  }
  if (!candidate.trim()) {
    invalid(issues, path, 'blank_string');
    return undefined;
  }
  return candidate;
}

function mediaHash(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: OrderedDeliverySequenceIssue[],
): string | undefined {
  const candidate = nonblankString(value, key, path, issues);
  if (candidate !== undefined && !SHA256_PATTERN.test(candidate)) {
    invalid(issues, path, 'not_lowercase_sha256');
    return undefined;
  }
  return candidate;
}

function booleanValue(
  value: Record<string, unknown>,
  key: string,
  path: string,
  issues: OrderedDeliverySequenceIssue[],
): boolean | undefined {
  const candidate = requiredValue(value, key, path, issues);
  if (typeof candidate !== 'boolean') {
    if (candidate !== undefined) invalid(issues, path, 'not_boolean', valueType(candidate));
    return undefined;
  }
  return candidate;
}

function databaseRevision(value: unknown): number | null {
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Validates the canonical OrderedDeliverySequence value used by live and snapshot rows. */
export function validateOrderedDeliverySequence(
  raw: unknown,
  columnRevisionValue: unknown,
): OrderedDeliverySequenceValidation {
  const issues: OrderedDeliverySequenceIssue[] = [];
  const columnRevision = databaseRevision(columnRevisionValue);
  if (columnRevision === null) {
    invalid(issues, '$column.delivery_sequence_revision', 'column_revision_invalid');
  }

  if (raw === null) {
    if (columnRevision !== null && columnRevision !== 0) {
      invalid(issues, '$.revision', 'null_revision_mismatch');
    }
    return { columnRevision, document: null, issues };
  }
  if (raw === '') {
    invalid(issues, '$', 'empty_document');
    return { columnRevision, document: null, issues };
  }
  if (typeof raw !== 'string') {
    invalid(issues, '$', 'not_text', valueType(raw));
    return { columnRevision, document: null, issues };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    invalid(issues, '$', 'invalid_json');
    return { columnRevision, document: null, issues };
  }
  if (!isObject(parsed)) {
    invalid(issues, '$', 'not_object', valueType(parsed));
    return { columnRevision, document: null, issues };
  }

  validateFields(parsed, ROOT_FIELDS, '$', issues);
  const revision = positiveInteger(parsed, 'revision', '$.revision', issues);
  nonnegativeInteger(parsed, 'updatedAt', '$.updatedAt', issues);
  const rawItems = requiredValue(parsed, 'items', '$.items', issues);
  if (!Array.isArray(rawItems)) {
    if (rawItems !== undefined) invalid(issues, '$.items', 'not_array', valueType(rawItems));
    return { columnRevision, document: null, issues };
  }

  const items: OrderedDeliverySequenceItem[] = [];
  const shotIds = new Set<string>();
  rawItems.forEach((rawItem, index) => {
    const path = `$.items[${index}]`;
    if (!isObject(rawItem)) {
      invalid(issues, path, 'not_object', valueType(rawItem));
      return;
    }
    validateFields(rawItem, ITEM_FIELDS, path, issues);
    const shotId = nonblankString(rawItem, 'shotId', `${path}.shotId`, issues);
    const selectedVideoHash = mediaHash(
      rawItem,
      'selectedVideoHash',
      `${path}.selectedVideoHash`,
      issues,
    );
    const trimInMs = nonnegativeInteger(rawItem, 'trimInMs', `${path}.trimInMs`, issues);
    const trimOutMs = nonnegativeInteger(rawItem, 'trimOutMs', `${path}.trimOutMs`, issues);
    const embeddedAudioEnabled = booleanValue(
      rawItem,
      'embeddedAudioEnabled',
      `${path}.embeddedAudioEnabled`,
      issues,
    );
    if (shotId !== undefined) {
      const normalizedShotId = shotId.trim();
      if (shotIds.has(normalizedShotId)) invalid(issues, `${path}.shotId`, 'duplicate_shot_id');
      shotIds.add(normalizedShotId);
    }
    if (trimInMs !== undefined && trimOutMs !== undefined && trimOutMs <= trimInMs) {
      invalid(issues, `${path}.trimOutMs`, 'trim_not_increasing');
    }
    if (
      selectedVideoHash !== undefined &&
      trimInMs !== undefined &&
      trimOutMs !== undefined &&
      embeddedAudioEnabled !== undefined
    ) {
      items.push({ selectedVideoHash, trimInMs, trimOutMs, embeddedAudioEnabled, path });
    }
  });

  if (revision !== undefined && columnRevision !== null && revision !== columnRevision) {
    invalid(issues, '$.revision', 'revision_mismatch');
  }
  return {
    columnRevision,
    document: issues.length === 0 && revision !== undefined ? { revision, items } : null,
    issues,
  };
}

function confirmedAudio(value: unknown): boolean {
  return value === 1 || value === 1n;
}

function durationSeconds(value: unknown): number | null {
  if (typeof value === 'bigint') {
    if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Validates the target facts required by one already-valid Delivery item. */
export function validateOrderedDeliveryVideoTarget(
  item: OrderedDeliverySequenceItem,
  asset: OrderedDeliveryVideoFact | undefined,
): readonly OrderedDeliveryVideoTargetIssue[] {
  if (!asset) return [{ kind: 'missing', path: `${item.path}.selectedVideoHash` }];
  if (asset.type !== 'video') {
    return [{ kind: 'invalid', path: `${item.path}.selectedVideoHash`, reason: 'not_video' }];
  }
  const duration = durationSeconds(asset.duration);
  if (duration === null) {
    return [
      { kind: 'invalid', path: `${item.path}.selectedVideoHash`, reason: 'duration_unavailable' },
    ];
  }
  const issues: OrderedDeliveryVideoTargetIssue[] = [];
  if (item.trimOutMs > Math.round(duration * 1_000)) {
    issues.push({
      kind: 'invalid',
      path: `${item.path}.trimOutMs`,
      reason: 'trim_exceeds_duration',
    });
  }
  if (item.embeddedAudioEnabled && !confirmedAudio(asset.hasAudio)) {
    issues.push({
      kind: 'invalid',
      path: `${item.path}.embeddedAudioEnabled`,
      reason: 'embedded_audio_unconfirmed',
    });
  }
  return issues;
}
