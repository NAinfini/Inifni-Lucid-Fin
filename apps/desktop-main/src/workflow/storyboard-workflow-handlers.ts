import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AdapterRegistry } from '@lucid-fin/adapters-ai';
import type { WorkflowTaskExecutionContext, WorkflowTaskHandler } from '@lucid-fin/application';
import type { AIProviderAdapter, GenerationRequest, Keyframe, Scene } from '@lucid-fin/contracts';
import { TaskKind, TaskRunStatus } from '@lucid-fin/contracts';
import type { CAS } from '@lucid-fin/storage';

type StoryboardWorkflowHandlerOptions = {
  cas: CAS;
  adapterRegistry: AdapterRegistry;
  now?: () => number;
  idFactory?: () => string;
  fetchImpl?: typeof fetch;
};

type GeneratedStoryboardVariant = {
  assetHash: string;
  assetPath: string;
  provider: string;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  width?: number;
  height?: number;
  sourceUrl?: string;
};

type MaterializedAsset = {
  filePath: string;
  cleanupPath?: string;
  sourceUrl?: string;
};

export function createStoryboardWorkflowHandlers(
  options: StoryboardWorkflowHandlerOptions,
): WorkflowTaskHandler[] {
  const now = options.now ?? (() => Date.now());
  const nextId = options.idFactory ?? randomUUID;
  const fetchImpl = options.fetchImpl ?? fetch;

  return [
    {
      id: 'storyboard.validate-input',
      kind: TaskKind.Validation,
      async execute(context) {
        const scene = getScene(context);
        const keyframe = getKeyframe(scene, context.taskRun.input.keyframeId);
        const prompt = readRequiredPrompt(context.taskRun.input.prompt ?? keyframe.prompt);
        const negativePrompt = readOptionalString(
          context.taskRun.input.negativePrompt ?? keyframe.negativePrompt,
        );
        const variantCount = readPositiveInteger(
          context.taskRun.input.variantCount,
          'variantCount',
          4,
        );
        const width = readPositiveInteger(context.taskRun.input.width, 'width', 1024);
        const height = readPositiveInteger(context.taskRun.input.height, 'height', 1024);
        const provider =
          readOptionalString(context.taskRun.provider) ??
          readOptionalString(context.taskRun.input.provider) ??
          readOptionalString(context.workflowRun.metadata.provider);
        const seed = readOptionalInteger(context.taskRun.input.seed ?? keyframe.seed, 'seed');

        return {
          status: TaskRunStatus.Completed,
          progress: 100,
          currentStep: 'validated',
          output: {
            sceneId: scene.id,
            sceneTitle: scene.title,
            keyframeId: keyframe.id,
            keyframeIndex: keyframe.index,
            prompt,
            negativePrompt,
            variantCount,
            width,
            height,
            seed,
            provider,
          },
        };
      },
    },
    {
      id: 'storyboard.generate.frames',
      kind: TaskKind.AdapterGeneration,
      async execute(context) {
        const validated = getTaskOutput(context, 'validate-storyboard-input');
        const prompt = readRequiredPrompt(validated.prompt);
        const negativePrompt = readOptionalString(validated.negativePrompt);
        const sceneId = readRequiredString(validated.sceneId, 'sceneId');
        const keyframeId = readRequiredString(validated.keyframeId, 'keyframeId');
        const variantCount = readPositiveInteger(validated.variantCount, 'variantCount');
        const width = readPositiveInteger(validated.width, 'width');
        const height = readPositiveInteger(validated.height, 'height');
        const provider =
          readOptionalString(validated.provider) ?? resolveRequestedProvider(context);
        const baseSeed = readOptionalInteger(validated.seed, 'seed');
        const adapter = resolveImageAdapter(options.adapterRegistry, provider);
        const variants: GeneratedStoryboardVariant[] = [];

        for (let index = 0; index < variantCount; index += 1) {
          const request: GenerationRequest = {
            type: 'image',
            providerId: adapter.id,
            prompt,
            negativePrompt,
            width,
            height,
            seed: typeof baseSeed === 'number' ? baseSeed + index : undefined,
          };
          const generated = await adapter.generate(request);
          const materialized = await materializeAsset(generated, fetchImpl, now);

          try {
            const { ref, meta } = await options.cas.importAsset(materialized.filePath, 'image');
            const createdAt = now();

            context.db.insertAsset({
              ...meta,
              projectId: context.workflowRun.projectId,
              prompt,
              provider: adapter.id,
              tags: [
                'storyboard',
                `scene:${sceneId}`,
                `keyframe:${keyframeId}`,
                `variant:${index + 1}`,
              ],
            });

            context.db.insertWorkflowArtifact({
              id: nextId(),
              workflowRunId: context.workflowRun.id,
              taskRunId: context.taskRun.id,
              artifactType: 'storyboard_variant',
              entityType: context.workflowRun.entityType,
              entityId: context.workflowRun.entityId,
              assetHash: ref.hash,
              path: ref.path,
              metadata: {
                sceneId,
                keyframeId,
                variantIndex: index,
                provider: adapter.id,
                prompt,
                negativePrompt,
                seed: request.seed,
                width,
                height,
                sourceUrl: materialized.sourceUrl,
              },
              createdAt,
            });

            variants.push({
              assetHash: ref.hash,
              assetPath: ref.path,
              provider: adapter.id,
              prompt,
              negativePrompt,
              seed: request.seed,
              width,
              height,
              sourceUrl: materialized.sourceUrl,
            });
          } finally {
            if (materialized.cleanupPath) {
              fs.rmSync(materialized.cleanupPath, { recursive: true, force: true });
            }
          }
        }

        return {
          status: TaskRunStatus.Completed,
          progress: 100,
          currentStep: 'generated',
          output: {
            sceneId,
            keyframeId,
            provider: adapter.id,
            variantAssetHashes: variants.map((variant) => variant.assetHash),
            variants,
          },
        };
      },
    },
    {
      id: 'storyboard.publish',
      kind: TaskKind.Transform,
      async execute(context) {
        const validated = getTaskOutput(context, 'validate-storyboard-input');
        const generated = getTaskOutput(context, 'generate-frames');
        const scene = getScene(context, validated.sceneId);
        const keyframe = getKeyframe(scene, validated.keyframeId);
        const prompt = readRequiredPrompt(validated.prompt ?? keyframe.prompt);
        const negativePrompt = readOptionalString(
          validated.negativePrompt ?? keyframe.negativePrompt,
        );
        const seed = readOptionalInteger(validated.seed ?? keyframe.seed, 'seed');
        const variantAssetHashes = readStringArray(generated.variantAssetHashes);

        if (variantAssetHashes.length === 0) {
          throw new Error('Storyboard generation produced no variant assets');
        }

        const updatedAt = now();
        const publishedKeyframe: Keyframe = {
          ...keyframe,
          prompt,
          negativePrompt,
          assetHash: variantAssetHashes[0],
          status: 'review',
          variants: variantAssetHashes,
          seed,
          updatedAt,
        };
        const updatedScene: Scene = {
          ...scene,
          keyframes: scene.keyframes.map((entry) =>
            entry.id === publishedKeyframe.id ? publishedKeyframe : entry,
          ),
          updatedAt,
        };
        const output = {
          sceneId: scene.id,
          keyframeId: publishedKeyframe.id,
          primaryAssetHash: variantAssetHashes[0],
          variantAssetHashes,
          provider:
            readOptionalString(generated.provider) ?? readOptionalString(validated.provider),
          variantCount: variantAssetHashes.length,
        };

        context.db.upsertScene(updatedScene);
        context.db.updateWorkflowRun(context.workflowRun.id, {
          output: {
            ...context.workflowRun.output,
            ...output,
          },
          updatedAt,
        });

        return {
          status: TaskRunStatus.Completed,
          progress: 100,
          currentStep: 'published',
          output,
        };
      },
    },
  ];
}

