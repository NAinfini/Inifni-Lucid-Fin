// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import { SortableKeyframe } from './SortableKeyframe.js';

describe('SortableKeyframe', () => {
  it('renders children and drag handle', () => {
    render(
      <DndContext>
        <SortableContext items={['test-1']}>
          <SortableKeyframe id="test-1">
            <span>Keyframe Content</span>
          </SortableKeyframe>
        </SortableContext>
      </DndContext>,
    );
    expect(screen.getByText('Keyframe Content')).toBeTruthy();
    expect(screen.getByLabelText('Drag to reorder')).toBeTruthy();
  });
});
