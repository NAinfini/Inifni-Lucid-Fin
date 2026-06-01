import {
  createSnapshotTools,
  createTodoTools,
  parseSessionId,
  parseSnapshotId,
  type AgentToolRegistry,
  type SqliteIndex,
} from './helpers.js';

export function registerSessionTools(
  registry: AgentToolRegistry,
  db: SqliteIndex,
  sessionId?: string,
): void {
  if (sessionId) {
    for (const tool of createSnapshotTools({
      captureSnapshot: (sid, label, trigger) =>
        db.repos.snapshots.capture(parseSessionId(sid), label, trigger),
      listSnapshots: (sid) =>
        db.repos.snapshots.list(parseSessionId(sid)).rows.map(({ data: _d, ...meta }) => meta),
      restoreSnapshot: (snapshotId) => db.repos.snapshots.restore(parseSnapshotId(snapshotId)),
      getSessionId: () => sessionId,
    })) {
      registry.register(tool);
    }
  }

  for (const tool of createTodoTools()) {
    registry.register(tool);
  }
}
