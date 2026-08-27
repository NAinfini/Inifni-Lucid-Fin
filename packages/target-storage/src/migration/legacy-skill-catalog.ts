import { createHash } from 'node:crypto';
import {
  LegacySkillContentV1Schema,
  SkillDocumentSchema,
  canonicalJson,
  parseCanonical,
  type JsonValue,
  type LegacySkillContentV1,
  type LegacySkillSourceKind,
  type SkillDocument,
} from '@lucid-fin/target-contracts';

export const LEGACY_SKILL_CREATED_AT = '2026-08-17T00:00:00.000Z' as const;
export const BUILT_IN_LEGACY_SKILL_COUNTS = Object.freeze({
  preset: 216,
  shot_template: 19,
  renderer_skill: 26,
  process_prompt: 21,
  prompt_template: 5,
} as const);
export const BUILT_IN_LEGACY_SKILL_COUNT = 287;

export const LEGACY_SKILL_DISPOSITIONS_V1 = Object.freeze([
  {
    paths: ['packages/contracts/src/dto/presets/library.ts'],
    classification: 'migrated_source',
    reason: 'Defines the 216 canonical built-in preset records in the immutable pack.',
  },
  {
    paths: [
      'packages/contracts/src/dto/presets/params.ts',
      'packages/contracts/src/dto/presets/prompts.ts',
      'packages/contracts/src/dto/presets/templates-a.ts..templates-f.ts',
      'packages/contracts/src/dto/presets/templates-types.ts',
    ],
    classification: 'migrated_source',
    reason: 'Inputs folded into the 216 preset records; they are not additional source records.',
  },
  {
    paths: ['packages/contracts/src/dto/presets/shot-templates.ts'],
    classification: 'migrated_source',
    reason: 'Defines the 19 canonical built-in shot-template records in the immutable pack.',
  },
  {
    paths: ['apps/desktop-renderer/src/store/slices/skillDefinitions.ts'],
    classification: 'migrated_source',
    reason:
      'The slice explicitly imports exactly 26 bundled Markdown guides into immutable renderer Skill records.',
  },
  {
    paths: ['packages/storage/src/process-prompt-store.ts'],
    classification: 'migrated_source',
    reason: 'Defines 21 process prompts; overrides are supplied by the strict cutover bundle.',
  },
  {
    paths: ['packages/storage/src/prompt-store.ts'],
    classification: 'migrated_source',
    reason: 'Defines 5 prompt templates; overrides are supplied by the strict cutover bundle.',
  },
  {
    paths: [
      'packages/storage/src/repositories/preset-repository.ts',
      'packages/storage/src/repositories/shot-template-repository.ts',
    ],
    classification: 'migrated_source',
    reason:
      'Persistence boundaries for custom/override records already represented by the dynamic bundle.',
  },
  {
    paths: ['packages/application/src/template-manager.ts'],
    classification: 'runtime_domain_data',
    reason:
      'SceneTemplate stores scene orchestration data and nodes, not reusable model instructions.',
  },
  {
    paths: [
      'apps/desktop-renderer/src/store/slices/presets.ts',
      'apps/desktop-renderer/src/store/slices/shotTemplates.ts',
      'apps/desktop-renderer/src/store/slices/canvas/canvas-preset-reducers.ts',
    ],
    classification: 'runtime_domain_data',
    reason:
      'UI state and reducers consume the counted preset/template records; they define no additional source catalog.',
  },
  {
    paths: [
      'apps/desktop-main/src/ipc/handlers/preset.service.ts',
      'apps/desktop-main/src/ipc/handlers/preset.handlers.ts',
      'packages/application/src/preset-export.ts',
    ],
    classification: 'runtime_domain_data',
    reason:
      'CRUD and import/export transport over the already-counted preset records, not separate Skills.',
  },
  {
    paths: [
      'packages/agent/src/agent/tools/preset-tools.ts',
      'packages/agent/src/agent/tools/canvas-preset-tools.ts',
    ],
    classification: 'runtime_domain_data',
    reason:
      'Typed domain tool adapters operate on preset data and contain no independent instruction source.',
  },
  {
    paths: ['packages/contracts/src/llm-provider.ts'],
    classification: 'non_skill',
    reason: 'LLM and vision provider presets are connection/model configuration facts.',
  },
  {
    paths: [
      'apps/desktop-renderer/src/components/settings/SettingsCanvasSection.tsx',
      'packages/contracts/src/dto/resolution.ts',
    ],
    classification: 'non_skill',
    reason: 'Publish/reference/resolution presets are numeric technical configuration choices.',
  },
  {
    paths: [
      'apps/desktop-renderer/src/i18n.messages.en-US.ts',
      'apps/desktop-renderer/src/i18n.messages.zh-CN.ts',
      'apps/desktop-renderer/src/i18n.runtime.ts',
    ],
    classification: 'non_skill',
    reason:
      'Localization labels and new-editor scaffold text are presentation copy, not persisted Skill content.',
  },
] as const);

export const LEGACY_SKILL_ORPHAN_ARTIFACTS_V1 = Object.freeze([
  {
    path: 'docs/ai-video-prompt-guide/14-reference-image-generation.md',
    reason:
      'The legacy renderer catalog never registered this guide; it is reported but not fabricated as a Skill.',
  },
  {
    path: 'docs/ai-video-prompt-guide/README.md',
    reason: 'Documentation index only; it was never a reusable prompt or template record.',
  },
] as const);

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function normalizeLegacySourceRecord(value: unknown): JsonValue {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('Legacy source record is not JSON data');
  return JSON.parse(serialized) as JsonValue;
}

export interface LegacySkillSourceInput {
  readonly kind: LegacySkillSourceKind;
  readonly logicalKey: string;
  readonly state: LegacySkillContentV1['source']['state'];
  readonly store: string;
  readonly name: string;
  readonly description: string;
  readonly effectiveInstruction: string;
  readonly sourceRecord: unknown;
  readonly createdAt?: string;
  readonly provenance?: SkillDocument['provenance'];
  readonly trust?: SkillDocument['trust'];
}

export function legacySourceToSkill(input: LegacySkillSourceInput): SkillDocument {
  const envelope = parseCanonical(LegacySkillContentV1Schema, {
    schema: 'lucid-fin.legacy-skill-content/v1',
    source: {
      kind: input.kind,
      logicalKey: input.logicalKey,
      state: input.state,
      store: input.store,
    },
    effectiveInstruction: input.effectiveInstruction,
    sourceRecord: normalizeLegacySourceRecord(input.sourceRecord),
  });
  const content = canonicalJson(envelope);
  const contentHash = sha256(content);
  const identityHash = sha256(canonicalJson({ kind: input.kind, logicalKey: input.logicalKey }));
  return parseCanonical(SkillDocumentSchema, {
    skillId: `legacy.${input.kind}.${identityHash}`,
    name: input.name,
    description: input.description,
    version: `1.0.0+legacy.${contentHash}`,
    contentHash,
    provenance: input.provenance ?? 'built_in',
    trust: input.trust ?? 'trusted',
    content,
    createdAt: input.createdAt ?? LEGACY_SKILL_CREATED_AT,
  });
}
