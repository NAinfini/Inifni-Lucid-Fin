/**
 * job:* channels — Batch 5.
 *
 * Covers the 5 invoke handlers in
 * `apps/desktop-main/src/ipc/handlers/job.handlers.ts` plus the 7 push
 * channels that same handler emits via `webContents.send`.
 *
 * This is the first batch with push channels. Each push channel is declared
 * with `definePushChannel({ channel, payload })` and exports a
 * `<Domain><Method>Payload` type so the codegen's naming convention
 * (`typeBase + 'Payload'`) picks it up for `lucid-api.generated.ts`.
 *
 * Complex DTOs (GenerationRequest, Job, job result blobs) remain `z.unknown()`
 * at this stage — Phase C will zodify them when the DTOs themselves move
 * into contract ownership. The simpler push payloads (progress, complete,
 * failed) use strict object schemas matching the handler's emit shape.
 */
import { z } from 'zod';
import { defineInvokeChannel, definePushChannel } from '../../channels.js';

// ── Shared primitives ────────────────────────────────────────
// GenerationRequest/Job/Job result blobs remain opaque (`unknown`) at this
// stage — Phase C will zodify the DTOs once they move into contract ownership.
const JobShape = z.unknown();

// ── job:list (invoke) ────────────────────────────────────────
const JobListRequest = z.object({ status: z.string().optional() }).strict();
const JobListResponse = z.array(JobShape);
export const jobListChannel = defineInvokeChannel({
  channel: 'job:list',
  request: JobListRequest,
  response: JobListResponse,
});
export type JobListRequest = z.infer<typeof JobListRequest>;
export type JobListResponse = z.infer<typeof JobListResponse>;

// ── job:submit (invoke) ──────────────────────────────────────
const JobSubmitRequest = z.object({
  type: z.enum(['text', 'image', 'video', 'voice', 'music', 'sfx']),
  providerId: z.string().min(1),
  prompt: z.string(),
  negativePrompt: z.string().optional(),
  referenceImages: z.array(z.string()).optional(),
  frameReferenceImages: z
    .object({ first: z.string().optional(), last: z.string().optional() })
    .optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: z.number().positive().optional(),
  seed: z.number().int().optional(),
  audio: z.boolean().optional(),
  quality: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  sourceImageHash: z.string().optional(),
  sourceImagePath: z.string().optional(),
  img2imgStrength: z.number().min(0).max(1).optional(),
  steps: z.number().int().positive().optional(),
  cfgScale: z.number().positive().optional(),
  scheduler: z.string().optional(),
  segmentId: z.string().optional(),
});
const JobSubmitResponse = z.object({ jobId: z.string() });
export const jobSubmitChannel = defineInvokeChannel({
  channel: 'job:submit',
  request: JobSubmitRequest,
  response: JobSubmitResponse,
});
export type JobSubmitRequest = z.infer<typeof JobSubmitRequest>;
export type JobSubmitResponse = z.infer<typeof JobSubmitResponse>;

// ── job:cancel (invoke) ──────────────────────────────────────
const JobCancelRequest = z.object({ jobId: z.string().min(1) });
const JobCancelResponse = z.void();
export const jobCancelChannel = defineInvokeChannel({
  channel: 'job:cancel',
  request: JobCancelRequest,
  response: JobCancelResponse,
});
export type JobCancelRequest = z.infer<typeof JobCancelRequest>;
export type JobCancelResponse = z.infer<typeof JobCancelResponse>;

// ── job:pause (invoke) ───────────────────────────────────────
const JobPauseRequest = z.object({ jobId: z.string().min(1) });
const JobPauseResponse = z.void();
export const jobPauseChannel = defineInvokeChannel({
  channel: 'job:pause',
  request: JobPauseRequest,
  response: JobPauseResponse,
});
export type JobPauseRequest = z.infer<typeof JobPauseRequest>;
export type JobPauseResponse = z.infer<typeof JobPauseResponse>;

// ── job:resume (invoke) ──────────────────────────────────────
const JobResumeRequest = z.object({ jobId: z.string().min(1) });
const JobResumeResponse = z.void();
export const jobResumeChannel = defineInvokeChannel({
  channel: 'job:resume',
  request: JobResumeRequest,
  response: JobResumeResponse,
});
export type JobResumeRequest = z.infer<typeof JobResumeRequest>;
export type JobResumeResponse = z.infer<typeof JobResumeResponse>;

// ── job:submitted (push) ─────────────────────────────────────
const JobSubmittedPayload = z.object({
  jobId: z.string(),
  status: z.string(),
});
export const jobSubmittedChannel = definePushChannel({
  channel: 'job:submitted',
  payload: JobSubmittedPayload,
});
export type JobSubmittedPayload = z.infer<typeof JobSubmittedPayload>;

// ── job:progress (push) ──────────────────────────────────────
const JobProgressPayload = z.object({
  jobId: z.string(),
  progress: z.number(),
  completedSteps: z.number().optional(),
  totalSteps: z.number().optional(),
  currentStep: z.string().optional(),
  message: z.string().optional(),
});
export const jobProgressChannel = definePushChannel({
  channel: 'job:progress',
  payload: JobProgressPayload,
});
export type JobProgressPayload = z.infer<typeof JobProgressPayload>;

// ── job:complete (push) ──────────────────────────────────────
// Emitted for both success (with `result`) and failure (with `error`) paths
// in job.handlers.ts. `success` discriminates; `result`/`error` are optional.
const JobCompletePayload = z.object({
  jobId: z.string(),
  success: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
export const jobCompleteChannel = definePushChannel({
  channel: 'job:complete',
  payload: JobCompletePayload,
});
export type JobCompletePayload = z.infer<typeof JobCompletePayload>;

// ── job:failed (push) ────────────────────────────────────────
const JobFailedPayload = z.object({
  jobId: z.string(),
  status: z.string(),
  error: z.string().optional(),
});
export const jobFailedChannel = definePushChannel({
  channel: 'job:failed',
  payload: JobFailedPayload,
});
export type JobFailedPayload = z.infer<typeof JobFailedPayload>;

// ── job:cancelled (push) ─────────────────────────────────────
const JobCancelledPayload = z.object({
  jobId: z.string(),
  status: z.string(),
});
export const jobCancelledChannel = definePushChannel({
  channel: 'job:cancelled',
  payload: JobCancelledPayload,
});
export type JobCancelledPayload = z.infer<typeof JobCancelledPayload>;

// ── job:paused (push) ────────────────────────────────────────
const JobPausedPayload = z.object({
  jobId: z.string(),
  status: z.string(),
});
export const jobPausedChannel = definePushChannel({
  channel: 'job:paused',
  payload: JobPausedPayload,
});
export type JobPausedPayload = z.infer<typeof JobPausedPayload>;

// ── job:resumed (push) ───────────────────────────────────────
const JobResumedPayload = z.object({
  jobId: z.string(),
  status: z.string(),
});
export const jobResumedChannel = definePushChannel({
  channel: 'job:resumed',
  payload: JobResumedPayload,
});
export type JobResumedPayload = z.infer<typeof JobResumedPayload>;

export const jobChannels = [
  jobListChannel,
  jobSubmitChannel,
  jobCancelChannel,
  jobPauseChannel,
  jobResumeChannel,
  jobSubmittedChannel,
  jobProgressChannel,
  jobCompleteChannel,
  jobFailedChannel,
  jobCancelledChannel,
  jobPausedChannel,
  jobResumedChannel,
] as const;
