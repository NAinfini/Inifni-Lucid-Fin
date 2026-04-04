export enum JobStatus {
  Queued = 'queued',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Cancelled = 'cancelled',
  Paused = 'paused',
  Dead = 'dead',
}

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
  params?: Record<string, unknown>;
}

export interface GenerationResult {
  assetHash: string;
  assetPath: string;
  provider: string;
  cost?: number;
  metadata?: Record<string, unknown>;
}

export interface CostEstimate {
  provider: string;
  estimatedCost: number;
  currency: string;
  unit: string;
}

export interface Job {
  id: string;
  projectId: string;
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
