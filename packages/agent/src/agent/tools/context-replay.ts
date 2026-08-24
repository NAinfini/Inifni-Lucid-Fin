import type {
  ContextAuthority,
  ContextFactRelation,
  PublicContextFact,
} from '@lucid-fin/contracts';
import type {
  PublicToolProjection,
  ToolDefinition,
  ToolResult,
} from '../tool-registry.js';

type PublicProjector = NonNullable<ToolDefinition['projectPublicResult']>;
type FactCandidate = PublicContextFact | undefined;

export function contextProjector(
  selectFacts: (result: ToolResult, mergedArgs: Record<string, unknown>) => FactCandidate[],
  projectPublic?: PublicProjector,
): PublicProjector {
  return (result, mergedArgs) => {
    const projected: PublicToolProjection = projectPublic?.(result, mergedArgs) ?? {};
    if (result.success === false) {
      return { ...projected, context: { completeness: 'unavailable', facts: [] } };
    }
    const facts = selectFacts(result, mergedArgs).filter(
      (fact): fact is PublicContextFact => fact !== undefined,
    ).slice(0, 32);
    return {
      ...projected,
      context: facts.length > 0
        ? { completeness: 'complete', facts }
        : { completeness: 'unavailable', facts: [] },
    };
  };
}

export function authorityFact(
  authority: ContextAuthority,
  relation: ContextFactRelation,
  id: unknown,
  options: {
    scopeId?: unknown;
    revision?: unknown;
    contentHash?: unknown;
  } = {},
): PublicContextFact | undefined {
  const normalizedId = publicId(id);
  if (!normalizedId) return undefined;
  const scopeId = publicId(options.scopeId);
  const revision =
    typeof options.revision === 'number' &&
    Number.isSafeInteger(options.revision) &&
    options.revision >= 0
      ? options.revision
      : undefined;
  const contentHash =
    typeof options.contentHash === 'string' && /^[a-f0-9]{64}$/.test(options.contentHash)
      ? options.contentHash
      : undefined;
  return {
    kind: 'authority_ref',
    authority,
    relation,
    id: normalizedId,
    ...(scopeId ? { scopeId } : {}),
    ...(revision !== undefined ? { revision } : {}),
    ...(contentHash ? { contentHash } : {}),
  };
}

export function valueFact(key: string, value: unknown): PublicContextFact | undefined {
  const normalizedKey = key.trim().slice(0, 80);
  if (!normalizedKey) return undefined;
  if (value === null || typeof value === 'boolean') {
    return { kind: 'value', key: normalizedKey, value };
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { kind: 'value', key: normalizedKey, value };
  }
  if (typeof value === 'string') {
    return { kind: 'value', key: normalizedKey, value: value.slice(0, 240) };
  }
  return undefined;
}

export function resultRecord(result: ToolResult): Record<string, unknown> | undefined {
  return result.success === true ? record(result.data) : undefined;
}

export function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.map(record).filter((entry): entry is Record<string, unknown> => entry !== undefined)
    : [];
}

export function stringValues(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map(publicId).filter((entry): entry is string => entry !== undefined);
}

function publicId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().slice(0, 160);
  return normalized || undefined;
}
