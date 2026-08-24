import type BetterSqlite3 from 'better-sqlite3';
import type {
  CommanderRunAttachment,
  CommanderWorkType,
  SessionId,
} from '@lucid-fin/contracts';
import {
  CommanderEventsTable,
  CommanderRunAttachmentsTable,
  CommanderRunCanvasesTable,
  CommanderRunsTable,
} from '@lucid-fin/contracts-parse';

export type CommanderRunStatus =
  | 'accepted'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'max_steps';

export type CommanderRunWritableTerminalStatus =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked';

export interface StoredCommanderRun {
  id: string;
  sessionId: SessionId;
  defaultCanvasId?: string;
  authorizedCanvasIds: string[];
  intent: string;
  workType: CommanderWorkType;
  parentRunId?: string;
  retryOfRunId?: string;
  displayName?: string;
  objective?: string;
  status: CommanderRunStatus;
  acceptedAt: number;
  startedAt?: number;
  completedAt?: number;
  lastSeq: number;
  errorText?: string;
  attachments: CommanderRunAttachment[];
}

export interface StoredCommanderRunEvent {
  sessionId: SessionId;
  runId: string;
  seq: number;
  kind: string;
  step: number;
  emittedAt: number;
  payload: string;
}

export type CommanderRunAppendEvent = Omit<StoredCommanderRunEvent, 'sessionId' | 'runId'> & {
  privatePayload?: Buffer;
  terminalStatus?: CommanderRunWritableTerminalStatus;
  runStatus?: 'running' | 'paused';
  errorText?: string;
};

export interface StoredCommanderRunRecoveryEvent extends StoredCommanderRunEvent {
  privatePayload: Buffer | null;
}

type RunRow = {
  id: string;
  session_id: string;
  default_canvas_id: string | null;
  work_type: CommanderWorkType;
  parent_run_id: string | null;
  retry_of_run_id: string | null;
  display_name: string | null;
  objective: string | null;
  intent: string;
  status: CommanderRunStatus;
  accepted_at: number;
  started_at: number | null;
  completed_at: number | null;
  last_seq: number;
  error_text: string | null;
};

type EventRow = {
  session_id: string;
  run_id: string;
  seq: number;
  kind: string;
  step: number;
  emitted_at: number;
  payload: string;
};

type RecoveryEventRow = EventRow & { private_payload: Buffer | null };

type AttachmentRow = {
  ordinal: number;
  content_hash: string;
  role: CommanderRunAttachment['role'];
  original_name: string;
  mime_type: string;
};

type RunCanvasRow = { canvas_id: string };
type InterruptedRunRow = RunRow & { last_step: number };

const RUNS = CommanderRunsTable;
const EVENTS = CommanderEventsTable;
const ATTACHMENTS = CommanderRunAttachmentsTable;
const RUN_CANVASES = CommanderRunCanvasesTable;
const PUBLIC_EVENT_COLUMNS = `events.${EVENTS.cols.sessionId.sqlName},
                              events.${EVENTS.cols.runId.sqlName},
                              events.${EVENTS.cols.seq.sqlName},
                              events.${EVENTS.cols.kind.sqlName},
                              events.${EVENTS.cols.step.sqlName},
                              events.${EVENTS.cols.emittedAt.sqlName},
                              events.${EVENTS.cols.payload.sqlName}`;
const WRITABLE_TERMINAL_STATUSES = new Set<CommanderRunWritableTerminalStatus>([
  'completed',
  'failed',
  'cancelled',
  'blocked',
]);

