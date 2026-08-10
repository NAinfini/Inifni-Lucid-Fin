import { describe, expect, it, vi } from 'vitest';
import { createCommanderRunWiring } from './commander-run-wiring.js';

describe('createCommanderRunWiring', () => {
  it('uses the persisted session id and delegates context recovery reports', async () => {
    const reportContextRecovery = vi.fn(async () => ({
      state: 'recovering' as const,
      consecutiveFailures: 1,
      changed: true,
    }));
    const wiring = createCommanderRunWiring({ canvasId: 'canvas-1', sessionId: 'session-7' }, {
      reportContextRecovery,
    } as never);
    const report = {
      workflowRunId: 'workflow-context-1',
      outcome: 'failed' as const,
      reason: 'compaction_failed',
    };

    expect(wiring.toolSessionId).toBe('session-7');
    await expect(wiring.onContextRecoveryReport(report)).resolves.toMatchObject({
      state: 'recovering',
    });
    expect(reportContextRecovery).toHaveBeenCalledWith(report);
  });

  it('falls back to the canvas id when no persisted session exists', () => {
    const wiring = createCommanderRunWiring({ canvasId: 'canvas-1' }, {
      reportContextRecovery: vi.fn(),
    } as never);

    expect(wiring.toolSessionId).toBe('canvas-1');
  });
});
