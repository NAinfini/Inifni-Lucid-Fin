import {
  type AdapterError,
  type GenerationRequest,
  resolveLastVideoConditioningImage,
} from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export function toSeedanceInput(req: GenerationRequest): Record<string, unknown> {
  const referenceImages = (req.referenceImages ?? []).filter((value) => value.trim().length > 0);
  const sourceImage = normalizeOptionalString(req.sourceImagePath);
  const explicitFirstFrame = normalizeOptionalString(req.frameReferenceImages?.first);
  const lastFrameImage = resolveLastVideoConditioningImage(req);
  assertSeedanceConditioningInvariants({
    referenceImages,
    sourceImage,
    explicitFirstFrame,
    lastFrameImage,
  });
  const firstFrameImage = explicitFirstFrame ?? sourceImage;
  const prompt = req.negativePrompt?.trim()
    ? `${req.prompt}\nAvoid these visual failures: ${req.negativePrompt.trim()}`
    : req.prompt;
  return {
    prompt,
    ...(referenceImages.length > 0
      ? { reference_images: referenceImages }
      : firstFrameImage
        ? { image: firstFrameImage }
        : {}),
    ...(referenceImages.length === 0 && lastFrameImage ? { last_frame_image: lastFrameImage } : {}),
    ...(req.seed != null ? { seed: req.seed } : {}),
    ...(req.duration != null ? { duration: req.duration } : {}),
    resolution: resolveResolution(req),
    aspect_ratio: resolveAspectRatio(req),
    generate_audio: req.audio === true,
  };
}

function assertSeedanceConditioningInvariants(input: {
  referenceImages: string[];
  sourceImage?: string;
  explicitFirstFrame?: string;
  lastFrameImage?: string;
}): void {
  if (input.referenceImages.length > 9) {
    throw new Error(
      `Seedance supports at most 9 ordered reference images; received ${input.referenceImages.length}`,
    );
  }
  if (
    input.referenceImages.length > 0 &&
    (input.sourceImage || input.explicitFirstFrame || input.lastFrameImage)
  ) {
    throw new Error(
      'Seedance cannot combine ordered references with source, first-frame, or last-frame inputs',
    );
  }
  if (input.sourceImage && input.explicitFirstFrame) {
    throw new Error('Seedance cannot combine a source image with an explicit first frame');
  }
  if (input.lastFrameImage && !input.sourceImage && !input.explicitFirstFrame) {
    throw new Error('Seedance last frame requires a first frame or source image');
  }
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveResolution(req: GenerationRequest): string {
  if (typeof req.params?.resolution === 'string') return req.params.resolution;
  if ((req.height ?? 0) >= 2160) return '4K';
  if ((req.height ?? 0) >= 1080 || req.quality === 'pro') return '1080p';
  return '720p';
}

function resolveAspectRatio(req: GenerationRequest): string {
  if (typeof req.params?.aspect_ratio === 'string') return req.params.aspect_ratio;
  const width = req.width ?? 16;
  const height = req.height ?? 9;
  const ratio = width / Math.max(1, height);
  const supported = [
    ['21:9', 21 / 9],
    ['16:9', 16 / 9],
    ['4:3', 4 / 3],
    ['1:1', 1],
    ['3:4', 3 / 4],
    ['9:16', 9 / 16],
  ] as const;
  return supported.reduce((best, candidate) =>
    Math.abs(candidate[1] - ratio) < Math.abs(best[1] - ratio) ? candidate : best,
  )[0];
}

export function parseError(data: unknown, status?: number): AdapterError {
  return parseAdapterError({ provider: 'Seedance', status, error: data });
}
