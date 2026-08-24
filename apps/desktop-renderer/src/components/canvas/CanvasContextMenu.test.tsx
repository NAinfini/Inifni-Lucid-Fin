// @vitest-environment jsdom

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CanvasContextMenu } from './CanvasContextMenu.js';

function CustomTrigger() {
  return <div data-testid="custom-trigger" />;
}

describe('CanvasContextMenu', () => {
  afterEach(() => {
    cleanup();
  });

  it('accepts a native DOM element trigger', () => {
    render(
      <CanvasContextMenu onAddNode={() => {}} hasClipboard={false}>
        <div data-testid="canvas-trigger" />
      </CanvasContextMenu>,
    );

    expect(screen.getByTestId('canvas-trigger')).toBeTruthy();
  });

  it('does not expose an upload action without an implementation', async () => {
    render(
      <CanvasContextMenu onAddNode={() => {}} hasClipboard={false}>
        <div data-testid="canvas-trigger" />
      </CanvasContextMenu>,
    );

    fireEvent.contextMenu(screen.getByTestId('canvas-trigger'));
    await screen.findByText('Add Text Node');

    expect(screen.queryByText('Upload Media')).toBeNull();
  });

  it('rejects non-native trigger components before Radix can enter a ref loop', () => {
    expect(() =>
      render(
        <CanvasContextMenu onAddNode={() => {}} hasClipboard={false}>
          <CustomTrigger />
        </CanvasContextMenu>,
      ),
    ).toThrow(/single native DOM element child/i);
  });
});
