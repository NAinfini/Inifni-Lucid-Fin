import type { LLMToolParameter } from '@lucid-fin/contracts';
import type { ToolRuntimeSchema } from '../tool-registry.js';

export const stringSchema = { type: 'string' } satisfies ToolRuntimeSchema;
export const numberSchema = { type: 'number' } satisfies ToolRuntimeSchema;
export const booleanSchema = { type: 'boolean' } satisfies ToolRuntimeSchema;
export const canonicalJsonSchema = { type: 'canonical-json' } satisfies ToolRuntimeSchema;

export function enumSchema<const Values extends string[]>(values: Values): {
  type: 'string';
  enum: Values;
} {
  return { type: 'string', enum: values };
}

export function arraySchema<const Items extends ToolRuntimeSchema>(items: Items): {
  type: 'array';
  items: Items;
} {
  return { type: 'array', items };
}

type RuntimeObjectSchema<
  Properties extends Record<string, ToolRuntimeSchema>,
  AdditionalProperties extends boolean | ToolRuntimeSchema,
> = {
  type: 'object';
  properties: Properties;
  required: string[];
  additionalProperties: AdditionalProperties;
};

export function objectSchema<const Properties extends Record<string, ToolRuntimeSchema>>(
  properties: Properties,
  required?: string[],
): RuntimeObjectSchema<Properties, false>;
export function objectSchema<
  const Properties extends Record<string, ToolRuntimeSchema>,
  const AdditionalProperties extends boolean | ToolRuntimeSchema,
>(
  properties: Properties,
  required: string[] | undefined,
  additionalProperties: AdditionalProperties,
): RuntimeObjectSchema<Properties, AdditionalProperties>;
export function objectSchema(
  properties: Record<string, ToolRuntimeSchema>,
  required: string[] = Object.keys(properties),
  additionalProperties: boolean | ToolRuntimeSchema = false,
): ToolRuntimeSchema {
  return { type: 'object', properties, required, additionalProperties };
}

export function recordSchema<const Values extends ToolRuntimeSchema>(
  values: Values,
): RuntimeObjectSchema<Record<string, never>, Values> {
  return objectSchema({}, [], values);
}

export function unionSchema<const Schemas extends ToolRuntimeSchema[]>(...schemas: Schemas): {
  anyOf: Schemas;
} {
  return { anyOf: schemas };
}

export function nullableSchema<const Schema extends ToolRuntimeSchema>(schema: Schema): Schema & {
  nullable: true;
} {
  return { ...schema, nullable: true };
}

/** Convert a closed runtime schema into a provider-visible input parameter. */
export function toProviderParameterSchema(schema: ToolRuntimeSchema): LLMToolParameter {
  if ('anyOf' in schema) {
    return { ...schema, anyOf: schema.anyOf.map(toProviderParameterSchema) };
  }
  if ('const' in schema) return { ...schema };
  if (schema.type === 'canonical-json') {
    throw new Error('canonical-json cannot be exposed in a provider input schema.');
  }
  if (schema.type === 'array') {
    return { ...schema, items: toProviderParameterSchema(schema.items) };
  }
  if (schema.type === 'object') {
    const properties: Record<string, LLMToolParameter> = {};
    for (const [key, property] of Object.entries(schema.properties)) {
      properties[key] = toProviderParameterSchema(property);
    }
    return {
      type: 'object',
      ...(schema.description !== undefined ? { description: schema.description } : {}),
      ...(schema.nullable !== undefined ? { nullable: schema.nullable } : {}),
      properties,
      ...(schema.required !== undefined ? { required: schema.required } : {}),
      ...(typeof schema.additionalProperties === 'object'
        ? { additionalProperties: toProviderParameterSchema(schema.additionalProperties) }
        : schema.additionalProperties !== undefined
          ? { additionalProperties: schema.additionalProperties }
          : {}),
    };
  }
  return { ...schema };
}

export const stringArraySchema = arraySchema(stringSchema);
export const finitePrimitiveSchema = unionSchema(stringSchema, numberSchema, booleanSchema);

