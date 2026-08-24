import {
  PROJECTOR_VERSION,
  canonicalJson,
  hashCommanderContextProjection,
  projectCommanderContext,
  type HistoryEntry,
  type ToolRegistry,
} from '@lucid-fin/application';
import type {
  CommanderContextCache,
  CommanderContextCacheRun,
  CommanderRunRecord,
  SessionId,
  TimelineEvent,
} from '@lucid-fin/contracts';
import type {
  CommanderRunRepository,
  SessionRepository,
  StoredCommanderRun,
  StoredCommanderRunEvent,
} from '@lucid-fin/storage';
import {
  createCommanderPublicProjectionState,
  projectCommanderPublicEvent,
} from './commander-public-event.js';

type ContextCacheRepositories = {
  commanderRuns: Pick<CommanderRunRepository, 'listRunHeadsForSession' | 'listEvents'>;
  sessions: Pick<SessionRepository, 'readContextCache' | 'saveContextCache'>;
};

export interface CommanderContextCacheLoadResult {
  cache: CommanderContextCache;
  rebuiltRunIds: string[];
  reusedRunIds: string[];
}

function isSelfConsistentCache(cache: CommanderContextCache, sessionId: string): boolean {
  if (cache.sessionId !== sessionId || cache.projectorVersion !== PROJECTOR_VERSION) return false;
  const { projectionHash: _projectionHash, ...envelope } = cache;
  return hashCommanderContextProjection(envelope) === cache.projectionHash;
}

function canReuseRun(cached: CommanderContextCacheRun, run: StoredCommanderRun): boolean {
  return (
    cached.runId === run.id &&
    cached.acceptedAt === run.acceptedAt &&
    cached.status === run.status &&
    cached.throughSeq === run.lastSeq
  );
}

function parseStoredEvents(
  run: StoredCommanderRun,
  rows: readonly StoredCommanderRunEvent[],
  registry: ToolRegistry,
): TimelineEvent[] {
  const state = createCommanderPublicProjectionState();
  return rows.map((row, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payload);
    } catch {
      throw new Error(`Commander event ${run.id}:${row.seq} contains invalid JSON`);
    }
    const event = projectCommanderPublicEvent(parsed, registry, state);
    if (!event) {
      throw new Error(`Commander event ${run.id}:${row.seq} cannot be projected safely`);
    }
    if (row.runId !== run.id || row.seq !== index || event.runId !== run.id || event.seq !== row.seq) {
      throw new Error(`Commander event sequence is inconsistent for ${run.id}:${row.seq}`);
    }
    return event;
  });
}

function projectRun(
  sessionId: string,
  run: StoredCommanderRun,
  rows: readonly StoredCommanderRunEvent[],
  registry: ToolRegistry,
): CommanderContextCacheRun {
  const events = parseStoredEvents(run, rows, registry);
  const projected = projectCommanderContext({
    sessionId,
    runs: [{ run: run as CommanderRunRecord, events }],
  });
  const cacheRun = projected.runs[0];
  if (!cacheRun) throw new Error(`Commander run ${run.id} has no projectable events`);
  return cacheRun;
}

export function loadCommanderContextCache(
  repositories: ContextCacheRepositories,
  sessionId: SessionId,
  registry: ToolRegistry,
): CommanderContextCacheLoadResult {
  const heads = repositories.commanderRuns.listRunHeadsForSession(sessionId);
  const stored = repositories.sessions.readContextCache(sessionId);
  const validStored =
    stored.state === 'valid' && isSelfConsistentCache(stored.cache, sessionId)
      ? stored.cache
      : undefined;
  const cachedByRunId = new Map(validStored?.runs.map((run) => [run.runId, run]) ?? []);
  const rebuiltRunIds: string[] = [];
  const reusedRunIds: string[] = [];
  const runs = heads.map((head) => {
    const cached = cachedByRunId.get(head.id);
    if (cached && canReuseRun(cached, head)) {
      reusedRunIds.push(head.id);
      return cached;
    }
    rebuiltRunIds.push(head.id);
    return projectRun(sessionId, head, repositories.commanderRuns.listEvents(head.id), registry);
  });
  const envelope: Omit<CommanderContextCache, 'projectionHash'> = {
    kind: 'commander_context_cache',
    version: 2,
    projectorVersion: PROJECTOR_VERSION,
    sessionId,
    runs,
  };
  const cache: CommanderContextCache = {
    ...envelope,
    projectionHash: hashCommanderContextProjection(envelope),
  };
  if (!validStored || rebuiltRunIds.length > 0 || validStored.runs.length !== heads.length) {
    repositories.sessions.saveContextCache(sessionId, cache);
  }
  return { cache, rebuiltRunIds, reusedRunIds };
}

export function buildModelViewFromCommanderContextCache(
  cache: CommanderContextCache,
  excludeRunId?: string,
): HistoryEntry[] {
  const history: HistoryEntry[] = [];
  for (const run of cache.runs) {
    if (run.runId === excludeRunId) continue;
    for (const item of run.items) {
      if (item.kind === 'user_input') {
        history.push({ role: 'user', content: item.content });
      } else if (item.kind === 'assistant_text') {
        history.push({ role: 'assistant', content: item.content });
      } else if (item.kind === 'interaction' && item.content) {
        history.push({
          role: item.interaction === 'question' ? 'assistant' : 'user',
          content: item.content,
        });
      } else if (
        item.kind === 'run_context' ||
        item.kind === 'tool_observation' ||
        item.kind === 'terminal_summary'
      ) {
        history.push({
          role: 'system',
          content: canonicalJson(item as Parameters<typeof canonicalJson>[0]),
        });
      }
    }
  }
  return history;
}
