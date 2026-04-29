// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CanvasNodeTooltip } from './CanvasNodeTooltip.js';

function CustomTrigger() {
  return <button type="button">Wrapped</button>;
}

describe('CanvasNodeTooltip', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders a native DOM element trigger with Radix state attributes', () => {
    render(
      <CanvasNodeTooltip title="Node info" items={[{ label: 'Status', value: 'Ready' }]}>
        <button type="button">Open</button>
      </CanvasNodeTooltip>,
    );

    expect(screen.getByRole('button', { name: 'Open' }).getAttribute('data-state')).toBe('closed');
  });

  it('rejects non-native trigger components before Radix can enter a ref loop', () => {
    expect(() =>
      render(
        <CanvasNodeTooltip title="Node info" items={[{ label: 'Status', value: 'Ready' }]}>
          <CustomTrigger />
        </CanvasNodeTooltip>,
      ),
    ).toThrow(/single native DOM element child/i);
  });
});