export const pointSchema = objectSchema({ x: numberSchema, y: numberSchema });

export const canvasEdgeSchema = objectSchema(
  {
    id: stringSchema,
    source: stringSchema,
    target: stringSchema,
    sourceHandle: stringSchema,
    targetHandle: stringSchema,
    data: objectSchema(
      {
        label: stringSchema,
        status: enumSchema(['idle', 'generating', 'done', 'failed']),
        autoLabel: booleanSchema,
      },
      ['status'],
    ),
  },
  ['id', 'source', 'target', 'data'],
);

export const canvasEdgeSummarySchema = objectSchema(
  { id: stringSchema, source: stringSchema, target: stringSchema, label: stringSchema },
  ['id', 'source', 'target'],
);

export const canvasNodeSchema = objectSchema(
  {
    id: stringSchema,
    type: enumSchema(['text', 'image', 'video', 'audio', 'backdrop']),
    position: pointSchema,
    data: canonicalJsonSchema,
    title: stringSchema,
    bypassed: booleanSchema,
    locked: booleanSchema,
    colorTag: stringSchema,
    tags: stringArraySchema,
    groupId: stringSchema,
    parentId: stringSchema,
    width: numberSchema,
    height: numberSchema,
    createdAt: numberSchema,
    updatedAt: numberSchema,
  },
  ['id', 'type', 'position', 'data', 'title', 'bypassed', 'locked', 'createdAt', 'updatedAt'],
);

export const canvasNodeSummarySchema = objectSchema(
  {
    id: stringSchema,
    type: enumSchema(['text', 'image', 'video', 'audio', 'backdrop']),
    title: stringSchema,
    position: pointSchema,
    width: numberSchema,
    height: numberSchema,
    status: stringSchema,
  },
  ['id', 'type', 'title', 'position', 'status'],
);

export const canvasSettingsSchema = objectSchema(
  {
    visualStylePolicy: canonicalJsonSchema,
    stylePlate: stringSchema,
    negativePrompt: stringSchema,
    refResolution: objectSchema({ width: numberSchema, height: numberSchema }),
    publishImageResolution: objectSchema({ width: numberSchema, height: numberSchema }),
    publishVideoResolution: objectSchema({ width: numberSchema, height: numberSchema }),
    resolutionPolicy: canonicalJsonSchema,
    aspectRatio: enumSchema(['16:9', '9:16', '1:1', '2.39:1']),
    llmProviderId: stringSchema,
    imageProviderId: stringSchema,
    videoProviderId: stringSchema,
    audioProviderId: stringSchema,
  },
  [],
);

export const canvasSchema = objectSchema(
  {
    id: stringSchema,
    name: stringSchema,
    nodes: arraySchema(canvasNodeSchema),
    edges: arraySchema(canvasEdgeSchema),
    viewport: objectSchema({ x: numberSchema, y: numberSchema, zoom: numberSchema }),
    notes: arraySchema(
      objectSchema({ id: stringSchema, content: stringSchema, createdAt: numberSchema, updatedAt: numberSchema }),
    ),
    settings: canvasSettingsSchema,
    deliverySequence: canonicalJsonSchema,
    archivedAt: numberSchema,
    createdAt: numberSchema,
    updatedAt: numberSchema,
  },
  ['id', 'name', 'nodes', 'edges', 'viewport', 'notes', 'createdAt', 'updatedAt'],
);

export const canvasNoteSchema = objectSchema({
  id: stringSchema,
  content: stringSchema,
  createdAt: numberSchema,
  updatedAt: numberSchema,
});

export const entityReferenceSchema = (identityKey: string): ToolRuntimeSchema =>
  objectSchema(
    {
      [identityKey]: stringSchema,
      loadoutId: stringSchema,
      costume: stringSchema,
      emotion: stringSchema,
      angleSlot: stringSchema,
      referenceImageHash: stringSchema,
    },
    [identityKey],
  );

export const presetCategorySchema = enumSchema([
  'camera',
  'lens',
  'look',
  'scene',
  'composition',
  'emotion',
  'flow',
  'technical',
  'voice-style',
  'music-genre',
  'sfx-environment',
]);

