import { describe, expect, it, vi } from 'vitest';
import { createCommanderRunWiring } from './commander-run-wiring.js';

describe('createCommanderRunWiring', () => {
  it('uses the persisted session id and delegates context recovery reports', async () => {
    const reportContextRecovery = vi.fn(async () => ({
      state: 'recovering' as const,
      consecutiveFailures: 1,
      changed: true,
    }));
    const wiring = createCommanderRunWiring({ defaultCanvasId: 'canvas-1', sessionId: 'session-7' }, {
      reportContextRecovery,
    } as never);
    const report = {
      taskListId: 'task-list-context-1',
      outcome: 'failed' as const,
      reason: 'compaction_failed',
    };

    expect(wiring.toolSessionId).toBe('session-7');
    await expect(wiring.onContextRecoveryReport(report)).resolves.toMatchObject({
      state: 'recovering',
    });
    expect(reportContextRecovery).toHaveBeenCalledWith(report);
  });

  it('never derives the tool session id from the default Canvas', () => {
    const wiring = createCommanderRunWiring({ defaultCanvasId: 'canvas-1', sessionId: 'session-9' }, {
      reportContextRecovery: vi.fn(),
    } as never);

    expect(wiring.toolSessionId).toBe('session-9');
  });
});
