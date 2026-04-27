// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToolCallCard } from './ToolCallCard.js';

const t = (key: string) =>
  (
    ({
      'commander.elapsed': 'Elapsed',
      'commander.minimize': 'Minimize',
      'commander.toolResult': 'Tool result',
    }) as Record<string, string>
  )[key] ?? key;

describe('ToolCallCard', () => {
  it('defers reading heavy payloads until expanded', () => {
    const heavyGetter = vi.fn(() => 'large payload');
    const args: Record<string, unknown> = {};
    Object.defineProperty(args, 'heavy', {
      enumerable: true,
      get: heavyGetter,
    });

    render(
      <ToolCallCard
        toolCall={{
          id: 'tool-1',
          name: 'canvas.createNode',
          arguments: args,
          result: { success: true },
          status: 'done',
        }}
        nodeTitlesById={{}}
        t={t}
      />,
    );

    expect(heavyGetter).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /canvas.*create node/i }));

    expect(heavyGetter).toHaveBeenCalled();
  });
});