export const presetParamsSchema = recordSchema(finitePrimitiveSchema);
const presetBlendSchema = objectSchema(
  {
    category: presetCategorySchema,
    presetIdB: stringSchema,
    paramsB: presetParamsSchema,
    factor: numberSchema,
    mode: enumSchema(['mix', 'crossfade', 'add']),
  },
  ['category', 'presetIdB', 'factor'],
);
export const presetTrackEntrySchema = objectSchema(
  {
    id: stringSchema,
    category: presetCategorySchema,
    presetId: stringSchema,
    params: presetParamsSchema,
    durationMs: numberSchema,
    order: numberSchema,
    enabled: booleanSchema,
    intensity: numberSchema,
    direction: stringSchema,
    blend: presetBlendSchema,
  },
  ['id', 'category', 'presetId', 'params', 'order'],
);
export const presetTrackSchema = objectSchema(
  { category: presetCategorySchema, intensity: numberSchema, entries: arraySchema(presetTrackEntrySchema) },
  ['category', 'entries'],
);
export const presetTrackSetSchema = recordSchema(presetTrackSchema);

const presetParamDefinitionSchema = objectSchema(
  {
    key: stringSchema,
    label: stringSchema,
    type: enumSchema(['number', 'string', 'boolean', 'enum', 'angle']),
    description: stringSchema,
    required: booleanSchema,
    min: numberSchema,
    max: numberSchema,
    options: stringArraySchema,
    defaultValue: finitePrimitiveSchema,
  },
  ['key', 'label', 'type', 'defaultValue'],
);
const promptParamDefinitionSchema = objectSchema(
  {
    key: stringSchema,
    label: stringSchema,
    type: enumSchema(['intensity', 'select', 'number']),
    default: unionSchema(numberSchema, stringSchema),
    levels: recordSchema(stringSchema),
    options: stringArraySchema,
    min: numberSchema,
    max: numberSchema,
  },
  ['key', 'label', 'type', 'default'],
);
export const presetDefinitionSchema = objectSchema(
  {
    id: stringSchema,
    category: presetCategorySchema,
    name: stringSchema,
    description: stringSchema,
    prompt: stringSchema,
    promptFragment: stringSchema,
    negativePrompt: stringSchema,
    builtIn: booleanSchema,
    modified: booleanSchema,
    defaultPrompt: stringSchema,
    defaultParams: presetParamsSchema,
    params: arraySchema(presetParamDefinitionSchema),
    defaults: presetParamsSchema,
    sphericalPositions: arraySchema(
      objectSchema(
        {
          label: stringSchema,
          azimuthDeg: numberSchema,
          elevationDeg: numberSchema,
          distance: numberSchema,
          colorHex: stringSchema,
        },
        ['label', 'azimuthDeg', 'elevationDeg'],
      ),
    ),
    promptTemplate: stringSchema,
    promptParamDefs: arraySchema(promptParamDefinitionSchema),
    conflictGroup: stringSchema,
    createdAt: numberSchema,
    updatedAt: numberSchema,
  },
  ['id', 'category', 'name', 'description', 'prompt', 'builtIn', 'modified', 'params', 'defaults'],
);

export const shotTemplateSchema = objectSchema(
  {
    id: stringSchema,
    name: stringSchema,
    description: stringSchema,
    builtIn: booleanSchema,
    tracks: presetTrackSetSchema,
    createdAt: numberSchema,
  },
  ['id', 'name', 'description', 'builtIn', 'tracks'],
);

export const promptAssemblyOutputSchema = objectSchema(
  {
    version: { const: 1 },
    assemblyId: stringSchema,
    inputHash: stringSchema,
    finalPrompt: stringSchema,
    negativePrompt: stringSchema,
    sourceDecisions: arraySchema(
      objectSchema(
        {
          sourceId: stringSchema,
          sourceHash: stringSchema,
          disposition: enumSchema(['applied', 'omitted', 'conflict-resolved']),
          reason: stringSchema,
        },
        ['sourceId', 'sourceHash', 'disposition'],
      ),
    ),
    summary: stringSchema,
    warnings: stringArraySchema,
  },
  ['version', 'assemblyId', 'inputHash', 'finalPrompt', 'sourceDecisions', 'summary', 'warnings'],
);

