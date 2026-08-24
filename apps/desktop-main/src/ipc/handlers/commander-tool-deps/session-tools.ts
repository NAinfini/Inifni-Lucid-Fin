import {
  createSnapshotTools,
  createRunChecklistTools,
  parseSessionId,
  parseSnapshotId,
  type ToolRegistry,
  type SqliteIndex,
} from './helpers.js';

export function registerSessionTools(
  registry: ToolRegistry,
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

  for (const tool of createRunChecklistTools()) {
    registry.register(tool);
  }
}
