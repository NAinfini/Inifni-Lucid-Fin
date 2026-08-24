import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  LegacySkillContentV1Schema,
  SkillDocumentSchema,
  canonicalJson,
  parseCanonical,
  type JsonValue,
  type LegacySkillContentV1,
  type LegacySkillSourceKind,
  type SkillDocument,
} from '../packages/target-contracts/src/index.js';

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

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

function sourceFile(text: string, path: string): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function initializerFor(source: ts.SourceFile, name: string): ts.Expression {
  let initializer: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      initializer = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (initializer === undefined) throw new Error(`Legacy source ${name} was not found`);
  return initializer;
}

function propertyName(node: ts.PropertyName): string {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  throw new Error(`Unsupported legacy property name: ${node.getText()}`);
}

function staticValue(node: ts.Expression, identifiers: ReadonlyMap<string, JsonValue>): JsonValue {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(node)) {
    const value = identifiers.get(node.text);
    if (value === undefined) throw new Error(`Unmapped legacy identifier ${node.text}`);
    return value;
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((entry) => {
      if (ts.isSpreadElement(entry)) throw new Error('Legacy array spreads are not supported');
      return staticValue(entry, identifiers);
    });
  }
  if (ts.isObjectLiteralExpression(node)) {
    const value: { [key: string]: JsonValue } = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) {
        throw new Error(`Unsupported legacy object member: ${property.getText()}`);
      }
      value[propertyName(property.name)] = staticValue(property.initializer, identifiers);
    }
    return value;
  }
  throw new Error(`Unsupported legacy expression: ${node.getText()}`);
}

async function rendererSkillRecords(): Promise<JsonValue[]> {
  const path = resolve(
    repositoryRoot,
    'apps/desktop-renderer/src/store/slices/skillDefinitions.ts',
  );
  const text = await readFile(path, 'utf8');
  const source = sourceFile(text, path);
  const identifiers = new Map<string, JsonValue>();
  await Promise.all(
    source.statements.flatMap((statement) => {
      if (
        !ts.isImportDeclaration(statement) ||
        statement.importClause?.name === undefined ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !statement.moduleSpecifier.text.endsWith('.md?raw')
      ) {
        return [];
      }
      const identifier = statement.importClause.name.text;
      const markdownPath = resolve(dirname(path), statement.moduleSpecifier.text.slice(0, -4));
      return [
        readFile(markdownPath, 'utf8').then((content) => identifiers.set(identifier, content)),
      ];
    }),
  );
  const initializer = initializerFor(source, 'BUILT_IN_SEEDS');
  if (!ts.isArrayLiteralExpression(initializer)) {
    throw new Error('BUILT_IN_SEEDS must remain a static array');
  }
  return initializer.elements.map((element) => {
    if (!ts.isObjectLiteralExpression(element)) {
      throw new Error('BUILT_IN_SEEDS entries must remain static objects');
    }
    return staticValue(element, identifiers);
  });
}

async function processPromptRecords(): Promise<JsonValue[]> {
  const path = resolve(repositoryRoot, 'packages/storage/src/process-prompt-store.ts');
  const source = sourceFile(await readFile(path, 'utf8'), path);
  const initializer = initializerFor(source, 'PROCESS_PROMPT_DEFAULTS');
  if (!ts.isArrayLiteralExpression(initializer)) {
    throw new Error('PROCESS_PROMPT_DEFAULTS must remain a static array');
  }
  return initializer.elements.map((element) => {
    if (
      !ts.isCallExpression(element) ||
      !ts.isIdentifier(element.expression) ||
      element.expression.text !== 'defineProcessPrompt' ||
      element.arguments.length !== 4
    ) {
      throw new Error('PROCESS_PROMPT_DEFAULTS must use four-argument defineProcessPrompt calls');
    }
    const [processKey, name, description, defaultValue] = element.arguments.map((argument) =>
      staticValue(argument, new Map()),
    );
    return { processKey, name, description, defaultValue };
  });
}

async function promptTemplateRecords(): Promise<JsonValue[]> {
  const path = resolve(repositoryRoot, 'packages/storage/src/prompt-store.ts');
  const source = sourceFile(await readFile(path, 'utf8'), path);
  const initializer = initializerFor(source, 'PROMPT_TEMPLATE_DEFAULTS');
  if (!ts.isArrayLiteralExpression(initializer)) {
    throw new Error('PROMPT_TEMPLATE_DEFAULTS must remain a static array');
  }
  return initializer.elements.map((element) => {
    if (!ts.isObjectLiteralExpression(element)) {
      throw new Error('PROMPT_TEMPLATE_DEFAULTS entries must remain static objects');
    }
    return staticValue(element, new Map());
  });
}

function record(value: JsonValue): { [key: string]: JsonValue } {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('Legacy built-in source entry must be an object');
  }
  return value;
}

