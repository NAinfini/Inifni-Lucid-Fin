import type { AdapterError, GenerationRequest } from '@lucid-fin/contracts';
import { parseAdapterError } from '../error-utils.js';

export function toMiniMaxRequest(req: GenerationRequest): Record<string, unknown> {
  const hasImage = req.referenceImages && req.referenceImages.length > 0;
  const hasLastImage = req.referenceImages && req.referenceImages.length > 1;
  return {
    prompt: req.prompt,
    model: (req.params?.model as string) ?? 'T2V-02',
    prompt_optimizer: req.params?.prompt_optimizer ?? true,
    ...(hasImage ? { first_frame_image: req.referenceImages![0] } : {}),
    ...(hasLastImage ? { last_frame_image: req.referenceImages![1] } : {}),
    ...(req.duration ? { duration: req.duration } : {}),
    ...(req.width && req.height ? { resolution: `${req.width}x${req.height}` } : {}),
  };
}

export function parseMiniMaxResponse(data: Record<string, unknown>): {
  taskId: string;
  status: string;
} {
  const baseStatus = (data['base_resp'] as Record<string, unknown> | undefined);
  return {
    taskId: (data['task_id'] ?? '') as string,
    status: (baseStatus?.['status_code'] === 0 ? 'submitted' : data['status'] ?? '') as string,
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
