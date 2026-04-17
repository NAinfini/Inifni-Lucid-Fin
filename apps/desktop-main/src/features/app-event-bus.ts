/**
 * `features/app-event-bus.ts` — Phase F-split-1.
 *
 * In-process domain event bus for feature-to-feature coordination in the
 * main process. Consumes the generic `EventBus<E>` primitive from Phase A
 * (`@lucid-fin/shared-utils`) and pins the event map for this app.
 *
 * Deliberate non-responsibility: this bus **never crosses IPC**. Renderer
 * notification goes through `features/ipc/push-gateway.ts` (`RendererPushGateway`),
 * which wraps `BrowserWindow.webContents.send`. Don't mix the two:
 *
 *   - AppEventBus carries domain facts ("job submitted") that other
 *     features react to. It has no BrowserWindow reference.
 *   - RendererPushGateway publishes to typed push channels that the
 *     renderer listens on. It owns the window reference.
 *
 * If a new event key wants to carry `BrowserWindow` / `webContents` /
 * `ipcRenderer` references, that is a review-blocking violation — such
 * traffic belongs on the push gateway.
 *
 * Kept intentionally minimal until feature modules migrate onto it in
 * Phase F follow-ups. Payload shapes are placeholder interfaces here;
 * they will tighten as features migrate.
 */

import { createEventBus, type EventBus } from '@lucid-fin/shared-utils';

// ── Event payload shapes ─────────────────────────────────────────
// Kept as plain TS interfaces so adding a new event key lands here and
// surfaces everywhere the bus is typed. As features migrate (Phase F
// follow-ups), these will narrow further — e.g., replacing `string`
// entity ids with branded ids from `@lucid-fin/contracts`.

export interface JobSubmittedEvent {
  jobId: string;
  /** Canvas / ref-image / etc — narrows with `GenerationSubject` once Phase D-v2 wires it. */
  subjectKind: string;
  subjectId: string;
}

export interface JobCompletedEvent {
  jobId: string;
  outcome: 'success' | 'failure' | 'cancelled';
}

export interface CommanderRunStartedEvent {
  sessionId: string;
  canvasId: string | null;
}

export interface CommanderRunFinishedEvent {
  sessionId: string;
  historyCursor: number;
}

export interface WorkflowStageCompletedEvent {
  runId: string;
  stageId: string;
  status: 'completed' | 'failed';
}

export interface EntityUpdatedEvent {
  entityKind: 'character' | 'location' | 'equipment' | 'canvas';
  entityId: string;
}

/**
 * Event map owned by the main process. Adding a new key here is a
 * deliberate API commitment — cross-feature consumers will depend on the
 * shape being stable.
 *
 * Modeled as a `type` (not `interface`) so it satisfies the
 * `EventMap = Record<string, unknown>` constraint in `shared-utils` —
 * TypeScript interfaces don't implicitly gain an index signature.
 */
export type AppEvents = {
  'job.submitted': JobSubmittedEvent;
  'job.completed': JobCompletedEvent;
  'commander.run.started': CommanderRunStartedEvent;
  'commander.run.finished': CommanderRunFinishedEvent;
  'workflow.stage.completed': WorkflowStageCompletedEvent;
  'entity.updated': EntityUpdatedEvent;
};

export type AppEventBus = EventBus<AppEvents>;

/**
 * Process-wide singleton bus. Features import this instance directly;
 * tests can construct a fresh bus via `createEventBus<AppEvents>()`.
 */
export const appEventBus: AppEventBus = createEventBus<AppEvents>();
