import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EvaluationInputSchema,
  EvaluationSuccessSchema,
  GenerationSubmissionSuccessSchema,
  GenerationSubmitInputSchema,
  ResultQueryInputSchema,
  ResultQuerySuccessSchema,
} from '../generation.js';
import { MediaDeriveInputSchema, MediaDeriveSuccessSchema } from '../media.js';
import {
  OperationCancelInputSchema,
  OperationCancelOutputSchema,
  OperationGetInputSchema,
  OperationGetOutputSchema,
} from '../operation.js';
import {
  EXACT_TOOL_IDS,
  MAX_TOOL_PROGRAM_CALLS,
  MAX_TOOL_PROGRAM_CONCURRENCY,
  MAX_TOOL_PROGRAM_DEPTH,
  MAX_TOOL_PROGRAM_NODES,
  TOOL_DEFINITIONS,
  TOOL_DEFINITION_BY_ID,
  TOOL_VERSION,
  ToolMetadataSchema,
  ToolVersionSchema,
  ToolProgramDurableInputSchema,
  ToolProgramDefinition,
  ToolProgramInputSchema,
  executableToolDefinition,
} from './index.js';

const toolsDirectory = dirname(fileURLToPath(import.meta.url));

function withExtraField<Value>(value: Value): Value & { unexpectedField: true } {
  return { ...(JSON.parse(JSON.stringify(value)) as Value), unexpectedField: true };
}

function schemaPropertyNames(schema: z.ZodType): Set<string> {
  const document = z.toJSONSchema(schema);
  const names = new Set<string>();
  const visit = (value: object | null): void => {
    if (value === null || Array.isArray(value)) {
      if (Array.isArray(value)) value.forEach((entry) => visit(entry as object | null));
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'properties' && entry !== null && typeof entry === 'object') {
        Object.keys(entry).forEach((name) => names.add(name));
      }
      if (entry !== null && typeof entry === 'object') visit(entry as object);
    }
  };
  visit(document);
  return names;
}