function textField(value: { [key: string]: JsonValue }, key: string): string {
  const field = value[key];
  if (typeof field !== 'string' || field.length === 0) {
    throw new Error(`Legacy built-in source field ${key} must be a non-empty string`);
  }
  return field;
}

export async function buildBuiltInLegacySkills(): Promise<readonly SkillDocument[]> {
  const [{ BUILT_IN_PRESET_LIBRARY }, { BUILT_IN_SHOT_TEMPLATES }, renderer, process, prompts] =
    await Promise.all([
      import('../packages/contracts/src/dto/presets/library.js'),
      import('../packages/contracts/src/dto/presets/shot-templates.js'),
      rendererSkillRecords(),
      processPromptRecords(),
      promptTemplateRecords(),
    ]);
  const sources: LegacySkillSourceInput[] = [
    ...BUILT_IN_PRESET_LIBRARY.map((preset) => ({
      kind: 'preset' as const,
      logicalKey: preset.id,
      state: 'built_in' as const,
      store: 'contracts.preset-library',
      name: preset.name,
      description: preset.description,
      effectiveInstruction: preset.promptTemplate ?? preset.prompt,
      sourceRecord: preset,
    })),
    ...BUILT_IN_SHOT_TEMPLATES.map((template) => ({
      kind: 'shot_template' as const,
      logicalKey: template.id,
      state: 'built_in' as const,
      store: 'contracts.shot-templates',
      name: template.name,
      description: template.description,
      effectiveInstruction: template.description,
      sourceRecord: template,
    })),
    ...renderer.map((value) => {
      const sourceRecord = record(value);
      const category = textField(sourceRecord, 'category');
      const source = textField(sourceRecord, 'source');
      return {
        kind: 'renderer_skill' as const,
        logicalKey: textField(sourceRecord, 'id'),
        state: 'built_in' as const,
        store: 'renderer.skillDefinitions',
        name: textField(sourceRecord, 'name'),
        description: `Legacy renderer ${source} guide in category ${category}.`,
        effectiveInstruction: textField(sourceRecord, 'defaultContent'),
        sourceRecord,
        trust:
          category === 'system' || source === 'taskListGuide'
            ? ('unreviewed' as const)
            : ('trusted' as const),
      };
    }),
    ...process.map((value) => {
      const sourceRecord = record(value);
      return {
        kind: 'process_prompt' as const,
        logicalKey: textField(sourceRecord, 'processKey'),
        state: 'built_in' as const,
        store: 'storage.process-prompts',
        name: textField(sourceRecord, 'name'),
        description: textField(sourceRecord, 'description'),
        effectiveInstruction: textField(sourceRecord, 'defaultValue'),
        sourceRecord,
        trust: 'unreviewed' as const,
      };
    }),
    ...prompts.map((value) => {
      const sourceRecord = record(value);
      return {
        kind: 'prompt_template' as const,
        logicalKey: textField(sourceRecord, 'code'),
        state: 'built_in' as const,
        store: 'storage.prompt-templates',
        name: textField(sourceRecord, 'name'),
        description: `Legacy ${textField(sourceRecord, 'type')} prompt template.`,
        effectiveInstruction: textField(sourceRecord, 'defaultValue'),
        sourceRecord,
        trust: 'unreviewed' as const,
      };
    }),
  ];
  const sourceKeys = sources.map(({ kind, logicalKey }) => `${kind}\u0000${logicalKey}`);
  if (new Set(sourceKeys).size !== sourceKeys.length) {
    throw new Error('Built-in legacy Skill sources must have unique kind/logicalKey identities');
  }
  const actualCounts = Object.fromEntries(
    Object.keys(BUILT_IN_LEGACY_SKILL_COUNTS).map((kind) => [
      kind,
      sources.filter((source) => source.kind === kind).length,
    ]),
  );
  if (canonicalJson(actualCounts) !== canonicalJson(BUILT_IN_LEGACY_SKILL_COUNTS)) {
    throw new Error(
      `Built-in legacy Skill source drift: expected ${canonicalJson(BUILT_IN_LEGACY_SKILL_COUNTS)}, got ${canonicalJson(actualCounts)}`,
    );
  }
  const documents = sources
    .map(legacySourceToSkill)
    .sort(
      (left, right) =>
        compareText(left.skillId, right.skillId) || compareText(left.version, right.version),
    );
  if (
    documents.length !== BUILT_IN_LEGACY_SKILL_COUNT ||
    documents.some(
      (document, index) =>
        index > 0 &&
        document.skillId === documents[index - 1]!.skillId &&
        document.version === documents[index - 1]!.version,
    )
  ) {
    throw new Error('Built-in legacy Skill pack must contain 287 sorted unique documents');
  }
  return Object.freeze(documents);
}