export const promptAssemblyRecordSchema = objectSchema(
  {
    id: stringSchema,
    canvasId: stringSchema,
    nodeId: stringSchema,
    nodeUpdatedAt: numberSchema,
    mediaType: enumSchema(['image', 'video', 'audio']),
    mode: enumSchema(['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video', 'text-to-audio']),
    purpose: enumSchema(['initial', 'user_refine', 'evaluation_repair', 'regenerate']),
    inputHash: stringSchema,
    input: canonicalJsonSchema,
    output: promptAssemblyOutputSchema,
    status: enumSchema(['prepared', 'assembled', 'submitted', 'failed', 'cancelled']),
    rowVersion: numberSchema,
    error: stringSchema,
    llmProviderId: stringSchema,
    llmModel: stringSchema,
    taskListId: stringSchema,
    taskId: stringSchema,
    parentAssemblyId: stringSchema,
    sourceAttemptId: stringSchema,
    sourceAssetHash: stringSchema,
    sourceEvaluationId: stringSchema,
    createdAt: numberSchema,
    assembledAt: numberSchema,
    submittedAt: numberSchema,
    terminalAt: numberSchema,
    updatedAt: numberSchema,
  },
  ['id', 'canvasId', 'nodeId', 'nodeUpdatedAt', 'mediaType', 'mode', 'purpose', 'inputHash', 'input', 'status', 'rowVersion', 'createdAt', 'updatedAt'],
);

export const mediaTaskViewSchema = objectSchema(
  {
    id: stringSchema,
    canvasId: stringSchema,
    nodeId: stringSchema,
    status: stringSchema,
    taskStatus: stringSchema,
    progress: numberSchema,
    promptAssembly: promptAssemblyRecordSchema,
    attempt: canonicalJsonSchema,
    evaluation: canonicalJsonSchema,
    artifact: canonicalJsonSchema,
    error: stringSchema,
  },
  ['id', 'canvasId', 'nodeId', 'status', 'taskStatus', 'progress'],
);

