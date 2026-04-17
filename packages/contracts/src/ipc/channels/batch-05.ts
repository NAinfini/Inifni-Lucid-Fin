/**
 * Pure type shapes for Batch 5 (job:*).
 *
 * No zod, no runtime. Complex DTOs (GenerationRequest, Job, job result blobs)
 * remain `unknown` at this stage — Phase C will promote them once the DTOs
 * themselves are contract-owned.
 *
 * This is the first batch with push channel payloads: every `<Name>Payload`
 * type below matches a `definePushChannel({ channel })` entry in the
 * contracts-parse sibling, and is what the codegen imports into
 * `lucid-api.generated.ts` as the `on<Name>(cb)` callback argument.
 */

// ── job:list (invoke) ────────────────────────────────────────
export interface JobListRequest {
  status?: string;
}
export type JobListResponse = unknown[];

// ── job:submit (invoke) ──────────────────────────────────────
// Request is `GenerationRequest & { segmentId?: string }` — kept as `unknown`
// until the DTO is contract-owned.
export type JobSubmitRequest = unknown;
export interface JobSubmitResponse {
  jobId: string;
}

// ── job:cancel (invoke) ──────────────────────────────────────
export interface JobCancelRequest {
  jobId: string;
}
export type JobCancelResponse = void;

// ── job:pause (invoke) ───────────────────────────────────────
export interface JobPauseRequest {
  jobId: string;
}
export type JobPauseResponse = void;

// ── job:resume (invoke) ──────────────────────────────────────
export interface JobResumeRequest {
  jobId: string;
}
export type JobResumeResponse = void;

// ── job:submitted (push) ─────────────────────────────────────
export interface JobSubmittedPayload {
  id: string;
  status: string;
}

// ── job:progress (push) ──────────────────────────────────────
export interface JobProgressPayload {
  jobId: string;
  progress: number;
  completedSteps?: number;
  totalSteps?: number;
  currentStep?: string;
  message?: string;
}

// ── job:complete (push) ──────────────────────────────────────
// Emitted for both success and failure paths in job.handlers.ts; `success`
// discriminates, `result`/`error` are mutually optional.
export interface JobCompletePayload {
  jobId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

// ── job:failed (push) ────────────────────────────────────────
export interface JobFailedPayload {
  id: string;
  status: string;
  error?: string;
}

// ── job:cancelled (push) ─────────────────────────────────────
export interface JobCancelledPayload {
  id: string;
  status: string;
}

// ── job:paused (push) ────────────────────────────────────────
export interface JobPausedPayload {
  id: string;
  status: string;
}

// ── job:resumed (push) ───────────────────────────────────────
export interface JobResumedPayload {
  id: string;
  status: string;
}
