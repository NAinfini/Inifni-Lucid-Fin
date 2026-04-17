import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import log from '../logger.js';
import type { LLMRegistry } from '@lucid-fin/adapters-ai';
import type { WorkflowTaskExecutionContext, WorkflowTaskHandler } from '@lucid-fin/application';
import type {
  ColorStyle,
  ColorSwatch,
  ExposureProfile,
  GradientDef,
  LLMAdapter,
} from '@lucid-fin/contracts';
import { TaskKind, TaskRunStatus } from '@lucid-fin/contracts';
import type { CAS } from '@lucid-fin/storage';

const EXTRACT_PROMPT = `Analyze this image and extract its color/style profile as JSON. Return ONLY valid JSON with this exact structure:
{
  "palette": [{"hex": "#RRGGBB", "name": "color name", "weight": 0.0-1.0}],
  "gradients": [{"type": "linear"|"radial", "angle": 0-360, "stops": [{"hex": "#RRGGBB", "position": 0.0-1.0}]}],
  "exposure": {"brightness": -100to100, "contrast": -100to100, "highlights": -100to100, "shadows": -100to100, "temperature": 2000-10000, "tint": -100to100}
}
Extract the 5-8 most dominant colors for palette. Identify 1-2 prominent gradients if visible. Estimate exposure values based on the image characteristics.`;

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
};

const DEFAULT_EXPOSURE: ExposureProfile = {
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  temperature: 5500,
  tint: 0,
};

type StyleWorkflowHandlerOptions = {
  cas: CAS;
  llmRegistry: LLMRegistry;
  now?: () => number;
  idFactory?: () => string;
  videoFrameExtractor?: VideoFrameExtractor;
};

type ExtractedImageInput = {
  imagePath: string;
  mimeType: string;
  cleanup?: () => void | Promise<void>;
};

type VideoFrameExtractor = (videoPath: string) => Promise<ExtractedImageInput>;