const taskListStatusSchema = enumSchema([
  'pending',
  'awaiting_approval',
  'blocked',
  'ready',
  'queued',
  'preparing',
  'running',
  'paused',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'dead',
]);
const taskStatusSchema = enumSchema([
  'pending',
  'blocked',
  'ready',
  'running',
  'awaiting_provider',
  'retryable_failed',
  'completed',
  'failed',
  'cancelled',
  'skipped',
]);
export const taskListSchema = objectSchema(
  {
    id: stringSchema,
    taskListType: stringSchema,
    entityType: stringSchema,
    entityId: stringSchema,
    triggerSource: stringSchema,
    status: taskListStatusSchema,
    summary: stringSchema,
    progress: numberSchema,
    completedPhases: numberSchema,
    totalPhases: numberSchema,
    completedTasks: numberSchema,
    totalTasks: numberSchema,
    currentPhaseKey: stringSchema,
    currentTaskId: stringSchema,
    input: canonicalJsonSchema,
    output: canonicalJsonSchema,
    error: stringSchema,
    metadata: canonicalJsonSchema,
    createdAt: numberSchema,
    startedAt: numberSchema,
    completedAt: numberSchema,
    updatedAt: numberSchema,
    rowVersion: numberSchema,
    currentGate: enumSchema(['production_plan', 'visual_constitution', 'delivery']),
    engineVersion: stringSchema,
    definitionVersion: numberSchema,
    leaseOwner: stringSchema,
    leaseToken: numberSchema,
    leaseExpiresAt: numberSchema,
    heartbeatAt: numberSchema,
  },
  [
    'id',
    'taskListType',
    'entityType',
    'triggerSource',
    'status',
    'summary',
    'progress',
    'completedPhases',
    'totalPhases',
    'completedTasks',
    'totalTasks',
    'input',
    'output',
    'metadata',
    'createdAt',
    'updatedAt',
  ],
);
export const taskSchema = objectSchema(
  {
    id: stringSchema,
    taskListId: stringSchema,
    phaseKey: stringSchema,
    phaseName: stringSchema,
    phaseOrder: numberSchema,
    taskKey: stringSchema,
    name: stringSchema,
    kind: enumSchema([
      'adapter_generation',
      'provider_poll',
      'transform',
      'validation',
      'asset_resolve',
      'metadata_extract',
      'export',
      'cleanup',
    ]),
    status: taskStatusSchema,
    provider: stringSchema,
    dependencyIds: stringArraySchema,
    attempts: numberSchema,
    maxRetries: numberSchema,
    input: canonicalJsonSchema,
    output: canonicalJsonSchema,
    providerTaskId: stringSchema,
    assetId: stringSchema,
    error: stringSchema,
    progress: numberSchema,
    currentStep: stringSchema,
    startedAt: numberSchema,
    completedAt: numberSchema,
    updatedAt: numberSchema,
  },
  [
    'id',
    'taskListId',
    'phaseKey',
    'phaseName',
    'phaseOrder',
    'taskKey',
    'name',
    'kind',
    'status',
    'dependencyIds',
    'attempts',
    'maxRetries',
    'input',
    'output',
    'progress',
    'updatedAt',
  ],
);
export const planDocumentSchema = objectSchema({
  id: stringSchema,
  taskListId: stringSchema,
  logicalKey: stringSchema,
  documentType: stringSchema,
  revision: numberSchema,
  schemaVersion: numberSchema,
  content: canonicalJsonSchema,
  contentHash: stringSchema,
  status: enumSchema(['draft', 'active', 'superseded', 'invalidated']),
  createdAt: numberSchema,
  updatedAt: numberSchema,
});
export const planApprovalSchema = objectSchema(
  {
    id: stringSchema,
    taskListId: stringSchema,
    gateKey: enumSchema(['production_plan', 'visual_constitution', 'delivery']),
    subjectLogicalKey: stringSchema,
    subjectRevision: numberSchema,
    subjectHash: stringSchema,
    manifestHash: stringSchema,
    status: enumSchema(['pending', 'approved', 'rejected', 'invalidated']),
    createdAt: numberSchema,
    updatedAt: numberSchema,
    decidedAt: numberSchema,
  },
  [
    'id',
    'taskListId',
    'gateKey',
    'subjectLogicalKey',
    'subjectRevision',
    'subjectHash',
    'manifestHash',
    'status',
    'createdAt',
    'updatedAt',
  ],
);
export const externalTaskCompletionSchema = objectSchema(
  { taskList: taskListSchema, task: taskSchema, nextTask: taskSchema },
  ['taskList', 'task'],
);

export const audioTaskViewSchema = objectSchema(
  {
    id: stringSchema,
    canvasId: stringSchema,
    subtype: enumSchema(['voice', 'music', 'sfx']),
    prompt: stringSchema,
    providerId: stringSchema,
    status: taskListStatusSchema,
    taskStatus: taskStatusSchema,
    progress: numberSchema,
    currentStep: stringSchema,
    error: stringSchema,
    attempt: canonicalJsonSchema,
    promptAssembly: promptAssemblyRecordSchema,
    artifact: canonicalJsonSchema,
    createdAt: numberSchema,
    updatedAt: numberSchema,
  },
  ['id', 'canvasId', 'subtype', 'prompt', 'providerId', 'status', 'taskStatus', 'progress', 'createdAt', 'updatedAt'],
);

export const productionMediaViewSchema = objectSchema(
  {
    taskListId: stringSchema,
    canvasId: stringSchema,
    nodeId: stringSchema,
    status: stringSchema,
    nextAction: stringSchema,
    message: stringSchema,
    steps: canonicalJsonSchema,
    promptAssembly: objectSchema(
      {
        id: stringSchema,
        status: stringSchema,
        inputHash: stringSchema,
        input: canonicalJsonSchema,
        output: promptAssemblyOutputSchema,
        parentAssemblyId: stringSchema,
        sourceAttemptId: stringSchema,
        error: stringSchema,
      },
      ['id', 'status', 'inputHash', 'input'],
    ),
    attempt: canonicalJsonSchema,
    evaluation: canonicalJsonSchema,
    completion: canonicalJsonSchema,
  },
  ['taskListId', 'canvasId', 'nodeId', 'status'],
);