export class CommanderRunRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  failInterruptedRuns(now: number, reason: string): number {
    return this.db.transaction(() => {
      const runs = this.db
        .prepare(
          `SELECT runs.*,
                  COALESCE((
                    SELECT events.${EVENTS.cols.step.sqlName}
                      FROM ${EVENTS.tableName} events
                     WHERE events.${EVENTS.cols.runId.sqlName} = runs.${RUNS.cols.id.sqlName}
                     ORDER BY events.${EVENTS.cols.seq.sqlName} DESC
                     LIMIT 1
                  ), 0) AS last_step
             FROM ${RUNS.tableName} runs
            WHERE runs.${RUNS.cols.status.sqlName} IN ('accepted', 'running', 'paused')
            ORDER BY runs.${RUNS.cols.acceptedAt.sqlName}, runs.${RUNS.cols.id.sqlName}`,
        )
        .all() as InterruptedRunRow[];
      const insertEvent = this.db.prepare(
        `INSERT INTO ${EVENTS.tableName} (
           ${EVENTS.cols.sessionId.sqlName}, ${EVENTS.cols.runId.sqlName},
           ${EVENTS.cols.seq.sqlName}, ${EVENTS.cols.kind.sqlName},
           ${EVENTS.cols.step.sqlName}, ${EVENTS.cols.emittedAt.sqlName},
           ${EVENTS.cols.payload.sqlName}
         ) VALUES (?, ?, ?, 'run_end', ?, ?, ?)`,
      );
      const failRun = this.db.prepare(
        `UPDATE ${RUNS.tableName}
            SET ${RUNS.cols.status.sqlName} = 'failed',
                ${RUNS.cols.completedAt.sqlName} = ?,
                ${RUNS.cols.lastSeq.sqlName} = ?,
                ${RUNS.cols.errorText.sqlName} = ?
          WHERE ${RUNS.cols.id.sqlName} = ?
            AND ${RUNS.cols.status.sqlName} IN ('accepted', 'running', 'paused')
            AND ${RUNS.cols.lastSeq.sqlName} = ?`,
      );
      const releaseScopes = this.db.prepare(
        `UPDATE ${RUN_CANVASES.tableName}
            SET ${RUN_CANVASES.cols.releasedAt.sqlName} = ?
          WHERE ${RUN_CANVASES.cols.runId.sqlName} = ?
            AND ${RUN_CANVASES.cols.releasedAt.sqlName} IS NULL`,
      );
      for (const run of runs) {
        const seq = run.last_seq + 1;
        const payload = JSON.stringify({
          kind: 'run_end',
          status: 'failed',
          exitDecision: { outcome: 'failed', blocker: reason },
          runId: run.id,
          step: run.last_step,
          seq,
          emittedAt: now,
        });
        insertEvent.run(run.session_id, run.id, seq, run.last_step, now, payload);
        const updated = failRun.run(now, seq, reason, run.id, run.last_seq);
        if (updated.changes !== 1) {
          throw new Error(`Interrupted Commander run "${run.id}" changed during recovery`);
        }
        releaseScopes.run(now, run.id);
      }
      return runs.length;
    })();
  }

  start(input: {
    id: string;
    sessionId: SessionId;
    defaultCanvasId?: string;
    authorizedCanvasIds: string[];
    intent: string;
    workType?: CommanderWorkType;
    parentRunId?: string;
    retryOfRunId?: string;
    displayName?: string;
    objective?: string;
    acceptedAt: number;
    runStartPayload: string;
    runStartPrivatePayload?: Buffer;
    attachments: CommanderRunAttachment[];
    initialEvents?: readonly CommanderRunAppendEvent[];
  }): StoredCommanderRun {
    const workType = input.workType ?? 'agent';
    const authorizedCanvasIds = [...new Set(input.authorizedCanvasIds)];
    if (input.defaultCanvasId && !authorizedCanvasIds.includes(input.defaultCanvasId)) {
      throw new Error('defaultCanvasId must be included in authorizedCanvasIds');
    }
    const initialEvents = input.initialEvents ?? [];
    initialEvents.forEach((event, index) => {
      const expectedSeq = index + 1;
      if (event.seq !== expectedSeq) {
        throw new Error(`Initial Commander event expected seq ${expectedSeq}, received ${event.seq}`);
      }
      if (event.kind === 'run_end' || event.terminalStatus) {
        throw new Error('Initial Commander events must be nonterminal');
      }
    });
    return this.db.transaction(() => {
      const parent = input.parentRunId ? this.require(input.parentRunId) : undefined;
      if (workType === 'agent' && parent) {
        throw new Error('Root agent runs cannot have a parent');
      }
      if (workType !== 'agent' && !parent) {
        throw new Error(`${workType} runs require a parent`);
      }
      if (parent) {
        if (parent.sessionId !== input.sessionId) {
          throw new Error('Child Commander run cannot belong to another session');
        }
        if (!['accepted', 'running', 'paused'].includes(parent.status)) {
          throw new Error('Child Commander run requires an active parent');
        }
        if (authorizedCanvasIds.some((canvasId) => !parent.authorizedCanvasIds.includes(canvasId))) {
          throw new Error('Child Commander run cannot expand parent Canvas authority');
        }
      }
      if (input.retryOfRunId) {
        const retrySource = this.require(input.retryOfRunId);
        if (retrySource.sessionId !== input.sessionId) {
          throw new Error('Retry source cannot belong to another session');
        }
      }
      if (!parent && authorizedCanvasIds.length > 0) {
        const placeholders = authorizedCanvasIds.map(() => '?').join(', ');
        const overlap = this.db
          .prepare(
            `SELECT scopes.${RUN_CANVASES.cols.canvasId.sqlName} AS canvas_id
               FROM ${RUN_CANVASES.tableName} scopes
               JOIN ${RUNS.tableName} runs
                 ON runs.${RUNS.cols.id.sqlName} = scopes.${RUN_CANVASES.cols.runId.sqlName}
              WHERE scopes.${RUN_CANVASES.cols.canvasId.sqlName} IN (${placeholders})
                AND scopes.${RUN_CANVASES.cols.releasedAt.sqlName} IS NULL
                AND runs.${RUNS.cols.parentRunId.sqlName} IS NULL
                AND runs.${RUNS.cols.status.sqlName} IN ('accepted', 'running', 'paused')
              LIMIT 1`,
          )
          .get(...authorizedCanvasIds) as RunCanvasRow | undefined;
        if (overlap) {
          throw new Error(`Canvas "${overlap.canvas_id}" already has an active root run`);
        }
      }
      this.db
        .prepare(
          `INSERT INTO ${RUNS.tableName} (
             ${RUNS.cols.id.sqlName}, ${RUNS.cols.sessionId.sqlName},
             ${RUNS.cols.defaultCanvasId.sqlName}, ${RUNS.cols.workType.sqlName},
             ${RUNS.cols.parentRunId.sqlName}, ${RUNS.cols.retryOfRunId.sqlName},
             ${RUNS.cols.displayName.sqlName}, ${RUNS.cols.objective.sqlName},
             ${RUNS.cols.intent.sqlName},
             ${RUNS.cols.status.sqlName}, ${RUNS.cols.acceptedAt.sqlName},
             ${RUNS.cols.startedAt.sqlName}, ${RUNS.cols.lastSeq.sqlName}
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?)`,
        )
        .run(
          input.id,
          input.sessionId,
          input.defaultCanvasId ?? null,
          workType,
          input.parentRunId ?? null,
          input.retryOfRunId ?? null,
          input.displayName ?? null,
          input.objective ?? null,
          input.intent,
          input.acceptedAt,
          input.acceptedAt,
          initialEvents.length,
        );
      const insertCanvas = this.db.prepare(
        `INSERT INTO ${RUN_CANVASES.tableName} (
           ${RUN_CANVASES.cols.runId.sqlName}, ${RUN_CANVASES.cols.canvasId.sqlName},
           ${RUN_CANVASES.cols.ordinal.sqlName}, ${RUN_CANVASES.cols.releasedAt.sqlName}
         ) VALUES (?, ?, ?, NULL)`,
      );
      authorizedCanvasIds.forEach((canvasId, ordinal) => {
        insertCanvas.run(input.id, canvasId, ordinal);
      });
      this.db
        .prepare(
          `INSERT INTO ${EVENTS.tableName} (
             ${EVENTS.cols.sessionId.sqlName}, ${EVENTS.cols.runId.sqlName},
             ${EVENTS.cols.seq.sqlName}, ${EVENTS.cols.kind.sqlName},
             ${EVENTS.cols.step.sqlName}, ${EVENTS.cols.emittedAt.sqlName},
             ${EVENTS.cols.privatePayload.sqlName},
             ${EVENTS.cols.payload.sqlName}
           ) VALUES (?, ?, 0, 'run_start', 0, ?, ?, ?)`,
        )
        .run(
          input.sessionId,
          input.id,
          input.acceptedAt,
          input.runStartPrivatePayload ?? null,
          input.runStartPayload,
        );
      const insertInitialEvent = this.db.prepare(
        `INSERT INTO ${EVENTS.tableName} (
           ${EVENTS.cols.sessionId.sqlName}, ${EVENTS.cols.runId.sqlName},
           ${EVENTS.cols.seq.sqlName}, ${EVENTS.cols.kind.sqlName},
           ${EVENTS.cols.step.sqlName}, ${EVENTS.cols.emittedAt.sqlName},
           ${EVENTS.cols.privatePayload.sqlName},
           ${EVENTS.cols.payload.sqlName}
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const event of initialEvents) {
        insertInitialEvent.run(
          input.sessionId,
          input.id,
          event.seq,
          event.kind,
          event.step,
          event.emittedAt,
          event.privatePayload ?? null,
          event.payload,
        );
      }
      const insertAttachment = this.db.prepare(
        `INSERT INTO ${ATTACHMENTS.tableName} (
           ${ATTACHMENTS.cols.runId.sqlName}, ${ATTACHMENTS.cols.ordinal.sqlName},
           ${ATTACHMENTS.cols.contentHash.sqlName}, ${ATTACHMENTS.cols.role.sqlName},
           ${ATTACHMENTS.cols.originalName.sqlName}, ${ATTACHMENTS.cols.mimeType.sqlName}
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const attachment of input.attachments) {
        insertAttachment.run(
          input.id,
          attachment.ordinal,
          attachment.contentHash,
          attachment.role,
          attachment.originalName,
          attachment.mimeType,
        );
      }
      return this.require(input.id);
    })();
  }

  append(
    runId: string,
    event: CommanderRunAppendEvent,
  ): StoredCommanderRun {
    return this.appendMany(runId, [event]);
  }

  appendMany(runId: string, events: readonly CommanderRunAppendEvent[]): StoredCommanderRun {
    if (events.length === 0) {
      throw new Error('appendMany requires at least one event');
    }
    return this.db.transaction(() => {
      const run = this.require(runId);
      if (run.status !== 'accepted' && run.status !== 'running' && run.status !== 'paused') {
        throw new Error(`Commander run "${runId}" is already terminal`);
      }

      let expectedSeq = run.lastSeq + 1;
      let nextStatus: CommanderRunStatus = run.status;
      for (const [index, event] of events.entries()) {
        if (event.seq !== expectedSeq) {
          throw new Error(
            `Commander run "${runId}" expected seq ${expectedSeq}, received ${event.seq}`,
          );
        }
        if ((event.kind === 'run_end') !== Boolean(event.terminalStatus)) {
          throw new Error('run_end and terminalStatus must be persisted together');
        }
        if (event.terminalStatus) {
          assertWritableTerminalEvent(event);
        }
        if (event.kind === 'run_end' && index !== events.length - 1) {
          throw new Error('run_end must be the final event in an appendMany batch');
        }
        if (
          nextStatus === 'paused' &&
          event.kind !== 'run_resumed' &&
          event.kind !== 'resource_state' &&
          event.kind !== 'run_end'
        ) {
          throw new Error(`Commander run "${runId}" is paused`);
        }
        if (event.kind === 'run_paused') {
          if (nextStatus !== 'accepted' && nextStatus !== 'running') {
            throw new Error(`Commander run "${runId}" cannot pause from ${nextStatus}`);
          }
          if (event.runStatus !== 'paused') {
            throw new Error('run_paused must persist runStatus paused');
          }
          nextStatus = 'paused';
        } else if (event.kind === 'run_resumed') {
          if (nextStatus !== 'paused') {
            throw new Error(`Commander run "${runId}" cannot resume from ${nextStatus}`);
          }
          if (event.runStatus !== 'running') {
            throw new Error('run_resumed must persist runStatus running');
          }
          nextStatus = 'running';
        } else if (event.runStatus !== undefined) {
          throw new Error('runStatus is only valid for run_paused and run_resumed');
        }
        if (event.terminalStatus) nextStatus = event.terminalStatus;
        expectedSeq += 1;
      }

      const insertEvent = this.db.prepare(
        `INSERT INTO ${EVENTS.tableName} (
           ${EVENTS.cols.sessionId.sqlName}, ${EVENTS.cols.runId.sqlName},
           ${EVENTS.cols.seq.sqlName}, ${EVENTS.cols.kind.sqlName},
           ${EVENTS.cols.step.sqlName}, ${EVENTS.cols.emittedAt.sqlName},
           ${EVENTS.cols.privatePayload.sqlName},
           ${EVENTS.cols.payload.sqlName}
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const event of events) {
        insertEvent.run(
          run.sessionId,
          runId,
          event.seq,
          event.kind,
          event.step,
          event.emittedAt,
          event.privatePayload ?? null,
          event.payload,
        );
      }

      const firstEvent = events[0];
      const lastEvent = events[events.length - 1];
      const updated = this.db
        .prepare(
          `UPDATE ${RUNS.tableName}
              SET ${RUNS.cols.status.sqlName} = ?,
                  ${RUNS.cols.startedAt.sqlName} = COALESCE(${RUNS.cols.startedAt.sqlName}, ?),
                  ${RUNS.cols.completedAt.sqlName} = ?,
                  ${RUNS.cols.lastSeq.sqlName} = ?,
                  ${RUNS.cols.errorText.sqlName} = ?
            WHERE ${RUNS.cols.id.sqlName} = ? AND ${RUNS.cols.lastSeq.sqlName} = ?`,
        )
        .run(
          nextStatus,
          firstEvent.emittedAt,
          lastEvent.terminalStatus ? lastEvent.emittedAt : null,
          lastEvent.seq,
          lastEvent.errorText ?? null,
          runId,
          run.lastSeq,
        );
      if (updated.changes !== 1) {
        throw new Error(`Commander run "${runId}" changed during appendMany`);
      }
      if (lastEvent.terminalStatus) {
        this.db
          .prepare(
            `UPDATE ${RUN_CANVASES.tableName}
                SET ${RUN_CANVASES.cols.releasedAt.sqlName} = ?
              WHERE ${RUN_CANVASES.cols.runId.sqlName} = ?
                AND ${RUN_CANVASES.cols.releasedAt.sqlName} IS NULL`,
          )
          .run(lastEvent.emittedAt, runId);
      }
      return this.require(runId);
    })();
  }

  get(runId: string): StoredCommanderRun | undefined {
    const row = this.db
      .prepare(`SELECT * FROM ${RUNS.tableName} WHERE ${RUNS.cols.id.sqlName} = ?`)
      .get(runId) as RunRow | undefined;
    return row ? rowToRun(row, this.listCanvases(runId), this.listAttachments(runId)) : undefined;
  }

  getLatestForSession(sessionId: SessionId): StoredCommanderRun | undefined {
    const row = this.db
      .prepare(
        `SELECT *
           FROM ${RUNS.tableName}
          WHERE ${RUNS.cols.sessionId.sqlName} = ?
          ORDER BY ${RUNS.cols.acceptedAt.sqlName} DESC, ${RUNS.cols.id.sqlName} DESC
          LIMIT 1`,
      )
      .get(sessionId) as RunRow | undefined;
    return row ? rowToRun(row, this.listCanvases(row.id), this.listAttachments(row.id)) : undefined;
  }

  listActiveRuns(): StoredCommanderRun[] {
    const rows = this.db
      .prepare(
        `WITH RECURSIVE run_tree(id, depth) AS (
           SELECT ${RUNS.cols.id.sqlName}, 0
             FROM ${RUNS.tableName}
            WHERE ${RUNS.cols.parentRunId.sqlName} IS NULL
           UNION ALL
           SELECT child.${RUNS.cols.id.sqlName}, parent.depth + 1
             FROM ${RUNS.tableName} child
             JOIN run_tree parent
               ON child.${RUNS.cols.parentRunId.sqlName} = parent.id
         )
         SELECT runs.*
           FROM ${RUNS.tableName} runs
           JOIN run_tree ON run_tree.id = runs.${RUNS.cols.id.sqlName}
          WHERE runs.${RUNS.cols.status.sqlName} IN ('accepted', 'running', 'paused')
          ORDER BY run_tree.depth,
                   runs.${RUNS.cols.acceptedAt.sqlName},
                   runs.${RUNS.cols.id.sqlName}`,
      )
      .all() as RunRow[];
    return rows.map((row) =>
      rowToRun(row, this.listCanvases(row.id), this.listAttachments(row.id)),
    );
  }

  listRunHeadsForSession(sessionId: SessionId): StoredCommanderRun[] {
    const rows = this.db
      .prepare(
        `SELECT *
           FROM ${RUNS.tableName}
          WHERE ${RUNS.cols.sessionId.sqlName} = ?
          ORDER BY ${RUNS.cols.acceptedAt.sqlName}, ${RUNS.cols.id.sqlName}`,
      )
      .all(sessionId) as RunRow[];
    return rows.map((row) =>
      rowToRun(row, this.listCanvases(row.id), this.listAttachments(row.id)),
    );
  }

  listEventsForSession(sessionId: SessionId): StoredCommanderRunEvent[] {
    const rows = this.db
      .prepare(
        `SELECT ${PUBLIC_EVENT_COLUMNS}
           FROM ${EVENTS.tableName} events
           JOIN ${RUNS.tableName} runs
             ON runs.${RUNS.cols.id.sqlName} = events.${EVENTS.cols.runId.sqlName}
          WHERE runs.${RUNS.cols.sessionId.sqlName} = ?
          ORDER BY runs.${RUNS.cols.acceptedAt.sqlName},
                   runs.${RUNS.cols.id.sqlName},
                   events.${EVENTS.cols.seq.sqlName}`,
      )
      .all(sessionId) as EventRow[];
    return rows.map(rowToEvent);
  }

  listEvents(runId: string, afterSeq = -1): StoredCommanderRunEvent[] {
    const rows = this.db
      .prepare(
        `SELECT ${PUBLIC_EVENT_COLUMNS}
           FROM ${EVENTS.tableName} events
           JOIN ${RUNS.tableName} runs ON runs.${RUNS.cols.id.sqlName} = events.${EVENTS.cols.runId.sqlName}
          WHERE events.${EVENTS.cols.runId.sqlName} = ?
            AND events.${EVENTS.cols.seq.sqlName} > ?
          ORDER BY events.${EVENTS.cols.seq.sqlName}`,
      )
      .all(runId, afterSeq) as EventRow[];
    return rows.map(rowToEvent);
  }

  listRecoveryEvents(runId: string, afterSeq = -1): StoredCommanderRunRecoveryEvent[] {
    const rows = this.db
      .prepare(
        `SELECT ${PUBLIC_EVENT_COLUMNS},
                events.${EVENTS.cols.privatePayload.sqlName}
           FROM ${EVENTS.tableName} events
           JOIN ${RUNS.tableName} runs ON runs.${RUNS.cols.id.sqlName} = events.${EVENTS.cols.runId.sqlName}
          WHERE events.${EVENTS.cols.runId.sqlName} = ?
            AND events.${EVENTS.cols.seq.sqlName} > ?
          ORDER BY events.${EVENTS.cols.seq.sqlName}`,
      )
      .all(runId, afterSeq) as RecoveryEventRow[];
    return rows.map((row) => ({ ...rowToEvent(row), privatePayload: row.private_payload }));
  }

  private listAttachments(runId: string): CommanderRunAttachment[] {
    const rows = this.db
      .prepare(
        `SELECT ${ATTACHMENTS.cols.ordinal.sqlName},
                ${ATTACHMENTS.cols.contentHash.sqlName},
                ${ATTACHMENTS.cols.role.sqlName},
                ${ATTACHMENTS.cols.originalName.sqlName},
                ${ATTACHMENTS.cols.mimeType.sqlName}
           FROM ${ATTACHMENTS.tableName}
          WHERE ${ATTACHMENTS.cols.runId.sqlName} = ?
          ORDER BY ${ATTACHMENTS.cols.ordinal.sqlName}`,
      )
      .all(runId) as AttachmentRow[];
    return rows.map((row) => ({
      ordinal: row.ordinal,
      contentHash: row.content_hash,
      role: row.role,
      originalName: row.original_name,
      mimeType: row.mime_type,
    }));
  }

  private listCanvases(runId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT ${RUN_CANVASES.cols.canvasId.sqlName}
           FROM ${RUN_CANVASES.tableName}
          WHERE ${RUN_CANVASES.cols.runId.sqlName} = ?
          ORDER BY ${RUN_CANVASES.cols.ordinal.sqlName}`,
      )
      .all(runId) as RunCanvasRow[];
    return rows.map((row) => row.canvas_id);
  }

  private require(runId: string): StoredCommanderRun {
    const run = this.get(runId);
    if (!run) throw new Error(`Commander run "${runId}" not found`);
    return run;
  }
}

function rowToRun(
  row: RunRow,
  authorizedCanvasIds: string[],
  attachments: CommanderRunAttachment[],
): StoredCommanderRun {
  return {
    id: row.id,
    sessionId: row.session_id as SessionId,
    defaultCanvasId: row.default_canvas_id ?? undefined,
    authorizedCanvasIds,
    intent: row.intent,
    workType: row.work_type,
    parentRunId: row.parent_run_id ?? undefined,
    retryOfRunId: row.retry_of_run_id ?? undefined,
    displayName: row.display_name ?? undefined,
    objective: row.objective ?? undefined,
    status: row.status,
    acceptedAt: row.accepted_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    lastSeq: row.last_seq,
    errorText: row.error_text ?? undefined,
    attachments,
  };
}

function rowToEvent(row: EventRow): StoredCommanderRunEvent {
  return {
    sessionId: row.session_id as SessionId,
    runId: row.run_id,
    seq: row.seq,
    kind: row.kind,
    step: row.step,
    emittedAt: row.emitted_at,
    payload: row.payload,
  };
}

function assertWritableTerminalEvent(event: CommanderRunAppendEvent): void {
  const terminalStatus = event.terminalStatus;
  if (!terminalStatus || !WRITABLE_TERMINAL_STATUSES.has(terminalStatus)) {
    throw new Error(`Commander terminal status "${String(terminalStatus)}" is not writable`);
  }
  if (terminalStatus !== 'blocked') return;

  let payload: unknown;
  try {
    payload = JSON.parse(event.payload);
  } catch {
    throw new Error('blocked run_end must include a valid blocker');
  }
  if (
    !isRecord(payload) ||
    payload.kind !== 'run_end' ||
    payload.status !== 'blocked' ||
    !isRunBlocker(payload.blocker)
  ) {
    throw new Error('blocked run_end must include a valid blocker');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRunBlocker(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    (value.kind === 'resource_budget' &&
      (value.metric === 'tokens' ||
        value.metric === 'tool_calls' ||
        value.metric === 'wall_time' ||
        value.metric === 'cost') &&
      (value.reason === 'exhausted' || value.reason === 'unavailable')) ||
    (value.kind === 'safety_limit' &&
      (value.limit === 'context_window' ||
        value.limit === 'provider_limit' ||
        value.limit === 'recovery_required'))
  );
}
