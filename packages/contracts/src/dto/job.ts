export const JobStatus = {
  Queued: 'queued',
  Running: 'running',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Paused: 'paused',
  Dead: 'dead',
} as const;

export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

export type GenerationType = 'text' | 'image' | 'video' | 'voice' | 'music' | 'sfx';

export interface GenerationRequest {
  type: GenerationType;
  providerId: string;
  prompt: string;
  negativePrompt?: string;
  referenceImages?: string[];
  width?: number;
  height?: number;
  duration?: number;
  seed?: number;
  audio?: boolean;
  quality?: string;
  params?: Record<string, unknown>;
  /** Image-to-image: source image asset hash */
  sourceImageHash?: string;
  /** Image-to-image: denoising strength (0-1) */
  img2imgStrength?: number;
  /** Advanced: inference steps */
  steps?: number;
  /** Advanced: classifier-free guidance scale */
  cfgScale?: number;
  /** Advanced: scheduler/sampler name */
  scheduler?: string;
  /** Character consistency: face reference asset hashes */
  faceReferenceHashes?: string[];
  /** Fine-grained TTS emotion control (0-1 per dimension) */
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
  /** C2PA provenance data */
  provenance?: ContentProvenance;
}

/** C2PA Content Credentials */
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

export interface Job {
  id: string;
  segmentId?: string;
  type: GenerationType;
  provider: string;
  status: JobStatus;
  priority: number;
  prompt: string;
  params?: Record<string, unknown>;
  result?: GenerationResult;
  cost?: number;
  attempts: number;
  maxRetries: number;
  progress?: number;
  completedSteps?: number;
  totalSteps?: number;
  currentStep?: string;
  batchId?: string;
  batchIndex?: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}