export const referenceImageSchema = objectSchema(
  {
    slot: stringSchema,
    assetHash: stringSchema,
    isStandard: booleanSchema,
    variants: stringArraySchema,
  },
  ['slot', 'isStandard'],
);

const costumeSchema = objectSchema({ id: stringSchema, name: stringSchema, description: stringSchema });
const loadoutSchema = objectSchema({ id: stringSchema, name: stringSchema, equipmentIds: stringArraySchema });
const stringShape = (...keys: string[]) =>
  objectSchema(Object.fromEntries(keys.map((key) => [key, stringSchema])), []);

export const characterSchema = objectSchema(
  {
    id: stringSchema,
    name: stringSchema,
    role: enumSchema(['protagonist', 'antagonist', 'supporting', 'extra']),
    description: stringSchema,
    appearance: stringSchema,
    personality: stringSchema,
    costumes: arraySchema(costumeSchema),
    tags: stringArraySchema,
    age: numberSchema,
    gender: enumSchema(['male', 'female', 'non-binary', 'other']),
    voice: stringSchema,
    face: stringShape('eyeShape', 'eyeColor', 'noseType', 'lipShape', 'jawline', 'definingFeatures'),
    hair: stringShape('color', 'style', 'length', 'texture'),
    skinTone: stringSchema,
    body: stringShape('height', 'build', 'proportions'),
    distinctTraits: stringArraySchema,
    vocalTraits: stringShape('pitch', 'accent', 'cadence'),
    referenceImages: arraySchema(referenceImageSchema),
    loadouts: arraySchema(loadoutSchema),
    defaultLoadoutId: stringSchema,
    folderId: nullableSchema(stringSchema),
    createdAt: numberSchema,
    updatedAt: numberSchema,
    warnings: stringArraySchema,
  },
  [
    'id',
    'name',
    'role',
    'description',
    'appearance',
    'personality',
    'costumes',
    'tags',
    'referenceImages',
    'loadouts',
    'defaultLoadoutId',
    'createdAt',
    'updatedAt',
  ],
);

export const equipmentSchema = objectSchema(
  {
    id: stringSchema,
    name: stringSchema,
    type: enumSchema(['weapon', 'armor', 'clothing', 'accessory', 'vehicle', 'tool', 'furniture', 'other']),
    subtype: stringSchema,
    description: stringSchema,
    function: stringSchema,
    material: stringSchema,
    color: stringSchema,
    condition: stringSchema,
    visualDetails: stringSchema,
    tags: stringArraySchema,
    referenceImages: arraySchema(referenceImageSchema),
    folderId: nullableSchema(stringSchema),
    createdAt: numberSchema,
    updatedAt: numberSchema,
    warnings: stringArraySchema,
  },
  ['id', 'name', 'type', 'description', 'tags', 'referenceImages', 'createdAt', 'updatedAt'],
);

export const locationSchema = objectSchema(
  {
    id: stringSchema,
    name: stringSchema,
    type: enumSchema(['interior', 'exterior', 'int-ext']),
    subLocation: stringSchema,
    timeOfDay: stringSchema,
    description: stringSchema,
    mood: stringSchema,
    weather: stringSchema,
    lighting: stringSchema,
    architectureStyle: stringSchema,
    dominantColors: stringArraySchema,
    keyFeatures: stringArraySchema,
    atmosphereKeywords: stringArraySchema,
    tags: stringArraySchema,
    referenceImages: arraySchema(referenceImageSchema),
    folderId: nullableSchema(stringSchema),
    createdAt: numberSchema,
    updatedAt: numberSchema,
    warnings: stringArraySchema,
  },
  ['id', 'name', 'description', 'tags', 'referenceImages', 'createdAt', 'updatedAt'],
);

