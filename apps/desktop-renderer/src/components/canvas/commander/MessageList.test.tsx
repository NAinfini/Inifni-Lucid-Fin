// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageList } from './MessageList.js';
import type { CommanderMessage } from '../../../store/slices/commander.js';

const t = (key: string) =>
  (
    ({
      'commander.copy': 'Copy',
      'commander.toolResult': 'Tool result',
      'commander.elapsed': 'Elapsed',
      'commander.minimize': 'Minimize',
      'commander.expandRun': 'Expand run',
      'commander.collapseRun': 'Collapse run',
      'commander.runCompleted': 'Completed',
      'commander.runFailed': 'Failed',
      'commander.runBlocked': 'Blocked',
      'commander.resource.blocker.costUnavailable':
        'Cost information is unavailable for this operation.',
      'commander.runTools': 'tools',
      'commander.runErrors': 'errors',
      'commander.toolUsage.calls': '{count} calls',
      'commander.toolUsage.completed': '{count} completed',
      'commander.toolUsage.errors': '{count} errors',
      'commander.thinkingProcess': 'Thinking...',
      'commander.stepLabel': 'Step',
      'commander.phaseNote.processPromptLoaded': 'Reloaded process prompt',
      'commander.phaseNote.compacted': 'Context compacted',
      'commander.phaseNote.llmRetry': 'LLM retry',
      'commander.commanderAI': 'Dreamfish',
    }) as Record<string, string>
  )[key] ?? key;

afterEach(() => {
  cleanup();
});

