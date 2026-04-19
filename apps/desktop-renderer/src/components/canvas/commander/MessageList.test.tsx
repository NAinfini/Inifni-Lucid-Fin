// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageList } from './MessageList.js';
import type { CommanderMessage } from '../../../store/slices/commander.js';

const t = (key: string) =>
  (
    {
      'commander.copy': 'Copy',
      'commander.toolResult': 'Tool result',
      'commander.elapsed': 'Elapsed',
      'commander.minimize': 'Minimize',
      'commander.expandRun': 'Expand run',
      'commander.collapseRun': 'Collapse run',
      'commander.runCompleted': 'Completed',
      'commander.runFailed': 'Failed',
      'commander.runTools': 'tools',
      'commander.runErrors': 'errors',
      'commander.thinkingProcess': 'Thinking...',
    } as Record<string, string>
  )[key] ?? key;

afterEach(() => {
  cleanup();
});

describe('MessageList run summaries', () => {
  it('renders a one-line process toggle with metrics and the final answer in full', () => {
    const message = {
      id: 'assistant-run-2',
      role: 'assistant',
      content: 'Need proper schemas first. I will read the current character, location, and node lists, then rewrite everything in one pass.',
      timestamp: 456,
      runMeta: {
        status: 'failed',
        collapsed: true,
        startedAt: 1000,
        completedAt: 151600,
        summary: {
          excerpt: 'Need proper schemas first. I will read the current character, location, and node lists, then rewrite everything in one pass.',
          toolCount: 24,
          failedToolCount: 6,
          durationMs: 150600,
        },
      },
    } as CommanderMessage;

    render(
      <MessageList
        messages={[message]}
        liveMessage={null}
        currentSegments={[]}
        pendingInjectedMessages={[]}
        isStreaming={false}
        error={null}
        nodeTitlesById={{}}
        t={t}
        emptyLabel="Empty"
        streamingLabel="Streaming"
      />,
    );

    // Codex-style layout: one-line process toggle + metrics row, then the
    // final answer rendered as ordinary markdown underneath (not an excerpt).
    expect(screen.getByTestId('run-summary-header')).toBeTruthy();
    expect(screen.getByTestId('run-summary-metrics')).toBeTruthy();
    expect(screen.getByTestId('run-summary-final')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('2.5m')).toBeTruthy();
    expect(screen.getByText('24 tools')).toBeTruthy();
    expect(screen.getByText('6 errors')).toBeTruthy();
    // Full answer is visible, not hidden behind a collapse
    expect(
      screen.getByText(
        'Need proper schemas first. I will read the current character, location, and node lists, then rewrite everything in one pass.',
      ),
    ).toBeTruthy();
  });

  it('shows the final answer immediately and reveals the process on expand', () => {
    const message = {
      id: 'assistant-run-1',
      role: 'assistant',
      content: 'Planning the change.Created the requested layout and verified every connected node.',
      segments: [
        { type: 'text', content: 'Planning the change.' },
        {
          type: 'tool',
          toolCall: {
            id: 'tool-1',
            name: 'canvas.createNode',
            arguments: { type: 'image' },
            result: { success: true },
            startedAt: 1,
            completedAt: 2,
            status: 'done',
          },
        },
        { type: 'text', content: 'Created the requested layout and verified every connected node.' },
      ],
      toolCalls: [
        {
          id: 'tool-1',
          name: 'canvas.createNode',
          arguments: { type: 'image' },
          result: { success: true },
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
        thinkingContent: 'Planning the node changes',
        summary: {
          excerpt: 'Created the requested layout and verified every connected node.',
          toolCount: 1,
          failedToolCount: 0,
          durationMs: 1200,
        },
      },
    } as CommanderMessage & {
      runMeta: {
        status: 'completed' | 'failed';
        collapsed: boolean;
        startedAt: number;
        completedAt: number;
        thinkingContent?: string;
        summary: {
          excerpt: string;
          toolCount: number;
          failedToolCount: number;
          durationMs: number;
        };
      };
    };

    render(
      <MessageList
        messages={[message]}
        liveMessage={null}
        currentSegments={[]}
        pendingInjectedMessages={[]}
        isStreaming={false}
        error={null}
        nodeTitlesById={{}}
        t={t}
        emptyLabel="Empty"
        streamingLabel="Streaming"
      />,
    );

    // Final answer is visible by default (the key win of the A-style redesign).
    expect(
      screen.getByText('Created the requested layout and verified every connected node.'),
    ).toBeTruthy();
    // Process details (thinking + intermediate text + tool card) are hidden.
    expect(screen.queryByText('Planning the node changes')).toBeNull();
    expect(screen.queryByText('Planning the change.')).toBeNull();
    expect(screen.queryByRole('button', { name: /canvas.*create node/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /expand run/i }));

    expect(screen.getByText('Planning the node changes')).toBeTruthy();
    expect(screen.getByText('Planning the change.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /canvas.*create node/i })).toBeTruthy();
    // Final answer stays visible after expand.
    expect(
      screen.getByText('Created the requested layout and verified every connected node.'),
    ).toBeTruthy();
  });
});