export const authorityViewSchema = unionSchema(
  objectSchema({ kind: { const: 'full-sheet' } }),
  objectSchema({ kind: { const: 'ortho-grid' } }),
  objectSchema({ kind: { const: 'bible' } }),
  objectSchema({ kind: { const: 'fake-360' } }),
  objectSchema({ kind: { const: 'extra-angle' }, angle: stringSchema }),
);

export const warningsSchema = objectSchema({ warnings: stringArraySchema }, []);

export const resolutionIntentSchema = unionSchema(
  objectSchema({ mode: { const: 'provider-default' }, aspectRatio: stringSchema }, ['mode']),
  objectSchema({ mode: { const: 'exact' }, width: numberSchema, height: numberSchema }),
  objectSchema({ mode: { const: 'tier' }, tier: stringSchema, aspectRatio: stringSchema }, ['mode', 'tier']),
);

export const resolvedResolutionSchema = objectSchema(
  {
    providerId: stringSchema,
    mediaType: enumSchema(['image', 'video']),
    source: enumSchema(['node', 'canvas', 'provider']),
    requested: resolutionIntentSchema,
    width: numberSchema,
    height: numberSchema,
    tier: stringSchema,
    aspectRatio: stringSchema,
    providerValue: stringSchema,
    outputKnown: booleanSchema,
  },
  ['providerId', 'mediaType', 'source', 'requested', 'outputKnown'],
);

const resolutionOptionSchema = objectSchema(
  {
    id: stringSchema,
    label: stringSchema,
    mode: enumSchema(['provider-default', 'exact', 'tier']),
    width: numberSchema,
    height: numberSchema,
    tier: stringSchema,
    aspectRatio: stringSchema,
    estimatedOutput: objectSchema({ width: numberSchema, height: numberSchema }, []),
  },
  ['id', 'label', 'mode'],
);
export const resolutionPreflightSchema = unionSchema(
  objectSchema(
    {
      supported: { const: true },
      plan: resolvedResolutionSchema,
      estimatedCostUsd: numberSchema,
      currency: { const: 'USD' },
      warnings: stringArraySchema,
    },
    ['supported', 'plan', 'currency', 'warnings'],
  ),
  objectSchema({
    supported: { const: false },
    code: enumSchema([
      'UNSUPPORTED_EXACT',
      'UNSUPPORTED_TIER',
      'UNSUPPORTED_ASPECT_RATIO',
      'UNDECLARED_CAPABILITY',
    ]),
    reason: stringSchema,
    alternatives: arraySchema(resolutionOptionSchema),
  }),
);

export const resolutionAuditSchema = objectSchema(
  {
    requested: resolutionIntentSchema,
    resolved: resolvedResolutionSchema,
    actual: objectSchema({ width: numberSchema, height: numberSchema }),
    estimatedCostUsd: numberSchema,
    reportedActualCostUsd: numberSchema,
  },
  ['requested', 'resolved'],
);

const visualStyleGrammarSchema = objectSchema({
  medium: stringSchema,
  era: stringSchema,
  rendering: stringSchema,
  linework: stringSchema,
  palette: stringSchema,
  lighting: stringSchema,
  texture: stringSchema,
  mood: stringSchema,
  cameraGrammar: stringSchema,
  lensGrammar: stringSchema,
  compositionGrammar: stringSchema,
  motionGrammar: stringSchema,
  characterAnchors: stringArraySchema,
  locationAnchors: stringArraySchema,
  negativeConstraints: stringArraySchema,
});

export const visualStylePolicySchema = objectSchema(
  {
    version: { const: 1 },
    summary: stringSchema,
    locked: objectSchema(visualStyleGrammarSchema.properties, []),
    allowedVariations: stringArraySchema,
    negativeConstraints: stringArraySchema,
  },
  ['version'],
);

const visualStyleProvenanceSchema = objectSchema(
  {
    source: enumSchema(['canvas-draft', 'legacy-style-plate', 'visual-constitution']),
    policyHash: stringSchema,
    taskListId: stringSchema,
    revision: numberSchema,
    contentHash: stringSchema,
  },
  ['source', 'policyHash'],
);