export function createStyleWorkflowHandlers(
  options: StyleWorkflowHandlerOptions,
): WorkflowTaskHandler[] {
  const now = options.now ?? (() => Date.now());
  const nextId = options.idFactory ?? randomUUID;
  const videoFrameExtractor = options.videoFrameExtractor ?? extractVideoFrameWithFfmpeg;

  return [
    {
      id: 'style.resolve-asset',
      kind: TaskKind.AssetResolve,
      async execute(context) {
        const assetHash = requireString(context.taskRun.input.assetHash, 'assetHash');
        const assetType = requireAssetType(context.taskRun.input.assetType);
        const asset = context.db.repos.assets
          .query({
            type: assetType,
            limit: 10_000,
          })
          .rows.find((entry) => entry.hash === assetHash);

        if (!asset) {
          throw new Error(`Asset not found in DB: ${assetHash}`);
        }

        const assetPath = options.cas.getAssetPath(asset.hash, asset.type, asset.format);
        if (!fs.existsSync(assetPath)) {
          throw new Error(`Asset file missing on disk: ${assetHash}`);
        }

        const ext = path.extname(assetPath).slice(1).toLowerCase();
        const mimeType = MIME_MAP[ext] ?? (assetType === 'video' ? 'video/mp4' : 'image/png');

        return {
          status: TaskRunStatus.Completed,
          progress: 100,
          currentStep: 'resolved',
          output: {
            assetHash,
            assetType,
            assetPath,
            mimeType,
          },
        };
      },
    },
    {
      id: 'style.extract.profile',
      kind: TaskKind.MetadataExtract,
      async execute(context) {
        const resolved = getTaskOutput(context, 'resolve-style-asset');
        const assetHash = requireString(resolved.assetHash, 'assetHash');
        const assetType = requireAssetType(resolved.assetType);
        const assetPath = requireString(resolved.assetPath, 'assetPath');
        const mimeType = requireString(resolved.mimeType, 'mimeType');
        const adapter = await findConfiguredAdapter(options.llmRegistry);
        const preparedImage =
          assetType === 'video'
            ? await videoFrameExtractor(assetPath)
            : {
                imagePath: assetPath,
                mimeType: normalizeImageMimeType(mimeType),
              };

        try {
          const imageBuffer = fs.readFileSync(preparedImage.imagePath);
          const base64 = imageBuffer.toString('base64');
          let jsonText: string;
          try {
            jsonText = await adapter.complete([
              {
                role: 'user',
                content: EXTRACT_PROMPT,
                images: [
                  { data: base64, mimeType: normalizeImageMimeType(preparedImage.mimeType) },
                ],
              },
            ]);
          } catch (error) {
            log.error('Color extraction LLM call failed:', error);
            throw new Error('AI color extraction failed. Check your LLM provider configuration.', { cause: error });
          }

          const extracted = parseExtractionJson(jsonText);
          const timestamp = now();

          return {
            status: TaskRunStatus.Completed,
            progress: 100,
            currentStep: 'extracted',
            output: {
              name: `Extracted ${new Date(timestamp).toISOString().slice(0, 10)}`,
              sourceAsset: assetHash,
              sourceType: assetType,
              palette: sanitizePalette(extracted.palette),
              gradients: sanitizeGradients(extracted.gradients),
              exposure: sanitizeExposure(extracted.exposure),
              tags: ['ai-extracted'],
              provider: adapter.id,
            },
          };
        } finally {
          await cleanupExtractedImage(preparedImage);
        }
      },
    },
    {
      id: 'style.persist',
      kind: TaskKind.Transform,
      async execute(context) {
        const extracted = getTaskOutput(context, 'extract-style-profile');
        const timestamp = now();
        const styleId = nextId();
        const colorStyle: ColorStyle = {
          id: styleId,
          name:
            optionalString(extracted.name) ??
            `Extracted ${new Date(timestamp).toISOString().slice(0, 10)}`,
          sourceType: requireAssetType(extracted.sourceType),
          sourceAsset: optionalString(extracted.sourceAsset),
          palette: sanitizePalette(extracted.palette),
          gradients: sanitizeGradients(extracted.gradients),
          exposure: sanitizeExposure(extracted.exposure),
          tags:
            readStringArray(extracted.tags).length > 0
              ? readStringArray(extracted.tags)
              : ['ai-extracted'],
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        context.db.upsertColorStyle(colorStyle);

        context.db.insertWorkflowArtifact({
          id: nextId(),
          workflowRunId: context.workflowRun.id,
          taskRunId: context.taskRun.id,
          artifactType: 'color_style',
          entityType: 'color_style',
          entityId: colorStyle.id,
          assetHash: colorStyle.sourceAsset,
          metadata: {
            colorStyleName: colorStyle.name,
            sourceType: colorStyle.sourceType,
          },
          createdAt: timestamp,
        });

        context.db.updateWorkflowRun(context.workflowRun.id, {
          output: {
            ...context.workflowRun.output,
            colorStyleId: colorStyle.id,
            colorStyleName: colorStyle.name,
            sourceAsset: colorStyle.sourceAsset,
            sourceType: colorStyle.sourceType,
          },
          updatedAt: timestamp,
        });

        return {
          status: TaskRunStatus.Completed,
          progress: 100,
          currentStep: 'persisted',
          output: {
            colorStyleId: colorStyle.id,
            colorStyleName: colorStyle.name,
          },
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

async function findConfiguredAdapter(llmRegistry: LLMRegistry): Promise<LLMAdapter> {
  for (const adapter of llmRegistry.list()) {
    try {
      if (await adapter.validate()) {
        return adapter;
      }
    } catch (err) {
      log.warn('LLM adapter validate() threw', { error: String(err) });
      // Skip invalid adapters and surface a single actionable error if none validate.
    }
  }

  throw new Error('No LLM provider configured. Add an API key in Settings.');
}

function parseExtractionJson(jsonText: string): Record<string, unknown> {
  const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('AI returned invalid response — no JSON found');
  }

  try {
    return JSON.parse(jsonMatch[0]) as Record<string, unknown>;
  } catch { /* JSON.parse failed on AI response — propagate a descriptive error */
    throw new Error('AI returned malformed JSON');
  }
}

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
}

function sanitizePalette(raw: unknown): ColorSwatch[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((entry): entry is Record<string, unknown> => {
      return (
        !!entry &&
        typeof entry === 'object' &&
        typeof entry.hex === 'string' &&
        /^#[0-9a-f]{6}$/i.test(entry.hex)
      );
    })
    .map((entry) => ({
      hex: entry.hex as string,
      name: typeof entry.name === 'string' ? entry.name : undefined,
      weight: clamp(entry.weight, 0, 1, 0.1),
    }));
}

function sanitizeGradients(raw: unknown): GradientDef[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter((entry): entry is Record<string, unknown> => {
      return (
        !!entry &&
        typeof entry === 'object' &&
        (entry.type === 'linear' || entry.type === 'radial') &&
        Array.isArray(entry.stops)
      );
    })
    .map((entry) => ({
      type: entry.type as 'linear' | 'radial',
      angle: entry.type === 'linear' ? clamp(entry.angle, 0, 360, 90) : undefined,
      stops: (entry.stops as unknown[])
        .filter((stop): stop is { hex: string; position: unknown } => {
          return (
            !!stop &&
            typeof stop === 'object' &&
            typeof (stop as Record<string, unknown>).hex === 'string'
          );
        })
        .map((stop) => ({
          hex: stop.hex,
          position: clamp(stop.position, 0, 1, 0),
        })),
    }));
}

function sanitizeExposure(raw: unknown): ExposureProfile {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_EXPOSURE };
  }

  const exposure = raw as Record<string, unknown>;
  return {
    brightness: clamp(exposure.brightness, -100, 100, 0),
    contrast: clamp(exposure.contrast, -100, 100, 0),
    highlights: clamp(exposure.highlights, -100, 100, 0),
    shadows: clamp(exposure.shadows, -100, 100, 0),
    temperature: clamp(exposure.temperature, 2000, 10000, 5500),
    tint: clamp(exposure.tint, -100, 100, 0),
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} is required`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function requireAssetType(value: unknown): 'image' | 'video' {
  if (value === 'image' || value === 'video') {
    return value;
  }
  throw new Error('assetType must be image or video');
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
}

async function extractVideoFrameWithFfmpeg(videoPath: string): Promise<ExtractedImageInput> {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-style-frame-'));
  const framePath = path.join(tempDir, `${randomUUID()}.png`);

  try {
    await runFfmpegFrameExtract(videoPath, framePath);
    if (!fs.existsSync(framePath)) {
      throw new Error(`Video frame extraction failed: no frame produced for ${videoPath}`);
    }

    return {
      imagePath: framePath,
      mimeType: 'image/png',
      cleanup: () => cleanupTempFrame(tempDir),
    };
  } catch (error) {
    log.error('FFmpeg frame extraction failed', { error: String(error) });
    cleanupTempFrame(tempDir);
    throw error;
  }
}

async function runFfmpegFrameExtract(videoPath: string, framePath: string): Promise<void> {
  const ffmpegPath = process.env.FFMPEG_PATH?.trim() || 'ffmpeg';
  const args = ['-y', '-i', videoPath, '-frames:v', '1', framePath];

  await new Promise<void>((resolve, reject) => {
    execFile(ffmpegPath, args, (error, _stdout, stderr) => {
      if (!error) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Video frame extraction failed for "${videoPath}" via "${ffmpegPath}": ${formatCommandError(stderr, error)}`,
        ),
      );
    });
  });
}

function formatCommandError(stderr: string | Buffer | null | undefined, error: Error): string {
  const text = stderr ? (Buffer.isBuffer(stderr) ? stderr.toString('utf8') : stderr).trim() : '';
  return text.length > 0 ? text : error.message;
}

function cleanupTempFrame(tempDir: string): void {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (error) {
    log.warn('Failed to clean up temporary video frame directory:', error);
  }
}

function normalizeImageMimeType(mimeType: string): string {
  return mimeType.startsWith('image/') ? mimeType : 'image/png';
}

async function cleanupExtractedImage(image: ExtractedImageInput): Promise<void> {
  if (!image.cleanup) {
    return;
  }

  try {
    await image.cleanup();
  } catch (error) {
    log.warn('Failed to cleanup extracted frame artifact:', error);
  }
}