describe('MessageList run summaries', () => {
  it('places user messages on the right and assistant messages on the left with timestamps', () => {
    const messages: CommanderMessage[] = [
      { id: 'user-1', role: 'user', content: 'Make a short film', timestamp: 3_600_000 },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'I will start with the plan.',
        timestamp: 3_660_000,
      },
    ];

    render(
      <MessageList
        messages={messages}
        pendingInjectedMessages={[]}
        error={null}
        t={t}
        emptyLabel="Empty"
      />,
    );

    expect(screen.getByTestId('commander-message-user-1').className).toContain('justify-end');
    expect(screen.getByTestId('commander-message-assistant-1').className).toContain(
      'justify-start',
    );
    expect(screen.getByText('Dreamfish')).toBeTruthy();
    expect(screen.getAllByTestId('commander-message-time')).toHaveLength(2);
  });

  it('renders a Codex-style elapsed divider and the final answer in full', () => {
    const message = {
      id: 'assistant-run-2',
      role: 'assistant',
      content:
        'Need proper schemas first. I will read the current character, location, and node lists, then rewrite everything in one pass.',
      timestamp: 456,
      runMeta: {
        status: 'failed',
        collapsed: true,
        startedAt: 1000,
        completedAt: 151600,
        summary: {
          excerpt:
            'Need proper schemas first. I will read the current character, location, and node lists, then rewrite everything in one pass.',
          toolCount: 24,
          failedToolCount: 6,
          durationMs: 150600,
        },
      },
    } as CommanderMessage;

    render(
      <MessageList
        messages={[message]}
        pendingInjectedMessages={[]}
        error={null}
        t={t}
        emptyLabel="Empty"
      />,
    );

    // Codex-style layout: elapsed time + divider, then the final answer as
    // ordinary markdown. Tool counts stay behind the process disclosure.
    expect(screen.getByTestId('run-summary-header')).toBeTruthy();
    expect(screen.getByTestId('run-summary-metrics')).toBeTruthy();
    expect(screen.getByTestId('run-summary-divider')).toBeTruthy();
    expect(screen.getByTestId('run-summary-final')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('Elapsed 2.5m')).toBeTruthy();
    expect(screen.queryByText('24 tools')).toBeNull();
    expect(screen.queryByText('6 errors')).toBeNull();
    // Full answer is visible, not hidden behind a collapse
    expect(
      screen.getByText(
        'Need proper schemas first. I will read the current character, location, and node lists, then rewrite everything in one pass.',
      ),
    ).toBeTruthy();
  });

  it('expands activity inside the matching run summary instead of near the composer', () => {
    const message = {
      id: 'assistant-run-inline-activity',
      role: 'assistant',
      content: '',
      timestamp: 456,
      runMeta: {
        runId: 'run-inline-activity',
        status: 'failed',
        collapsed: true,
        startedAt: 100,
        completedAt: 200,
        summary: { excerpt: '', toolCount: 0, failedToolCount: 0, durationMs: 100 },
      },
    } as CommanderMessage;
    const onViewActivity = vi.fn();
    const activity = <div role="region" aria-label="Run activity details" />;
    const { rerender } = render(
      <MessageList
        messages={[message]}
        pendingInjectedMessages={[]}
        error={null}
        t={t}
        emptyLabel="Empty"
        expandedActivityRunId={null}
        activityContent={activity}
        onViewActivity={onViewActivity}
      />,
    );

    const toggle = screen.getByRole('button', {
      name: 'commander.agentActivity.viewActivity',
    });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(onViewActivity).toHaveBeenCalledWith('run-inline-activity');

    rerender(
      <MessageList
        messages={[message]}
        pendingInjectedMessages={[]}
        error={null}
        t={t}
        emptyLabel="Empty"
        expandedActivityRunId="run-inline-activity"
        activityContent={activity}
        onViewActivity={onViewActivity}
      />,
    );

    const messageRow = screen.getByTestId('commander-message-assistant-run-inline-activity');
    const details = screen.getByRole('region', { name: 'Run activity details' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(messageRow.contains(details)).toBe(true);
  });

  it('shows the final answer immediately and reveals only aggregated tool usage', () => {
    const message = {
      id: 'assistant-run-1',
      role: 'assistant',
      content:
        'Planning the change.Created the requested layout and verified every connected node.',
      segments: [
        { kind: 'text', id: 's1', content: 'Planning the change.' },
        {
          kind: 'tool',
          id: 's2',
          toolCall: {
            id: 'tool-1',
            name: 'canvas.createNode',
            summary: 'Create an image node',
            details: { type: 'image' },
            startedAt: 1,
            completedAt: 2,
            status: 'done',
          },
        },
        {
          kind: 'text',
          id: 's3',
          content: 'Created the requested layout and verified every connected node.',
        },
      ],
      toolCalls: [
        {
          id: 'tool-1',
          name: 'canvas.createNode',
          summary: 'Create an image node',
          details: { type: 'image' },
          startedAt: 1,
          completedAt: 2,
          status: 'done',
        },
      ],
      timestamp: 123,
      runMeta: {
        status: 'completed',
        collapsed: true,
        startedAt: 1000,
        completedAt: 2200,
        summary: {
          excerpt: 'Created the requested layout and verified every connected node.',
          toolCount: 1,
          failedToolCount: 0,
          durationMs: 1200,
        },
      },
    } as CommanderMessage;

    render(
      <MessageList
        messages={[message]}
        pendingInjectedMessages={[]}
        error={null}
        t={t}
        emptyLabel="Empty"
      />,
    );

    // Final answer is visible by default (the key win of the A-style redesign).
    expect(
      screen.getByText('Created the requested layout and verified every connected node.'),
    ).toBeTruthy();
    // Intermediate narration and raw tool details are never shown.
    expect(screen.queryByText('Planning the change.')).toBeNull();
    expect(screen.queryByRole('button', { name: /canvas.*create node/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /expand run/i }));

    expect(screen.queryByText('Planning the change.')).toBeNull();
    expect(screen.queryByRole('button', { name: /canvas.*create node/i })).toBeNull();
    expect(screen.getByTestId('run-tool-usage-summary')).toBeTruthy();
    expect(screen.getByText('canvas.createNode')).toBeTruthy();
    expect(screen.getByText('1 calls')).toBeTruthy();
    expect(screen.getByText(/1 completed/)).toBeTruthy();
    // Final answer stays visible after expand.
    expect(
      screen.getByText('Created the requested layout and verified every connected node.'),
    ).toBeTruthy();
  });

  it('does not fall back to pre-tool narration when a run has no final answer', () => {
    const message = {
      id: 'assistant-run-no-final',
      role: 'assistant',
      content: 'I will inspect the canvas before continuing.',
      segments: [
        { kind: 'text', id: 's1', content: 'I will inspect the canvas before continuing.' },
        {
          kind: 'tool',
          id: 's2',
          toolCall: {
            id: 'tool-1',
            name: 'canvas.getInfo',
            summary: 'Read canvas information',
            startedAt: 1,
            completedAt: 2,
            status: 'done',
          },
        },
      ],
      timestamp: 123,
      runMeta: {
        status: 'failed',
        collapsed: true,
        startedAt: 1,
        completedAt: 2,
        summary: {
          excerpt: 'I will inspect the canvas before continuing.',
          toolCount: 1,
          failedToolCount: 0,
          durationMs: 1,
        },
      },
    } as CommanderMessage;

    render(
      <MessageList
        messages={[message]}
        pendingInjectedMessages={[]}
        error={null}
        t={t}
        emptyLabel="Empty"
      />,
    );

    expect(screen.queryByText('I will inspect the canvas before continuing.')).toBeNull();
    expect(screen.getByTestId('run-summary-header')).toBeTruthy();
  });

  it('renders a typed blocked run distinctly from a failure', () => {
    const message = {
      id: 'assistant-run-blocked',
      role: 'assistant',
      content: '',
      timestamp: 123,
      runMeta: {
        status: 'blocked',
        collapsed: true,
        startedAt: 100,
        completedAt: 123,
        summary: { excerpt: '', toolCount: 0, failedToolCount: 0, durationMs: 23 },
        blocker: { kind: 'resource_budget', metric: 'cost', reason: 'unavailable' },
      },
    } as CommanderMessage;

    render(
      <MessageList
        messages={[message]}
        pendingInjectedMessages={[]}
        error={null}
        t={t}
        emptyLabel="Empty"
      />,
    );

    expect(screen.getByText('Blocked')).toBeTruthy();
    expect(screen.getByTestId('run-blocker').textContent).toContain(
      'Cost information is unavailable for this operation.',
    );
    expect(screen.queryByText('Failed')).toBeNull();
  });

  it('renders each MessageSegment variant without throwing assertNever', () => {
    const message = {
      id: 'assistant-run-3',
      role: 'assistant',
      content: 'Done.',
      segments: [
        {
          kind: 'progress',
          id: 'sg-1',
          operationId: 'model:1',
          status: 'completed',
          summary: 'Preparing an answer',
        },
        {
          kind: 'resource_usage',
          id: 'sg-usage',
          operationId: 'model:1',
          promptTokens: 12,
          completionTokens: 4,
        },
        { kind: 'step_marker', id: 'sg-2', step: 2, at: 1_700_000_000_000 },
        {
          kind: 'phase_note',
          id: 'sg-3',
          note: 'llm_retry',
          detail: '2/3',
        },
        { kind: 'text', id: 'sg-4', content: 'Done.' },
      ],
      timestamp: 789,
    } as CommanderMessage;

    render(
      <MessageList
        messages={[message]}
        pendingInjectedMessages={[]}
        error={null}
        t={t}
        emptyLabel="Empty"
      />,
    );

    expect(screen.getByText('Done.')).toBeTruthy();
    expect(screen.queryByText('Preparing an answer')).toBeNull();
    // Step markers are kept in the timeline for selectors/tests but no
    // longer surfaced in the UI — the chat list shouldn't render them.
    expect(screen.queryByText(/Step\s*2/i)).toBeNull();
    expect(screen.queryByText(/LLM retry: 2\/3/)).toBeNull();
  });
});