const generationEntityRefSchema = objectSchema({ entityId: stringSchema, imageHashes: stringArraySchema });
const frameReferenceHashesSchema = objectSchema({ first: stringSchema, last: stringSchema }, []);

const assetGenerationMetadataSchema = objectSchema(
  {
    prompt: stringSchema,
    negativePrompt: stringSchema,
    provider: stringSchema,
    seed: numberSchema,
    width: numberSchema,
    height: numberSchema,
    sourceImageHash: stringSchema,
    characterRefs: arraySchema(generationEntityRefSchema),
    equipmentRefs: arraySchema(generationEntityRefSchema),
    locationRefs: arraySchema(generationEntityRefSchema),
    frameReferenceHashes: frameReferenceHashesSchema,
    steps: numberSchema,
    cfgScale: numberSchema,
    scheduler: stringSchema,
    img2imgStrength: numberSchema,
    model: stringSchema,
    generationTimeMs: numberSchema,
    cost: numberSchema,
    taskListId: stringSchema,
    taskId: stringSchema,
    attemptId: stringSchema,
    promptAssemblyId: stringSchema,
    specHash: stringSchema,
    promptHash: stringSchema,
    referenceAssetHashes: stringArraySchema,
    estimatedCostUsd: numberSchema,
    reportedActualCostUsd: numberSchema,
    resolution: resolutionAuditSchema,
    visualStyle: visualStyleProvenanceSchema,
    sourceVideoHash: stringSchema,
    timestampSeconds: numberSchema,
    rubricVersion: stringSchema,
  },
  ['prompt', 'provider'],
);

export const assetRefSchema = objectSchema({
  hash: stringSchema,
  type: enumSchema(['image', 'video', 'audio']),
  format: stringSchema,
  path: stringSchema,
});

export const assetEntrySchema = objectSchema(
  {
    id: stringSchema,
    displayName: stringSchema,
    tags: stringArraySchema,
    folderId: nullableSchema(stringSchema),
    hash: stringSchema,
    type: enumSchema(['image', 'video', 'audio']),
    format: stringSchema,
    originalName: stringSchema,
    fileSize: numberSchema,
    width: numberSchema,
    height: numberSchema,
    duration: numberSchema,
    hasAudio: booleanSchema,
    prompt: stringSchema,
    provider: stringSchema,
    generationMetadata: assetGenerationMetadataSchema,
    createdAt: numberSchema,
    contentCreatedAt: numberSchema,
  },
  [
    'id',
    'displayName',
    'tags',
    'folderId',
    'hash',
    'type',
    'format',
    'originalName',
    'fileSize',
    'createdAt',
    'contentCreatedAt',
  ],
);

const colorSwatchSchema = objectSchema(
  { hex: stringSchema, name: stringSchema, weight: numberSchema },
  ['hex', 'weight'],
);
const gradientStopSchema = objectSchema({ hex: stringSchema, position: numberSchema });
const gradientSchema = objectSchema(
  {
    type: enumSchema(['linear', 'radial']),
    angle: numberSchema,
    stops: arraySchema(gradientStopSchema),
  },
  ['type', 'stops'],
);
const exposureSchema = objectSchema({
  brightness: numberSchema,
  contrast: numberSchema,
  highlights: numberSchema,
  shadows: numberSchema,
  temperature: numberSchema,
  tint: numberSchema,
});

export const colorStyleSchema = objectSchema({
  id: stringSchema,
  name: stringSchema,
  sourceType: enumSchema(['manual', 'image', 'video']),
  sourceAsset: stringSchema,
  palette: arraySchema(colorSwatchSchema),
  gradients: arraySchema(gradientSchema),
  exposure: exposureSchema,
  tags: stringArraySchema,
  createdAt: numberSchema,
  updatedAt: numberSchema,
}, ['id', 'name', 'sourceType', 'palette', 'gradients', 'exposure', 'tags', 'createdAt', 'updatedAt']);
