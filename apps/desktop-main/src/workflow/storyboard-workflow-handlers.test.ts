import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CAS, SqliteIndex } from '@lucid-fin/storage';
import { AdapterRegistry } from '@lucid-fin/adapters-ai';
import type {
  AIProviderAdapter,
  GenerationRequest,
  GenerationResult,
  JobStatus,
  Scene,
} from '@lucid-fin/contracts';
import { WorkflowEngine, registerDefaultWorkflows } from '@lucid-fin/application';
import { createStoryboardWorkflowHandlers } from './storyboard-workflow-handlers.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-storyboard-workflow-'));
}

describe('createStoryboardWorkflowHandlers', () => {
  let base: string;
  let db: SqliteIndex;
  let cas: CAS;
  let registry: AdapterRegistry;
  let variantCounter: number;

  beforeEach(() => {
    base = tmpDir();
    db = new SqliteIndex(path.join(base, 'test.db'));
    cas = new CAS(path.join(base, 'global-assets'));
    cas.setProjectRoot(base);
    registry = new AdapterRegistry();
    variantCounter = 0;

    const scene: Scene = {
      id: 'scene-1',
      index: 0,
      title: 'Opening Scene',
      description: 'Intro shot',
      location: 'Studio',
      timeOfDay: 'Day',
      characters: [],
      keyframes: [
        {
          id: 'kf-1',
          sceneId: 'scene-1',
          index: 0,
          prompt: 'Wide cinematic frame',
          negativePrompt: 'low detail',
          status: 'draft',
          variants: [],
          seed: 42,
          createdAt: 100,
          updatedAt: 100,
        },
      ],
      segments: [],
      createdAt: 100,
      updatedAt: 100,
    };
    db.upsertScene(scene);

    const adapter: AIProviderAdapter = {
      id: 'flux',
      name: 'Flux',
      type: 'image',
      capabilities: ['text-to-image'],
      maxConcurrent: 2,
      configure() {},
      validate: vi.fn(async () => true),
      generate: vi.fn(async (request: GenerationRequest): Promise<GenerationResult> => {
        variantCounter += 1;
        const filePath = path.join(base, `variant-${variantCounter}.png`);
        fs.writeFileSync(filePath, `image-${variantCounter}-${request.prompt}`);
        return {
          assetHash: '',
          assetPath: filePath,
          provider: 'flux',
          cost: 0.01,
          metadata: {
            seed: request.seed,
          },
        };
      }),
      estimateCost: vi.fn(() => ({
        provider: 'flux',
        estimatedCost: 0.01,
        currency: 'USD',
        unit: 'per image',
      })),
      checkStatus: vi.fn(async () => 'completed' as JobStatus),
      cancel: vi.fn(async () => undefined),
    };
    registry.register(adapter);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  it('executes storyboard.generate end-to-end and persists generated variants onto the target keyframe', async () => {
    const ids = [
      'wf-1',
      'stage-prepare',
      'task-validate',
      'stage-generate',
      'task-generate',
      'stage-publish',
      'task-publish',
      'artifact-1',
      'artifact-2',
      'artifact-3',
      'artifact-4',
    ];
    const nextId = () => ids.shift() ?? `generated-${Math.random()}`;

    const workflowEngine = new WorkflowEngine({
      db,
      registry: registerDefaultWorkflows(),
      handlers: createStoryboardWorkflowHandlers({
        cas,
        adapterRegistry: registry,
        now: () => 1000,
        idFactory: nextId,
      }),
      idFactory: nextId,
      now: () => 1000,
    });

    const workflowRunId = workflowEngine.start({
      workflowType: 'storyboard.generate',
      entityType: 'scene',
      entityId: 'scene-1',
      input: {
        sceneId: 'scene-1',
        keyframeId: 'kf-1',
        prompt: 'Wide cinematic frame',
        negativePrompt: 'low detail',
        seed: 42,
        variantCount: 4,
        width: 1024,
        height: 1024,
      },
      metadata: {
        relatedEntityLabel: 'Opening Scene · KF 1',
        sceneTitle: 'Opening Scene',
        keyframeId: 'kf-1',
      },
    });

    await workflowEngine.waitForAutoPump();
    const workflow = workflowEngine.get(workflowRunId);
    const scene = db.getScene('scene-1');
    const assets = db.queryAssets({
      type: 'image',
      limit: 20,
    });
    const artifacts = db.listWorkflowArtifacts(workflowRunId);

    expect(workflow).toEqual(
      expect.objectContaining({
        id: workflowRunId,
        status: 'completed',
        output: expect.objectContaining({
          sceneId: 'scene-1',
          keyframeId: 'kf-1',
          variantAssetHashes: expect.any(Array),
        }),
      }),
    );
    expect(scene?.keyframes[0]).toEqual(
      expect.objectContaining({
        id: 'kf-1',
        status: 'review',
        variants: expect.any(Array),
      }),
    );
    expect(scene?.keyframes[0].variants).toHaveLength(4);
    expect(assets).toHaveLength(4);
    expect(artifacts).toHaveLength(4);
    expect(artifacts[0]).toEqual(
      expect.objectContaining({
        artifactType: 'storyboard_variant',
        entityType: 'scene',
        entityId: 'scene-1',
      }),
    );
  });

  it('materializes remote storyboard outputs returned via metadata.url before publishing them', async () => {
    const remoteRegistry = new AdapterRegistry();
    let downloadCount = 0;
    const fetchMock = vi.fn(async () => {
      downloadCount += 1;

      return new Response(`remote-image-bytes-${downloadCount}`, {
        status: 200,
        headers: {
          'content-type': 'image/png',
        },
      });
    });

    vi.stubGlobal('fetch', fetchMock);

    remoteRegistry.register({
      id: 'flux',
      name: 'Flux',
      type: 'image',
      capabilities: ['text-to-image'],
      maxConcurrent: 2,
      configure() {},
      validate: vi.fn(async () => true),
      generate: vi.fn(
        async (request: GenerationRequest): Promise<GenerationResult> => ({
          assetHash: '',
          assetPath: '',
          provider: 'flux',
          cost: 0.02,
          metadata: {
            url: `https://example.com/generated/${request.seed}.png`,
            seed: request.seed,
          },
        }),
      ),
      estimateCost: vi.fn(() => ({
        provider: 'flux',
        estimatedCost: 0.02,
        currency: 'USD',
        unit: 'per image',
      })),
      checkStatus: vi.fn(async () => 'completed' as JobStatus),
      cancel: vi.fn(async () => undefined),
    });

    const ids = [
      'wf-remote',
      'stage-prepare-remote',
      'task-validate-remote',
      'stage-generate-remote',
      'task-generate-remote',
      'stage-publish-remote',
      'task-publish-remote',
      'artifact-remote-1',
      'artifact-remote-2',
    ];
    const nextId = () => ids.shift() ?? `generated-${Math.random()}`;

    const workflowEngine = new WorkflowEngine({
      db,
      registry: registerDefaultWorkflows(),
      handlers: createStoryboardWorkflowHandlers({
        cas,
        adapterRegistry: remoteRegistry,
        now: () => 2000,
        idFactory: nextId,
      }),
      idFactory: nextId,
      now: () => 2000,
    });

    const _workflowRunId = workflowEngine.start({
      workflowType: 'storyboard.generate',
      entityType: 'scene',
      entityId: 'scene-1',
      input: {
        sceneId: 'scene-1',
        keyframeId: 'kf-1',
        prompt: 'Remote cinematic frame',
        variantCount: 2,
        seed: 99,
      },
    });

    await workflowEngine.waitForAutoPump();

    const scene = db.getScene('scene-1');
    const assets = db.queryAssets({
      type: 'image',
      limit: 20,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(scene?.keyframes[0].status).toBe('review');
    expect(scene?.keyframes[0].variants).toHaveLength(2);
    expect(assets).toHaveLength(2);
  });
});