function getTaskOutput(
  context: WorkflowTaskExecutionContext,
  taskId: string,
): Record<string, unknown> {
  const taskRun = context.db
    .listWorkflowTaskRuns(context.workflowRun.id)
    .find((entry) => entry.taskId === taskId);

  if (!taskRun) {
    throw new Error(`Workflow task "${taskId}" not found in run ${context.workflowRun.id}`);
  }

  return taskRun.output;
}

function getScene(
  context: WorkflowTaskExecutionContext,
  sceneIdValue: unknown = context.taskRun.input.sceneId,
): Scene {
  const sceneId = readRequiredString(sceneIdValue, 'sceneId');
  const scene = context.db.getScene(sceneId);

  if (!scene) {
    throw new Error(`Scene not found: ${sceneId}`);
  }
  if (scene.projectId !== context.workflowRun.projectId) {
    throw new Error(
      `Scene "${sceneId}" does not belong to project ${context.workflowRun.projectId}`,
    );
  }

  return scene;
}

function getKeyframe(scene: Scene, keyframeIdValue: unknown): Keyframe {
  const keyframeId = readRequiredString(keyframeIdValue, 'keyframeId');
  const keyframe = scene.keyframes.find((entry) => entry.id === keyframeId);

  if (!keyframe) {
    throw new Error(`Keyframe not found: ${keyframeId}`);
  }

  return keyframe;
}

