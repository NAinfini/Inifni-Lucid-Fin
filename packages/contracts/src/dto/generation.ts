import type { ResolvedResolution } from './resolution.js';

export const JobStatus = {
  Queued: 'queued',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Paused: 'paused',
  Dead: 'dead',
} as const;

/** Provider execution state. The name reflects provider SDK terminology, not an app Job entity. */
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export type GenerationType = 'text' | 'image' | 'video' | 'voice' | 'music' | 'sfx';

export interface GenerationFrameReferenceImages {
  first?: string;
  last?: string;
}

export interface GenerationRequest {
  type: GenerationType;
  providerId: string;
  prompt: string;
  negativePrompt?: string;
  referenceImages?: string[];
  frameReferenceImages?: GenerationFrameReferenceImages;
  width?: number;
  height?: number;
  resolution?: ResolvedResolution;
  duration?: number;
  seed?: number;
  audio?: boolean;
  quality?: string;
  params?: Record<string, unknown>;
  sourceImageHash?: string;
  sourceImagePath?: string;
  img2imgStrength?: number;
  steps?: number;
  cfgScale?: number;
  scheduler?: string;
  emotionVector?: {
    happy: number;
    sad: number;
    angry: number;
    fearful: number;
    surprised: number;
    disgusted: number;
    contemptuous: number;
    neutral: number;
  };
}

export interface GenerationResult {
  assetHash: string;
  assetPath: string;
  provider: string;
  cost?: number;
  metadata?: Record<string, unknown>;
  provenance?: ContentProvenance;
}

export interface ContentProvenance {
  provider: string;
  model?: string;
  promptHash: string;
  generatedAt: number;
  softwareAgent: string;
  sourceImageHash?: string;
}

export interface CostEstimate {
  provider: string;
  estimatedCost: number;
  currency: string;
  unit: string;
}