describe('exact target Tool Catalog', () => {
  it('contains exactly the stable sorted 40-tool inventory with explicit per-tool versions', () => {
    expect(EXACT_TOOL_IDS).toHaveLength(40);
    expect([...EXACT_TOOL_IDS]).toEqual([...EXACT_TOOL_IDS].sort());
    expect(TOOL_DEFINITIONS.map((definition) => definition.id)).toEqual([...EXACT_TOOL_IDS]);
    expect(new Set(TOOL_DEFINITIONS.map((definition) => definition.id)).size).toBe(
      EXACT_TOOL_IDS.length,
    );
    expect(
      [
        'canvas.query',
        'production.mutate',
        'production.query',
        'project.get',
        'tool.get',
        'tool.program',
      ].map((id) => TOOL_DEFINITION_BY_ID[id]!.version),
    ).toEqual(['2.0.0', '2.0.0', '2.0.0', '2.0.0', '2.0.0', '2.0.0']);
    expect(
      TOOL_DEFINITIONS.filter(
        ({ id }) =>
          ![
            'canvas.query',
            'production.mutate',
            'production.query',
            'project.get',
            'tool.get',
            'tool.program',
          ].includes(id),
      ).every((definition) => definition.version === TOOL_VERSION),
    ).toBe(true);
    expect(Object.keys(TOOL_DEFINITION_BY_ID).sort()).toEqual([...EXACT_TOOL_IDS]);
    expect(ToolVersionSchema.safeParse('2.0.0').success).toBe(true);
    expect(ToolVersionSchema.safeParse(' 2.0.0 ').success).toBe(false);
    expect(ToolVersionSchema.safeParse('02.0.0').success).toBe(false);
    expect(ToolVersionSchema.safeParse('2.0.0-beta.1').success).toBe(false);
  });

  it('projects production.query includes into matching typed sections', () => {
    const definition = TOOL_DEFINITION_BY_ID['production.query'];
    const input = definition.parseInput({
      refs: [],
      kinds: ['shot'],
      parentRef: null,
      relation: null,
      include: ['content', 'relations', 'citations', 'protections'],
      page: { cursor: null, limit: 20 },
    });
    expect(input.include).toEqual(['content', 'relations', 'citations', 'protections']);
    expect(definition.parseSuccess(definition.examples.success)).toMatchObject({
      items: [
        {
          sections: [
            { section: 'content' },
            { section: 'relations' },
            { section: 'citations' },
            { section: 'protections' },
          ],
        },
      ],
    });
    expect(() => definition.parseInput({ ...input, include: ['relations', 'content'] })).toThrow();
  });

  it('keeps Production hierarchy, CAS, citations, and receipts on the v2 mutation contract', () => {
    const definition = TOOL_DEFINITION_BY_ID['production.mutate'];
    const parent = {
      authority: 'production' as const,
      id: 'sequence.1',
      revision: 3,
      contentHash: 'a'.repeat(64),
    };
    const child = {
      authority: 'production' as const,
      id: 'scene.1',
      revision: 2,
      contentHash: 'b'.repeat(64),
    };
    const value = {
      objectType: 'scene' as const,
      content: { title: 'Harbor arrival', summary: 'The courier reaches the harbor.' },
    };
    const expectedParent = {
      ref: parent,
      expectedRevision: parent.revision,
      expectedContentHash: parent.contentHash,
    };
    const expectedChild = {
      ref: child,
      expectedRevision: child.revision,
      expectedContentHash: child.contentHash,
    };

    expect(definition.version).toBe('2.0.0');
    expect(
      definition.parseInput({
        action: 'create',
        expectedProjectRevision: 4,
        parentRef: parent,
        order: 0,
        value,
      }),
    ).toMatchObject({ action: 'create', parentRef: parent, order: 0 });
    for (const invalid of [
      { parentRef: null, order: 0 },
      { parentRef: parent, order: null },
    ]) {
      expect(() =>
        definition.parseInput({
          action: 'create',
          expectedProjectRevision: 4,
          value,
          ...invalid,
        }),
      ).toThrow();
    }

    expect(
      definition.parseInput({
        action: 'relate',
        mode: 'link',
        relation: 'contains',
        ordinal: 0,
        source: expectedParent,
        target: expectedChild,
      }),
    ).toMatchObject({ action: 'relate', source: expectedParent, target: expectedChild });
    expect(
      definition.parseInput({
        action: 'update',
        ref: child,
        expectedRevision: child.revision,
        expectedContentHash: child.contentHash,
        value,
      }),
    ).toMatchObject({ action: 'update' });
    for (const invalid of [
      { ...expectedChild, expectedRevision: child.revision + 1 },
      { ...expectedChild, expectedContentHash: 'c'.repeat(64) },
    ]) {
      expect(() => definition.parseInput({ action: 'update', value, ...invalid })).toThrow();
    }
    expect(() =>
      definition.parseInput({
        action: 'cite',
        ref: child,
        expectedRevision: child.revision,
        expectedContentHash: child.contentHash,
        field: 'order',
        sourceRef: parent,
        relation: 'supports',
      }),
    ).toThrow();
    expect(definition.parseSuccess({ receipts: [] })).toEqual({ receipts: [] });
    expect(definition.examples.success.receipts.every(({ undoRef }) => undoRef === null)).toBe(
      true,
    );
  });

  it('projects project.get includes into owner-pure ordered sections', () => {
    const definition = TOOL_DEFINITION_BY_ID['project.get'];
    const input = definition.parseInput({
      include: ['metadata', 'format_policy', 'capabilities', 'permissions', 'budget'],
    });
    expect(input.include).toEqual([
      'metadata',
      'format_policy',
      'capabilities',
      'permissions',
      'budget',
    ]);
    expect(definition.parseSuccess(definition.examples.success)).toMatchObject({
      sections: [
        { section: 'metadata' },
        { section: 'format_policy', formatPolicy: { aspectRatio: '16:9' } },
        { section: 'capabilities', defaultProviderProfileId: null },
        { section: 'permissions', mode: 'full' },
        { section: 'budget', ceiling: { maxGenerationCount: 12 } },
      ],
    });
    expect(() => definition.parseInput({ include: ['budget', 'metadata'] })).toThrow();
  });

  it('uses explicit Canvas world bounds and canonical include order', () => {
    const definition = TOOL_DEFINITION_BY_ID['canvas.query'];
    const input = definition.parseInput({
      bounds: { position: { x: 0, y: 0 }, size: { width: 640, height: 360 } },
      targetRefs: [],
      groupIds: [],
      edgeIds: [],
      include: ['placements', 'groups', 'edges', 'annotations', 'saved_views'],
      page: { cursor: null, limit: 20 },
    });
    expect(input.bounds).toEqual({
      position: { x: 0, y: 0 },
      size: { width: 640, height: 360 },
    });
    expect(() => definition.parseInput({ ...input, include: ['edges', 'placements'] })).toThrow();
    expect(() =>
      definition.parseInput({ ...input, viewport: { center: { x: 0, y: 0 }, zoom: 1 } }),
    ).toThrow();
    expect(() =>
      definition.parseInput({
        ...input,
        targetRefs: [
          {
            authority: 'project',
            id: 'project.1',
            revision: 0,
            contentHash: 'a'.repeat(64),
          },
        ],
      }),
    ).toThrow();
  });

  it('directly reuses the canonical operation, generation, evaluation, and media schemas', () => {
    expect(TOOL_DEFINITION_BY_ID['operation.get'].inputSchema).toBe(OperationGetInputSchema);
    expect(TOOL_DEFINITION_BY_ID['operation.get'].successSchema).toBe(OperationGetOutputSchema);
    expect(TOOL_DEFINITION_BY_ID['operation.cancel'].inputSchema).toBe(OperationCancelInputSchema);
    expect(TOOL_DEFINITION_BY_ID['operation.cancel'].successSchema).toBe(
      OperationCancelOutputSchema,
    );
    expect(TOOL_DEFINITION_BY_ID['generation.submit'].inputSchema).toBe(
      GenerationSubmitInputSchema,
    );
    expect(TOOL_DEFINITION_BY_ID['generation.submit'].successSchema).toBe(
      GenerationSubmissionSuccessSchema,
    );
    expect(TOOL_DEFINITION_BY_ID['result.query'].inputSchema).toBe(ResultQueryInputSchema);
    expect(TOOL_DEFINITION_BY_ID['result.query'].successSchema).toBe(ResultQuerySuccessSchema);
    expect(TOOL_DEFINITION_BY_ID['evaluation.run'].inputSchema).toBe(EvaluationInputSchema);
    expect(TOOL_DEFINITION_BY_ID['evaluation.run'].successSchema).toBe(EvaluationSuccessSchema);
    expect(TOOL_DEFINITION_BY_ID['media.derive'].inputSchema).toBe(MediaDeriveInputSchema);
    expect(TOOL_DEFINITION_BY_ID['media.derive'].successSchema).toBe(MediaDeriveSuccessSchema);
  });

  it('canonically parses every example and rejects unknown input, success, and outcome fields', () => {
    for (const definition of TOOL_DEFINITIONS) {
      const input = definition.parseInput(definition.examples.input);
      const success = definition.parseSuccess(definition.examples.success);
      const outcome = definition.parseOutcome({ status: 'succeeded', data: success });

      expect(Object.isFrozen(input), definition.id).toBe(true);
      expect(Object.isFrozen(success), definition.id).toBe(true);
      expect(Object.isFrozen(outcome), definition.id).toBe(true);
      expect(() => definition.parseInput(withExtraField(definition.examples.input))).toThrow();
      expect(() => definition.parseSuccess(withExtraField(definition.examples.success))).toThrow();
      expect(() =>
        definition.parseOutcome({
          status: 'succeeded',
          data: definition.examples.success,
          unexpectedField: true,
        }),
      ).toThrow();
    }
  });

  it('preflights non-plain input and accessor output before Zod parsing', () => {
    class InputWithPrototype {
      names = ['project.get'];
    }
    const outputWithAccessor = Object.defineProperty({}, 'definitions', {
      enumerable: true,
      get: () => [],
    });

    expect(() => TOOL_DEFINITION_BY_ID['tool.get'].parseInput(new InputWithPrototype())).toThrow(
      /Non-plain/,
    );
    expect(() => TOOL_DEFINITION_BY_ID['tool.get'].parseSuccess(outputWithAccessor)).toThrow(
      /Accessor/,
    );
  });

  it('lets agent.spawn inherit parent tools, permission, and budget with explicit nulls', () => {
    const input = TOOL_DEFINITION_BY_ID['agent.spawn'].parseInput({
      displayName: 'Continuity check',
      objective: 'Compare the two harbor shots.',
      publicSummary: 'Checking the selected shots for visual continuity.',
      contextRefs: [
        {
          ref: {
            authority: 'production',
            id: 'shot.1',
            revision: 2,
            contentHash: 'a'.repeat(64),
          },
          role: 'target',
        },
      ],
      toolAllowlist: null,
      permissionCeiling: null,
      budgetCaps: null,
      expectedParentRevision: 3,
    });

    expect(input.contextRefs[0]?.role).toBe('target');
    expect(input.toolAllowlist).toBeNull();
    expect(input.permissionCeiling).toBeNull();
    expect(input.budgetCaps).toBeNull();
    expect(() =>
      TOOL_DEFINITION_BY_ID['agent.spawn'].parseInput({
        ...input,
        contextRefs: [input.contextRefs[0]?.ref],
      }),
    ).toThrow();
    expect(() =>
      TOOL_DEFINITION_BY_ID['agent.spawn'].parseInput({
        ...input,
        inheritedCapabilityOverride: true,
      }),
    ).toThrow();
  });

  it('bounds agent.wait to a positive five-minute maximum while preserving the host deadline', () => {
    const definition = TOOL_DEFINITION_BY_ID['agent.wait'];
    const input = {
      childRunIds: ['run.child.1'],
      condition: 'any_terminal' as const,
      timeoutMs: null,
    };

    expect(definition.parseInput(input)).toEqual(input);
    expect(definition.metadata.timeout).toEqual({ mode: 'wait', maximumMs: 300_000 });
    for (const timeoutMs of [0, -1, 300_001, 1.5]) {
      expect(() => definition.parseInput({ ...input, timeoutMs })).toThrow();
    }
  });

  it('keeps skill.propose strict, exact-confirmed, zero-cost, and host-owned', () => {
    const definition = TOOL_DEFINITION_BY_ID['skill.propose'];
    const input = {
      name: 'Continuity reviewer',
      description: 'Review shots for visible continuity errors.',
      content: 'Check props, wardrobe, lighting, and screen direction.',
    };

    expect(definition.parseInput(input)).toEqual(input);
    expect(definition.metadata).toMatchObject({
      scope: { project: 'current', run: 'current', crossProject: 'denied' },
      effect: { domainMutation: true, runMutation: true, externalSideEffect: false },
      permission: { required: ['project.write', 'run.control'], dynamicProtection: false },
      confirmation: { mode: 'exact_protected', globallyWaivable: false },
      cost: { mode: 'none', unknownCost: 'not_applicable', dimension: 'none' },
      cas: {
        mode: 'revision_and_content_hash',
        expectedFields: [],
      },
      fingerprint: { mode: 'canonical_operation', hostAssignedIdempotency: true },
    });
    expect(
      definition.parseSuccess({
        confirmationId: 'confirmation.skill.1',
        immutableInputHash: 'b'.repeat(64),
        runState: 'waiting_confirmation',
        runRevision: 4,
      }),
    ).toEqual({
      confirmationId: 'confirmation.skill.1',
      immutableInputHash: 'b'.repeat(64),
      runState: 'waiting_confirmation',
      runRevision: 4,
    });

    for (const extra of [
      { skillId: 'skill.project.1' },
      { version: '1.0.0' },
      { contentHash: 'c'.repeat(64) },
      { provenance: 'project' },
      { trust: 'reviewed' },
      { projectId: 'project.1' },
      { createdAt: '2026-08-17T00:00:00.000Z' },
      { expectedProjectSettingsRevision: 2 },
      { expectedProjectSettingsContentHash: 'a'.repeat(64) },
      { expectedRunRevision: 3 },
    ]) {
      expect(() => definition.parseInput({ ...input, ...extra })).toThrow();
    }
    for (const invalid of [
      { ...input, name: '' },
      { ...input, name: 'n'.repeat(241) },
      { ...input, description: '' },
      { ...input, description: 'd'.repeat(4_001) },
      { ...input, content: '' },
      { ...input, content: 'c'.repeat(200_001) },
      { ...input, expectedProjectSettingsContentHash: 'bad' },
      { ...input, expectedRunRevision: -1 },
    ]) {
      expect(() => definition.parseInput(invalid)).toThrow();
    }
  });

  it('binds a protection to the exact Production or Delivery owner', () => {
    const definition = TOOL_DEFINITION_BY_ID['decision.protect'];
    expect(() =>
      definition.parseInput({
        mode: 'protect',
        field: {
          owner: 'production',
          objectId: 'shot.1',
          field: 'resultDecision',
          resultId: 'result.1',
        },
        owner: {
          authority: 'delivery',
          id: 'delivery.1',
          revision: 1,
          contentHash: 'a'.repeat(64),
        },
        reason: 'Keep the approved result.',
      }),
    ).toThrow(/exact owner/);
    expect(() =>
      definition.parseInput({
        mode: 'protect',
        field: { owner: 'generated_result', resultId: 'result.1', field: 'selection' },
        owner: {
          authority: 'generated_result',
          id: 'result.1',
          revision: 0,
          contentHash: 'a'.repeat(64),
        },
        reason: 'Do not mutate immutable result evidence.',
      }),
    ).toThrow();
  });

  it('keeps exhaustive metadata canonical, serializable, and deeply frozen', () => {
    for (const definition of TOOL_DEFINITIONS) {
      expect(ToolMetadataSchema.parse(definition.metadata)).toEqual(definition.metadata);
      expect(definition.metadata.version).toBe(definition.version);
      expect(definition.metadata.description).toBe(definition.description);
      expect(definition.metadata.scope.project).toBe('current');
      expect(definition.metadata.scope.crossProject).toBe('denied');
      expect(definition.metadata.secretPaths).toEqual([]);
      expect(Object.isFrozen(definition.metadata), definition.id).toBe(true);
      expect(Object.isFrozen(definition.metadata.effect), definition.id).toBe(true);
      expect(() => JSON.stringify(definition.metadata)).not.toThrow();
    }
  });

  it('declares exact metadata variants for every variant-effect tool', () => {
    const expected = {
      'production.mutate': ['archive', 'cite', 'create', 'relate', 'reorder', 'restore', 'update'],
      'canvas.mutate': [
        'annotate',
        'arrange',
        'connect',
        'disconnect',
        'group',
        'move',
        'place',
        'remove',
        'resize',
        'restore_view',
        'save_view',
        'ungroup',
      ],
      'media.derive': [
        'clip',
        'crop',
        'extractAudio',
        'extractFrames',
        'ocr',
        'proxyTranscode',
        'resize',
        'transcribe',
        'waveform',
      ],
      'generation.submit': ['audio', 'image', 'video'],
      'evaluation.run': [
        'continuity',
        'coverage',
        'delivery_readiness',
        'reference_similarity',
        'technical_integrity',
      ],
      'decision.record': ['refine', 'reject', 'select', 'undo', 'use_as_reference'],
      'decision.protect': ['protect', 'unprotect'],
      'delivery.mutate': [
        'archive',
        'audioPolicy',
        'create',
        'place',
        'remove',
        'reorder',
        'restore',
        'reviewState',
        'transition',
        'trim',
        'updateSettings',
      ],
      'operation.get': [
        'delivery_export',
        'generation_attempt',
        'media_derivation',
        'result_assessment',
        'review_cut_attempt',
      ],
      'operation.cancel': [
        'delivery_export',
        'generation_attempt',
        'media_derivation',
        'result_assessment',
        'review_cut_attempt',
      ],
      'task.manage': [
        'add',
        'create',
        'get',
        'remove',
        'rename',
        'reorder',
        'terminalize',
        'update',
      ],
      'tool.program': ['batch', 'call', 'filter', 'map', 'sort', 'take', 'validate'],
    } as const;

    for (const [toolId, variants] of Object.entries(expected)) {
      const definition = TOOL_DEFINITION_BY_ID[toolId];
      expect(definition.metadata.variantDiscriminant).not.toBeNull();
      expect(definition.metadata.variants.map((variant) => variant.discriminant).sort()).toEqual(
        [...variants].sort(),
      );
    }
  });

  it('has no generic Zod escapes, forbidden legacy IDs, or host-owned model input fields', () => {
    const source = readdirSync(toolsDirectory)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .map((name) => readFileSync(join(toolsDirectory, name), 'utf8'))
      .join('\n');
    for (const pattern of [
      'z.any(',
      'z.unknown(',
      '.catchall(',
      '.passthrough(',
      'Record<string',
      'providerOptions',
      'guide.get',
      'prompt.get',
      'prompt.setCustom',
      'preset.manage',
      'runChecklist.manage',
    ]) {
      expect(source).not.toContain(pattern);
    }

    const forbiddenInputProperties = new Set([
      'projectId',
      'runId',
      'actor',
      'causation',
      'correlationId',
      'idempotencyKey',
      'credentials',
      'credential',
      'filePath',
      'localPath',
      'path',
      'url',
      'headers',
      'authorization',
    ]);
    for (const definition of TOOL_DEFINITIONS) {
      const names = schemaPropertyNames(definition.inputSchema);
      expect(
        [...names].filter((name) => forbiddenInputProperties.has(name)),
        definition.id,
      ).toEqual([]);
    }
    expect(
      TOOL_DEFINITIONS.filter((definition) =>
        schemaPropertyNames(definition.inputSchema).has('chatId'),
      ).map(({ id }) => id),
    ).toEqual(['chat.query']);
  });
});

