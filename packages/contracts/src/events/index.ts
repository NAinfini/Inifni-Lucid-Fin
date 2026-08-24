import type { GenerationResult } from '../dto/generation.js';

export interface JobProgressEvent {
  jobId: string;
  progress: number;
  message?: string;
}

export interface JobCompleteEvent {
  jobId: string;
  success: boolean;
  result?: GenerationResult;
  error?: string;
}