function resolveRequestedProvider(context: WorkflowTaskExecutionContext): string {
  const requested =
    readOptionalString(context.taskRun.provider) ??
    readOptionalString(context.taskRun.input.provider) ??
    readOptionalString(context.workflowRun.metadata.provider);

  if (requested) {
    return requested;
  }

  throw new Error('No storyboard image provider configured');
}

function resolveImageAdapter(registry: AdapterRegistry, providerId: string): AIProviderAdapter {
  const adapter = registry.get(providerId);

  if (!adapter) {
    throw new Error(`Storyboard image provider "${providerId}" is not registered`);
  }

  const adapterTypes = Array.isArray(adapter.type) ? adapter.type : [adapter.type];
  if (!adapterTypes.includes('image')) {
    throw new Error(`Storyboard provider "${providerId}" does not support image generation`);
  }

  return adapter;
}

async function materializeAsset(
  generated: { assetPath: string; metadata?: Record<string, unknown> },
  fetchImpl: typeof fetch,
  now: () => number,
): Promise<MaterializedAsset> {
  const assetPath = readOptionalString(generated.assetPath);
  if (assetPath) {
    if (isRemoteUrl(assetPath)) {
      return downloadRemoteAsset(assetPath, fetchImpl, now);
    }
    if (!fs.existsSync(assetPath)) {
      throw new Error(`Generated asset path not found on disk: ${assetPath}`);
    }
    return { filePath: assetPath };
  }

  const metadataUrl = readOptionalString(generated.metadata?.url);
  if (metadataUrl) {
    return downloadRemoteAsset(metadataUrl, fetchImpl, now);
  }

  throw new Error('Generated asset did not include a usable file path or download URL');
}

async function downloadRemoteAsset(
  url: string,
  fetchImpl: typeof fetch,
  now: () => number,
): Promise<MaterializedAsset> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Failed to download generated asset: ${response.status}`);
  }

  const contentType = response.headers.get('content-type');
  const ext = pickFileExtension(url, contentType);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-storyboard-'));
  const filePath = path.join(dir, `generated-${now()}.${ext}`);
  const buffer = Buffer.from(await response.arrayBuffer());

  fs.writeFileSync(filePath, buffer);

  return {
    filePath,
    cleanupPath: dir,
    sourceUrl: url,
  };
}

function pickFileExtension(url: string, contentType: string | null): string {
  const fromUrl = extensionFromUrl(url);
  if (fromUrl) {
    return fromUrl;
  }

  const fromContentType = extensionFromContentType(contentType);
  if (fromContentType) {
    return fromContentType;
  }

  return 'png';
}

function extensionFromUrl(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).slice(1).toLowerCase();
    return ext.length > 0 ? ext : undefined;
  } catch { /* malformed URL — extension cannot be determined, return undefined */
    return undefined;
  }
}

function extensionFromContentType(contentType: string | null): string | undefined {
  switch (contentType?.split(';')[0].trim().toLowerCase()) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return undefined;
  }
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function readRequiredPrompt(value: unknown): string {
  const prompt = readOptionalString(value);
  if (!prompt) {
    throw new Error('prompt is required');
  }
  return prompt;
}

function readRequiredString(value: unknown, field: string): string {
  const stringValue = readOptionalString(value);
  if (!stringValue) {
    throw new Error(`${field} is required`);
  }
  return stringValue;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readPositiveInteger(value: unknown, field: string, fallback?: number): number {
  if (value == null && typeof fallback === 'number') {
    return fallback;
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
  return numeric;
}

function readOptionalInteger(value: unknown, field: string): number | undefined {
  if (value == null) {
    return undefined;
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric)) {
    throw new Error(`${field} must be an integer`);
  }
  return numeric;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
}