describe('typed Tool Program', () => {
  const projectGetCall = {
    toolId: 'project.get' as const,
    toolVersion: '2.0.0' as const,
    input: { include: ['metadata'] as const },
  };

  it('keeps the program envelope stable and resolves child validation by exact tool identity', () => {
    const program = ToolProgramInputSchema.parse({
      version: 1,
      displayName: 'Invalid pairing',
      expectedRunRevision: 1,
      contextRefs: [],
      steps: [
        {
          stepId: 'step.1',
          operation: 'call',
          invocation: {
            toolId: 'project.get',
            toolVersion: '2.0.0',
            input: {
              refs: [],
              kinds: ['shot'],
              parentRef: null,
              relation: null,
              include: [],
              page: { cursor: null, limit: 20 },
            },
          },
        },
      ],
    });
    expect(program.steps[0]).toMatchObject({
      invocation: { toolId: 'project.get', toolVersion: '2.0.0' },
    });
    const definition = executableToolDefinition('project.get', '2.0.0');
    expect(definition).toBeDefined();
    expect(() => definition!.parseInput(program.steps[0]!.invocation.input)).toThrow();
    expect(executableToolDefinition('project.get', '1.0.0')).toBeUndefined();
  });

  it('requires an explicit AST version and accepts only hash projections for durable programs', () => {
    const input = {
      version: 1,
      displayName: 'One safe read',
      expectedRunRevision: 1,
      contextRefs: [],
      steps: [{ stepId: 'step.1', operation: 'call', invocation: projectGetCall }],
    };
    expect(ToolProgramInputSchema.parse(input)).toEqual(input);
    expect(() => ToolProgramInputSchema.parse({ ...input, version: 2 })).toThrow();
    expect(
      ToolProgramDurableInputSchema.parse({
        version: 1,
        displayName: input.displayName,
        expectedRunRevision: input.expectedRunRevision,
        contextRefs: input.contextRefs,
        programHash: 'a'.repeat(64),
        calls: [
          {
            stepId: 'step.1',
            callIndex: 0,
            toolId: 'project.get',
            toolVersion: '2.0.0',
            inputHash: 'b'.repeat(64),
          },
        ],
      }),
    ).toMatchObject({ calls: [{ callIndex: 0, toolId: 'project.get' }] });
  });

  it('cannot invoke tool.program or skill.propose and defers child input validation', () => {
    expect(() =>
      ToolProgramInputSchema.parse({
        version: 1,
        displayName: 'Nested program',
        expectedRunRevision: 1,
        contextRefs: [],
        steps: [
          {
            stepId: 'step.1',
            operation: 'call',
            invocation: { toolId: 'tool.program', toolVersion: '2.0.0', input: {} },
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      ToolProgramInputSchema.parse({
        version: 1,
        displayName: 'Nested Skill proposal',
        expectedRunRevision: 1,
        contextRefs: [],
        steps: [
          {
            stepId: 'step.1',
            operation: 'call',
            invocation: {
              toolId: 'skill.propose',
              toolVersion: '1.0.0',
              input: {
                name: 'Nested',
                description: 'Must not be callable from a Tool Program.',
                content: 'No nested proposals.',
                expectedProjectSettingsRevision: 1,
                expectedProjectSettingsContentHash: 'a'.repeat(64),
                expectedRunRevision: 1,
              },
            },
          },
        ],
      }),
    ).toThrow();
    expect(
      ToolProgramInputSchema.parse({
        version: 1,
        displayName: 'Arbitrary input',
        expectedRunRevision: 1,
        contextRefs: [],
        steps: [
          {
            stepId: 'step.1',
            operation: 'call',
            invocation: {
              toolId: 'project.get',
              toolVersion: '2.0.0',
              input: { include: ['metadata'], payload: {} },
            },
          },
        ],
      }).steps[0],
    ).toMatchObject({ invocation: { input: { payload: {} } } });
  });

  it('enforces node, call, concurrency, order, uniqueness, and dependency-depth bounds', () => {
    const base = {
      version: 1,
      displayName: 'Bounded program',
      expectedRunRevision: 1,
      contextRefs: [],
    };
    expect(() =>
      ToolProgramInputSchema.parse({
        ...base,
        steps: Array.from({ length: MAX_TOOL_PROGRAM_NODES + 1 }, (_, index) => ({
          stepId: `step.${index}`,
          operation: 'call',
          invocation: projectGetCall,
        })),
      }),
    ).toThrow();
    expect(() =>
      ToolProgramInputSchema.parse({
        ...base,
        steps: [
          {
            stepId: 'step.map',
            operation: 'map',
            invocations: Array.from({ length: MAX_TOOL_PROGRAM_CALLS }, () => projectGetCall),
            concurrency: MAX_TOOL_PROGRAM_CONCURRENCY,
          },
          { stepId: 'step.extra', operation: 'call', invocation: projectGetCall },
        ],
      }),
    ).toThrow();
    expect(() =>
      ToolProgramInputSchema.parse({
        ...base,
        steps: [
          {
            stepId: 'step.map',
            operation: 'map',
            invocations: [projectGetCall],
            concurrency: MAX_TOOL_PROGRAM_CONCURRENCY + 1,
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      ToolProgramInputSchema.parse({
        ...base,
        steps: [
          {
            stepId: 'step.filter',
            operation: 'filter',
            sourceStepId: 'step.future',
            predicate: { field: 'outcome_status', include: ['succeeded'] },
          },
          { stepId: 'step.future', operation: 'call', invocation: projectGetCall },
        ],
      }),
    ).toThrow();
    expect(() =>
      ToolProgramInputSchema.parse({
        ...base,
        steps: [
          { stepId: 'step.same', operation: 'call', invocation: projectGetCall },
          { stepId: 'step.same', operation: 'call', invocation: projectGetCall },
        ],
      }),
    ).toThrow();

    const deepSteps = [
      { stepId: 'step.0', operation: 'call' as const, invocation: projectGetCall },
      ...Array.from({ length: MAX_TOOL_PROGRAM_DEPTH }, (_, index) => ({
        stepId: `step.${index + 1}`,
        operation: 'take' as const,
        sourceStepId: `step.${index}`,
        count: 1,
      })),
    ];
    expect(() => ToolProgramInputSchema.parse({ ...base, steps: deepSteps })).toThrow();
  });

  it('parses the canonical Tool Program example', () => {
    expect(() =>
      ToolProgramDefinition.parseInput(ToolProgramDefinition.examples.input),
    ).not.toThrow();
    expect(() =>
      ToolProgramDefinition.parseOutcome({
        status: 'succeeded',
        data: ToolProgramDefinition.examples.success,
      }),
    ).not.toThrow();
  });
});
