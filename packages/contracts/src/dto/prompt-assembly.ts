/**
 * Durable input submitted to the Commander-owned prompt assembler.
 * The host records this exact snapshot before an LLM can produce a prompt.
 */
export interface PromptAssemblyInputV1 {
  version: 1;
  assemblyId: string;
  canvasId: string;
  nodeId: string;
  nodeUpdatedAt: number;
  mediaType: 'image' | 'video' | 'audio';
  mode:
    | 'text-to-image'
    | 'image-to-image'
    | 'text-to-video'
    | 'image-to-video'
    | 'text-to-audio';
  purpose: PromptAssemblyPurpose;
  authority: PromptAssemblyAuthority;
  sources: PromptAssemblySource[];
  conditioningManifest: PromptAssemblyConditioningReference[];
  providerProfile: PromptAssemblyProviderProfile;
  hostConstraints: PromptAssemblyHostConstraints;
  /** SHA-256 of the canonical immutable input snapshot, computed by the host. */
  inputHash: string;
}

export type PromptAssemblyPurpose = 'initial' | 'user_refine' | 'evaluation_repair' | 'regenerate';

export type PromptAssemblyAuthority =
  | { kind: 'canvas-draft' }
  | {
      kind: 'task-list';
      taskListId: string;
      taskId: string;
    }
  | {
      kind: 'task-list-production-plan';
      taskListId: string;
      taskId: string;
      productionPlan: PromptAssemblyApprovedDocument;
    }
  | {
      kind: 'task-list-approved';
      taskListId: string;
      taskId: string;
      productionPlan: PromptAssemblyApprovedDocument;
      visualConstitution: PromptAssemblyApprovedDocument;
      shotId?: string;
    };

export interface PromptAssemblyApprovedDocument {
  revision: number;
  contentHash: string;
  content: Record<string, unknown>;
}

export type PromptAssemblySourceKind =
  | 'user-intent'
  | 'node-prompt'
  | 'connected-text'
  | 'preset'
  | 'shot-template'
  | 'entity'
  | 'canvas-style'
  | 'project-style-guide'
  | 'task-list-guide'
  | 'production-plan'
  | 'visual-constitution'
  | 'parent-prompt'
  | 'user-feedback'
  | 'repair-delta'
  | 'negative-constraint';

/** One named, hash-addressable source made available to the assembler. */
export interface PromptAssemblySource {
  sourceId: string;
  sourceHash: string;
  kind: PromptAssemblySourceKind;
  label: string;
  content: string;
  required: boolean;
  metadata?: Record<string, unknown>;
}

export interface PromptAssemblyConditioningReference {
  assetHash: string;
  roles: Array<{ role: string; entityId?: string }>;
}

export interface PromptAssemblyProviderProfile {
  providerId: string;
  model?: string;
  capabilities: string[];
  promptLimits?: Record<string, unknown>;
}

/** Host-enforced facts are visible to the assembler but never model-editable. */
export interface PromptAssemblyHostConstraints {
  resolution?: unknown;
  seed?: unknown;
  budget?: unknown;
  retry?: unknown;
  immutable: string[];
}

export type PromptAssemblySourceDisposition = 'applied' | 'omitted' | 'conflict-resolved';

export interface PromptAssemblySourceDecision {
  sourceId: string;
  sourceHash: string;
  disposition: PromptAssemblySourceDisposition;
  reason?: string;
}

/** Validated model output. Provider parameters remain owned by the host. */
export interface PromptAssemblyOutputV1 {
  version: 1;
  assemblyId: string;
  inputHash: string;
  finalPrompt: string;
  negativePrompt?: string;
  sourceDecisions: PromptAssemblySourceDecision[];
  summary: string;
  warnings: string[];
}

export type PromptAssemblyStatus = 'prepared' | 'assembled' | 'submitted' | 'failed' | 'cancelled';

/** Provenance captured when the host prepares an immutable assembly snapshot. */
export interface PromptAssemblyAuthor {
  llmProviderId?: string;
  llmModel?: string;
  taskListId?: string;
  taskId?: string;
  parentAssemblyId?: string;
  sourceAttemptId?: string;
  sourceAssetHash?: string;
  sourceEvaluationId?: string;
}

/** Durable prompt-assembly lifecycle record. */
export interface PromptAssemblyRecord extends PromptAssemblyAuthor {
  id: string;
  canvasId: string;
  nodeId: string;
  nodeUpdatedAt: number;
  mediaType: PromptAssemblyInputV1['mediaType'];
  mode: PromptAssemblyInputV1['mode'];
  purpose: PromptAssemblyPurpose;
  inputHash: string;
  input: PromptAssemblyInputV1;
  output?: PromptAssemblyOutputV1;
  status: PromptAssemblyStatus;
  rowVersion: number;
  error?: string;
  createdAt: number;
  assembledAt?: number;
  submittedAt?: number;
  terminalAt?: number;
  updatedAt: number;
}
