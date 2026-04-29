import {
  type AdapterError,
  type GenerationRequest,
  resolveLastVideoConditioningImage,
  resolvePrimaryVideoConditioningImage,
} from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export function toMiniMaxRequest(req: GenerationRequest): Record<string, unknown> {
  const firstFrameImage = resolvePrimaryVideoConditioningImage(req);
  const lastFrameImage = resolveLastVideoConditioningImage(req);
  return {
    prompt: req.prompt,
    model: (req.params?.model as string) ?? 'T2V-02',
    prompt_optimizer: req.params?.prompt_optimizer ?? true,
    ...(firstFrameImage ? { first_frame_image: firstFrameImage } : {}),
    ...(lastFrameImage ? { last_frame_image: lastFrameImage } : {}),
    ...(req.duration ? { duration: req.duration } : {}),
    ...(req.width && req.height ? { resolution: `${req.width}x${req.height}` } : {}),
  };
}

export function parseMiniMaxResponse(data: Record<string, unknown>): {
  taskId: string;
  status: string;
} {
  const baseStatus = data['base_resp'] as Record<string, unknown> | undefined;
  return {
    taskId: (data['task_id'] ?? '') as string,
    status: (baseStatus?.['status_code'] === 0 ? 'submitted' : (data['status'] ?? '')) as string,
  };
}

export function parseMiniMaxStatus(data: Record<string, unknown>): {
  status: string;
  fileId: string;
} {
  return {
    status: (data['status'] ?? '') as string,
    fileId: (data['file_id'] ?? '') as string,
  };
}

export function parseError(data: unknown, status?: number): AdapterError {
  return parseAdapterError({ provider: 'MiniMax', status, error: data });
}
