import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { LLMAdapter } from '@lucid-fin/contracts';
import { WorkflowEngine, registerDefaultWorkflows } from '@lucid-fin/application';
import { LLMRegistry } from '@lucid-fin/adapters-ai';
import { SqliteIndex } from '@lucid-fin/storage';
import { createStyleWorkflowHandlers } from './style-workflow-handlers.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-style-workflow-'));
}

async function* emptyStream() {
  yield '';
}

describe('createStyleWorkflowHandlers', () => {
  let base: string;
  let db: SqliteIndex;
  let llmRegistry: LLMRegistry;
  let assetPath: string;
  let completeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    base = tmpDir();
    db = new SqliteIndex(path.join(base, 'test.db'));
    llmRegistry = new LLMRegistry();
    assetPath = path.join(base, 'reference.png');
    fs.writeFileSync(assetPath, 'fake-image-bytes');

    db.repos.assets.insert({
      hash: 'asset-hash',
      type: 'image',
      format: 'png',
      originalName: 'reference.png',
      fileSize: 16,
      tags: [],
      createdAt: 100,
    });

    completeMock = vi.fn(async () =>
      JSON.stringify({
        palette: [
          { hex: '#112233', name: 'Ink', weight: 0.7 },
          { hex: '#445566', name: 'Steel', weight: 0.3 },
        ],
        gradients: [
          {
            type: 'linear',
            angle: 90,
            stops: [
              { hex: '#112233', position: 0 },
              { hex: '#445566', position: 1 },
            ],
          },
        ],
        exposure: {
          brightness: 12,
          contrast: -5,
          highlights: 8,
          shadows: -9,
          temperature: 6100,
          tint: 4,
        },
      }),
    );

    const adapter: LLMAdapter = {
      id: 'mock-llm',
      name: 'Mock LLM',
      capabilities: ['text-generation'],
      configure() {},
      validate: vi.fn(async () => true),
      complete: completeMock,
      stream: emptyStream,
    };
    llmRegistry.register(adapter);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('executes style.extract end-to-end and persists a generated color style artifact', async () => {
    const ids = [
      'wf-1',
      'stage-resolve',
      'task-resolve',
      'stage-extract',
      'task-extract',
      'stage-persist',
      'task-persist',
      'color-style-1',
      'artifact-1',
    ];
    const nextId = () => ids.shift() ?? `generated-${Math.random()}`;

    const workflowEngine = new WorkflowEngine({
      db,
      registry: registerDefaultWorkflows(),
      handlers: createStyleWorkflowHandlers({
        cas: {
          getAssetPath: () => assetPath,
        } as Parameters<typeof createStyleWorkflowHandlers>[0]['cas'],
        llmRegistry,
        now: () => 1000,
        idFactory: nextId,
      }),
      idFactory: nextId,
      now: () => 1000,
    });

    const workflowRunId = workflowEngine.start({
      workflowType: 'style.extract',
      entityType: 'asset',
      entityId: 'asset-hash',
      input: {
        assetHash: 'asset-hash',
        assetType: 'image',
      },
      metadata: {
        relatedEntityLabel: 'Reference asset',
      },
    });

    await workflowEngine.waitForAutoPump();
    const styles = db.repos.colorStyles.list();
    const workflow = workflowEngine.get(workflowRunId);
    const persistArtifacts = db.repos.workflows.listArtifactsByTaskRun('task-persist');

    expect(styles).toEqual([
      expect.objectContaining({
        id: 'color-style-1',
        sourceType: 'image',
        sourceAsset: 'asset-hash',
        tags: ['ai-extracted'],
        palette: [
          expect.objectContaining({ hex: '#112233' }),
          expect.objectContaining({ hex: '#445566' }),
        ],
      }),
    ]);
    expect(workflow).toEqual(
      expect.objectContaining({
        id: workflowRunId,
        status: 'completed',
        output: expect.objectContaining({
          colorStyleId: 'color-style-1',
        }),
      }),
    );
    expect(persistArtifacts).toEqual([
      expect.objectContaining({
        id: 'artifact-1',
        artifactType: 'color_style',
        entityType: 'color_style',
        entityId: 'color-style-1',
        assetHash: 'asset-hash',
      }),
    ]);
  });

  it('extracts a video frame before calling the LLM for video assets', async () => {
    const videoPath = path.join(base, 'clip.mp4');
    fs.writeFileSync(videoPath, 'fake-video-bytes');
    db.repos.assets.insert({
      hash: 'video-hash',
      type: 'video',
      format: 'mp4',
      originalName: 'clip.mp4',
      fileSize: 42,
      tags: [],
      createdAt: 100,
    });

    const framePath = path.join(base, 'video-frame.png');
    const videoFrameExtractor = vi.fn(async (inputPath: string) => {
      expect(inputPath).toBe(videoPath);
      fs.writeFileSync(framePath, 'frame-bytes');
      return {
        imagePath: framePath,
        mimeType: 'image/png',
      };
    });

    const ids = [
      'wf-video',
      'stage-resolve-video',
      'task-resolve-video',
      'stage-extract-video',
      'task-extract-video',
      'stage-persist-video',
      'task-persist-video',
      'color-style-video',
      'artifact-video',
    ];
    const nextId = () => ids.shift() ?? `generated-${Math.random()}`;

    const workflowEngine = new WorkflowEngine({
      db,
      registry: registerDefaultWorkflows(),
      handlers: createStyleWorkflowHandlers({
        cas: {
          getAssetPath: (hash: string) => (hash === 'video-hash' ? videoPath : assetPath),
        } as Parameters<typeof createStyleWorkflowHandlers>[0]['cas'],
        llmRegistry,
        now: () => 1000,
        idFactory: nextId,
        videoFrameExtractor,
      }),
      idFactory: nextId,
      now: () => 1000,
    });

    const _workflowRunId = workflowEngine.start({
      workflowType: 'style.extract',
      entityType: 'asset',
      entityId: 'video-hash',
      input: {
        assetHash: 'video-hash',
        assetType: 'video',
      },
      metadata: {
        relatedEntityLabel: 'Video asset',
      },
    });

    await workflowEngine.waitForAutoPump();

    expect(videoFrameExtractor).toHaveBeenCalledTimes(1);
    expect(completeMock).toHaveBeenCalledTimes(1);

    const callArgs = completeMock.mock.calls[0][0] as Array<{
      images?: Array<{ data: string; mimeType: string }>;
    }>;
    const image = callArgs[0]?.images?.[0];

    expect(image?.mimeType).toBe('image/png');
    expect(Buffer.from(image?.data ?? '', 'base64').toString()).toBe('frame-bytes');
  });
});
