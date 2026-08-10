import type {
  CanvasSettings,
  CanvasVisualStylePolicy,
  VisualStyleGrammar,
  VisualStyleProvenance,
} from '@lucid-fin/contracts';

export type VisualStylePromptMode =
  | 'text-to-image'
  | 'image-to-image'
  | 'image-to-video'
  | 'text-to-video'
  | 'character-sheet'
  | 'voice'
  | 'music'
  | 'sfx';

export interface ResolvedCanvasVisualStyle {
  policy: CanvasVisualStylePolicy;
  provenance: VisualStyleProvenance;
}

export interface CompiledVisualStylePolicy {
  prompt?: string;
  negativePrompt?: string;
}

const STYLE_FIELDS: ReadonlyArray<[keyof VisualStyleGrammar, string]> = [
  ['medium', 'Medium'],
  ['era', 'Era'],
  ['rendering', 'Rendering'],
  ['linework', 'Linework'],
  ['palette', 'Palette'],
  ['lighting', 'Lighting'],
  ['texture', 'Texture'],
  ['mood', 'Mood'],
  ['cameraGrammar', 'Camera grammar'],
  ['lensGrammar', 'Lens grammar'],
  ['compositionGrammar', 'Composition grammar'],
  ['motionGrammar', 'Motion grammar'],
  ['characterAnchors', 'Character anchors'],
  ['locationAnchors', 'Location anchors'],
];

const I2V_FIELDS: ReadonlyArray<[keyof VisualStyleGrammar, string]> = [
  ['cameraGrammar', 'Camera grammar'],
  ['lensGrammar', 'Lens grammar'],
  ['compositionGrammar', 'Composition grammar'],
  ['motionGrammar', 'Motion grammar'],
];

/** Resolve the canonical Canvas draft, lazily wrapping legacy text columns. */
export function resolveCanvasVisualStylePolicy(
  settings: CanvasSettings | undefined,
): ResolvedCanvasVisualStyle | undefined {
  if (settings?.visualStylePolicy) {
    const policy = normalizeVisualStylePolicy(settings.visualStylePolicy);
    if (!hasPolicyContent(policy)) return undefined;
    return {
      policy,
      provenance: {
        source: 'canvas-draft',
        policyHash: fingerprintVisualStylePolicy(policy),
      },
    };
  }

  const summary = clean(settings?.stylePlate);
  const legacyNegative = clean(settings?.negativePrompt);
  if (!summary && !legacyNegative) return undefined;
  const policy: CanvasVisualStylePolicy = {
    version: 1,
    ...(summary ? { summary } : {}),
    ...(legacyNegative ? { negativeConstraints: [legacyNegative] } : {}),
  };
  return {
    policy,
    provenance: {
      source: 'legacy-style-plate',
      policyHash: fingerprintVisualStylePolicy(policy),
    },
  };
}

/** Compile a stable, mode-aware provider prompt fragment from one policy. */
export function compileVisualStylePolicy(
  policy: CanvasVisualStylePolicy | undefined,
  mode: VisualStylePromptMode,
): CompiledVisualStylePolicy {
  if (!policy || mode === 'voice' || mode === 'music' || mode === 'sfx') return {};
  const normalized = normalizeVisualStylePolicy(policy);
  const negativePrompt = uniqueStrings([
    ...(normalized.negativeConstraints ?? []),
    ...(normalized.locked?.negativeConstraints ?? []),
  ]).join(', ');

  if (mode === 'image-to-video') {
    const clauses = [
      "VISUAL STYLE AUTHORITY — image-to-video preservation lock: Preserve the source image's approved visual appearance, character identity, palette, lighting, texture, and rendering; do not restyle or redesign it.",
      ...formatGrammarFields(normalized.locked, I2V_FIELDS),
    ];
    if (normalized.allowedVariations?.length) {
      clauses.push(`Allowed variation only: ${normalized.allowedVariations.join('; ')}`);
    }
    return {
      prompt: clauses.join(' '),
      ...(negativePrompt ? { negativePrompt } : {}),
    };
  }

  const clauses = [
    'VISUAL STYLE AUTHORITY — preserve these constraints across every generated asset; later scene text must not reinterpret or replace them.',
  ];
  if (normalized.summary) clauses.push(`Direction: ${normalized.summary}`);
  clauses.push(...formatGrammarFields(normalized.locked, STYLE_FIELDS));
  if (normalized.allowedVariations?.length) {
    clauses.push(`Allowed shot-to-shot variation only: ${normalized.allowedVariations.join('; ')}`);
  }
  return {
    prompt: clauses.join(' '),
    ...(negativePrompt ? { negativePrompt } : {}),
  };
}

export function normalizeVisualStylePolicy(
  policy: CanvasVisualStylePolicy,
): CanvasVisualStylePolicy {
  const summary = clean(policy.summary);
  const locked = normalizeLocked(policy.locked);
  const allowedVariations = uniqueStrings(policy.allowedVariations ?? []);
  const negativeConstraints = uniqueStrings(policy.negativeConstraints ?? []);
  return {
    version: 1,
    ...(summary ? { summary } : {}),
    ...(locked && Object.keys(locked).length > 0 ? { locked } : {}),
    ...(allowedVariations.length > 0 ? { allowedVariations } : {}),
    ...(negativeConstraints.length > 0 ? { negativeConstraints } : {}),
  };
}

export function fingerprintVisualStylePolicy(policy: CanvasVisualStylePolicy): string {
  const canonical = stableStringify(normalizeVisualStylePolicy(policy));
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `vsp1-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function formatGrammarFields(
  locked: Partial<VisualStyleGrammar> | undefined,
  fields: ReadonlyArray<[keyof VisualStyleGrammar, string]>,
): string[] {
  if (!locked) return [];
  const output: string[] = [];
  for (const [key, label] of fields) {
    const value = locked[key];
    if (typeof value === 'string' && value.trim()) output.push(`${label}: ${value.trim()}`);
    if (Array.isArray(value) && value.length > 0) output.push(`${label}: ${value.join('; ')}`);
  }
  return output;
}

function normalizeLocked(
  locked: Partial<VisualStyleGrammar> | undefined,
): Partial<VisualStyleGrammar> | undefined {
  if (!locked) return undefined;
  const result: Partial<VisualStyleGrammar> = {};
  for (const [key] of STYLE_FIELDS) {
    const value = locked[key];
    if (typeof value === 'string') {
      const normalized = clean(value);
      if (normalized) (result as Record<string, unknown>)[key] = normalized;
    } else if (Array.isArray(value)) {
      const normalized = uniqueStrings(value);
      if (normalized.length > 0) (result as Record<string, unknown>)[key] = normalized;
    }
  }
  const negatives = uniqueStrings(locked.negativeConstraints ?? []);
  if (negatives.length > 0) result.negativeConstraints = negatives;
  return result;
}

function hasPolicyContent(policy: CanvasVisualStylePolicy): boolean {
  return Boolean(
    policy.summary ||
    (policy.locked && Object.keys(policy.locked).length > 0) ||
    policy.allowedVariations?.length ||
    policy.negativeConstraints?.length,
  );
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = clean(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function clean(value: string | undefined): string | undefined {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  return normalized || undefined;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const body = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
