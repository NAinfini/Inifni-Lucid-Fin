import type {
  AIProviderAdapter,
  Canvas,
  GenerationRequest,
  PromptAssemblyRecord,
  Task,
} from '@lucid-fin/contracts';
import { describe, expect, it } from 'vitest';
import type { BuiltGenerationContext } from '../ipc/handlers/generation-types.js';
import { buildMediaGenerationSpec } from './media-generation-spec.js';

describe('buildMediaGenerationSpec', () => {
  it('keeps the complete provider request and ordered reference semantics', () => {
    const request: GenerationRequest = {
      type: 'video',
      providerId: 'video-provider',
      prompt: 'exact prompt',
      negativePrompt: 'exact negative',
      sourceImageHash: 'source-hash',
      referenceImages: ['character-hash'],
      frameReferenceImages: { first: 'first-hash', last: 'last-hash' },
      width: 1920,
      height: 1080,
    };
    const spec = buildMediaGenerationSpec({
      scope: 'canvas',
      authority: { kind: 'task-list' },
      taskListId: 'task-list-1',
      task: task(),
      canvas: canvas(),
      node: canvas().nodes[0]!,
      context: context(request),
      request,
      promptAssembly: assembly(),
      limits: {
        maxAttemptsPerShot: 1,
        maxRegenerations: 0,
        maxTotalCostUsd: 0.5,
        styleAuditionCommittedCostUsd: 0,
      },
      lineage: { purpose: 'initial', variantIndex: 0, variantCount: 1 },
      createdAt: 20,
    });

    expect(spec).toMatchObject({
      specVersion: 3,
      scope: 'canvas',
      taskId: 'task-1',
      canvasUpdatedAt: 10,
      nodeUpdatedAt: 10,
      operation: 'image-to-video',
      providerId: 'video-provider',
      modelId: 'video-model',
      prompt: 'exact prompt',
      negativePrompt: 'exact negative',
      request,
    });
    expect(spec.referenceEvidence.map((reference) => reference.assetHash)).toEqual([
      'first-hash',
      'source-hash',
      'character-hash',
      'last-hash',
    ]);
    expect(spec.referenceEvidence.find((reference) => reference.assetHash === 'character-hash'))
      .toMatchObject({ roles: [{ role: 'character', entityId: 'character-1' }] });
  });

  it('rejects any host-side prompt mutation', () => {
    const request = { ...contextRequest(), prompt: 'mutated by host' };
    expect(() =>
      buildMediaGenerationSpec({
        scope: 'canvas',
        authority: { kind: 'task-list' },
        taskListId: 'task-list-1',
        task: task(),
        canvas: canvas(),
        node: canvas().nodes[0]!,
        context: context(request),
        request,
        promptAssembly: assembly(),
        limits: {
          maxAttemptsPerShot: 1,
          maxRegenerations: 0,
          maxTotalCostUsd: 0.5,
          styleAuditionCommittedCostUsd: 0,
        },
        lineage: { purpose: 'initial', variantIndex: 0, variantCount: 1 },
        createdAt: 20,
      }),
    ).toThrow('does not exactly match');
  });
});

function contextRequest(): GenerationRequest {
  return {
    type: 'video',
    providerId: 'video-provider',
    prompt: 'exact prompt',
    negativePrompt: 'exact negative',
  };
}

function context(request: GenerationRequest): BuiltGenerationContext {
  return {
    canvas: canvas(),
    node: canvas().nodes[0]!,
    requestBase: request,
    adapter: { id: 'video-provider' } as AIProviderAdapter,
    nodeType: 'video',
    generationType: 'video',
    mode: 'image-to-video',
    variantCount: 1,
    compiled: { prompt: request.prompt, params: {}, diagnostics: [] },
    resolvedEntityRefs: {
      characterRefs: [{ entityId: 'character-1', imageHashes: ['character-hash'] }],
    },
  };
}

function canvas(): Canvas {
  return {
    id: 'canvas-1',
    name: 'Canvas',
    nodes: [
      {
        id: 'node-1',
        type: 'video',
        position: { x: 0, y: 0 },
        data: { label: 'Shot', prompt: 'user prompt', status: 'idle' },
        createdAt: 10,
        updatedAt: 10,
      },
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: 10,
    updatedAt: 10,
  };
}

function task(): Task {
  return {
    id: 'task-1',
    taskListId: 'task-list-1',
    phaseKey: 'generation',
    phaseName: 'Media generation',
    phaseOrder: 0,
    taskKey: 'generate-media',
    name: 'Generate media',
    kind: 'adapter_generation',
    status: 'running',
    dependencyIds: [],
    attempts: 1,
    maxRetries: 0,
    input: { taskRole: 'canvas_media' },
    output: {},
    progress: 0,
    updatedAt: 10,
  };
}

function assembly(): PromptAssemblyRecord {
  return {
    id: 'assembly-1',
    canvasId: 'canvas-1',
    nodeId: 'node-1',
    nodeUpdatedAt: 10,
    mediaType: 'video',
    mode: 'image-to-video',
    purpose: 'initial',
    inputHash: 'input-hash',
    input: {
      version: 1,
      assemblyId: 'assembly-1',
      canvasId: 'canvas-1',
      nodeId: 'node-1',
      nodeUpdatedAt: 10,
      mediaType: 'video',
      mode: 'image-to-video',
      purpose: 'initial',
      authority: { kind: 'task-list', taskListId: 'task-list-1', taskId: 'task-1' },
      sources: [],
      conditioningManifest: [],
      providerProfile: {
        providerId: 'video-provider',
        model: 'video-model',
        capabilities: ['image-to-video'],
      },
      hostConstraints: { immutable: [] },
      inputHash: 'input-hash',
    },
    output: {
      version: 1,
      assemblyId: 'assembly-1',
      inputHash: 'input-hash',
      finalPrompt: 'exact prompt',
      negativePrompt: 'exact negative',
      sourceDecisions: [],
      summary: 'assembled',
      warnings: [],
    },
    status: 'assembled',
    rowVersion: 1,
    taskListId: 'task-list-1',
    taskId: 'task-1',
    createdAt: 10,
    updatedAt: 10,
  };
}
