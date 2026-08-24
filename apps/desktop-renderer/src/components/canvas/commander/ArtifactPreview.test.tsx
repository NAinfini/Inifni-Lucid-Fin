// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArtifactPreview } from './ArtifactPreview.js';

describe('ArtifactPreview', () => {
  it('renders canonical public artifacts and opens canvas nodes', () => {
    const onNodeClick = vi.fn();
    render(
      <ArtifactPreview
        artifacts={[
          { kind: 'canvas_node', id: 'n1', label: 'My Node' },
          { kind: 'asset', id: 'a1', label: 'Preview image' },
        ]}
        onNodeClick={onNodeClick}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'My Node' }));
    expect(onNodeClick).toHaveBeenCalledWith('n1');
    expect(screen.getByText('Preview image')).toBeTruthy();
  });
});
