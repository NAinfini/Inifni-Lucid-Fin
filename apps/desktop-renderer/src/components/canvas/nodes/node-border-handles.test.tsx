// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  BORDER_HANDLE_OFFSETS,
  NodeBorderHandles,
  createBorderHandleDescriptors,
} from './node-border-handles.js';

vi.mock('@xyflow/react', () => ({
  Handle: ({
    id,
    type,
    position,
    className,
  }: {
    id: string;
    type: string;
    position: string;
    className?: string;
  }) => (
    <div
      data-testid={`handle-${id}`}
      data-handle-type={type}
      data-position={position}
      className={className}
    />
  ),
  Position: {
    Top: 'top',
    Right: 'right',
    Bottom: 'bottom',
    Left: 'left',
  },
}));

describe('node border handles', () => {
  it('creates stable border descriptors for all four sides without using the corner zones', () => {
    const descriptors = createBorderHandleDescriptors();

    expect(BORDER_HANDLE_OFFSETS).toEqual([25, 50, 75]);
    expect(descriptors).toHaveLength(BORDER_HANDLE_OFFSETS.length * 4);
    expect(descriptors.every((descriptor) => descriptor.offsetPercent > 0)).toBe(true);
    expect(descriptors.every((descriptor) => descriptor.offsetPercent < 100)).toBe(true);
    expect(descriptors.some((descriptor) => descriptor.id.startsWith('top-'))).toBe(true);
    expect(descriptors.some((descriptor) => descriptor.id.startsWith('right-'))).toBe(true);
    expect(descriptors.some((descriptor) => descriptor.id.startsWith('bottom-'))).toBe(true);
    expect(descriptors.some((descriptor) => descriptor.id.startsWith('left-'))).toBe(true);
  });

  it('renders dense invisible handles around the node border', () => {
    render(<NodeBorderHandles colorClassName="!bg-blue-500" />);

    // Source handles use bare IDs, target handles use tgt- prefixed IDs
    expect(screen.getByTestId(`handle-top-${BORDER_HANDLE_OFFSETS[0]}`)).toBeTruthy();
    expect(screen.getByTestId(`handle-tgt-top-${BORDER_HANDLE_OFFSETS[0]}`)).toBeTruthy();
    expect(screen.getByTestId(`handle-right-${BORDER_HANDLE_OFFSETS[1]}`)).toBeTruthy();
    expect(screen.getByTestId(`handle-tgt-right-${BORDER_HANDLE_OFFSETS[1]}`)).toBeTruthy();
    expect(screen.getByTestId(`handle-bottom-${BORDER_HANDLE_OFFSETS[2]}`)).toBeTruthy();
    expect(screen.getByTestId(`handle-tgt-bottom-${BORDER_HANDLE_OFFSETS[2]}`)).toBeTruthy();
    expect(screen.getByTestId(`handle-left-${BORDER_HANDLE_OFFSETS[0]}`)).toBeTruthy();
    expect(screen.getByTestId(`handle-tgt-left-${BORDER_HANDLE_OFFSETS[0]}`)).toBeTruthy();
  });
});
