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
  it('renders compact summary metadata in separate layout groups', () => {
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

    expect(screen.getByTestId('run-summary-header')).toBeTruthy();
    expect(screen.getByTestId('run-summary-metrics')).toBeTruthy();
    expect(screen.getByTestId('run-summary-excerpt')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('2.5m')).toBeTruthy();
    expect(screen.getByText('24 tools')).toBeTruthy();
    expect(screen.getByText('6 errors')).toBeTruthy();
  });

  it('renders completed assistant runs collapsed by default and expands on click', () => {
    const message = {
      id: 'assistant-run-1',
      role: 'assistant',
      content: 'Created the requested layout and verified every connected node.',
      segments: [
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

    expect(screen.getByText('Created the requested layout and verified every connected node.')).toBeTruthy();
    expect(screen.queryByText('Planning the node changes')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /expand run/i }));

    expect(screen.getByText('Planning the node changes')).toBeTruthy();
    expect(screen.getAllByText('Created the requested layout and verified every connected node.').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /canvas.*create node/i })).toBeTruthy();
  });
});
