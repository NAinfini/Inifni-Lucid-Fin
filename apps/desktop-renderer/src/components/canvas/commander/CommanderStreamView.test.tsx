// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { commanderSlice } from '../../../store/slices/commander.js';
import { getAPI } from '../../../utils/api.js';
import { CommanderStreamView } from './CommanderStreamView.js';

vi.mock('../../../utils/api.js', () => ({ getAPI: vi.fn() }));

const messages: Record<string, string> = {
  'commander.toolConfirm.title': 'Action Confirmation',
  'commander.toolConfirm.execute': 'Execute',
  'commander.toolConfirm.skip': 'Skip',
  'commander.toolConfirm.saving': 'Saving decision…',
  'commander.toolConfirm.decisionUnavailable': 'Decision unavailable',
  'commander.toolConfirm.decisionFailed': 'Decision failed',
  'commander.toolConfirm.decisionRejected':
    'The tool decision was not accepted ({code}). Try again.',
  'commander.tierLabels.safe': 'Read',
  'commander.tierLabels.mutation': 'Modify',
  'commander.tierLabels.generation': 'Generate',
  'commander.tierLabels.system': 'System',
};

describe('CommanderStreamView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retains a tool confirmation after an IPC rejection so the user can retry', async () => {
    const toolDecision = vi.fn().mockResolvedValue({ accepted: false, code: 'stale_run' });
    vi.mocked(getAPI).mockReturnValue({
      commander: { toolDecision },
    } as unknown as ReturnType<typeof getAPI>);

    const store = configureStore({
      reducer: {
        commander: commanderSlice.reducer,
      },
    });
    store.dispatch(
      commanderSlice.actions.ensureActiveSession({
        id: 'session-1',
        defaultCanvasId: 'canvas-1',
      }),
    );

    render(
      <Provider store={store}>
        <CommanderStreamView
          currentRunId="run-1"
          consecutiveConfirmCount={0}
          pendingConfirmation={{
            toolCallId: 'tool-1',
            toolName: 'canvas.createNode',
            summary: 'Create a Canvas node',
            details: { type: 'image' },
            tier: 2,
          }}
          t={(key) => messages[key] ?? key}
        />
      </Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Execute' }));

    await waitFor(() => {
      expect(toolDecision).toHaveBeenCalledWith({
        sessionId: 'session-1',
        runId: 'run-1',
        toolCallId: 'tool-1',
        approved: true,
      });
      expect(
        screen.getByText('The tool decision was not accepted (stale_run). Try again.'),
      ).toBeTruthy();
    });
    expect(screen.getByRole('button', { name: 'Execute' })).toBeTruthy();
  });
});
