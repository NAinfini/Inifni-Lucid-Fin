// @vitest-environment jsdom

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Node, NodeProps } from '@xyflow/react';
import { ImageNode, type ImageNodeFlowData } from './ImageNode.js';
import { VideoNode, type VideoNodeFlowData } from './VideoNode.js';
import { AudioNode, type AudioNodeFlowData } from './AudioNode.js';
import { TextNode, type TextNodeFlowData } from './TextNode.js';

const resizeControlSpy = vi.fn();

afterEach(() => {
  cleanup();
  resizeControlSpy.mockClear();
});

vi.mock('@xyflow/react', () => ({
  Handle: ({
    id,
    position,
  }: {
    id: string;
    position: string;
  }) => <div data-testid={`handle-${position}-${id}`} />,
  NodeResizeControl: (props: {
    position?: string;
    keepAspectRatio?: boolean;
    minWidth?: number;
    minHeight?: number;
    className?: string;
  }) => {
    resizeControlSpy(props);
    return (
      <div
        data-testid="node-resize-control"
        data-position={props.position}
        data-keep-aspect-ratio={String(props.keepAspectRatio)}
        data-min-width={props.minWidth}
        data-min-height={props.minHeight}
        data-class-name={props.className}
      />
    );
  },
  Position: {
    Top: 'top',
    Right: 'right',
    Bottom: 'bottom',
    Left: 'left',
  },
}));

vi.mock('../CanvasNodeTooltip.js', () => ({
  CanvasNodeTooltip: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="canvas-node-tooltip">{children}</div>
  ),
}));

vi.mock('../NodeContextMenu.js', () => ({
  NodeContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../NodeStatusBadge.js', () => ({
  NodeStatusBadge: () => <div data-testid="node-status-badge" />,
}));

vi.mock('../../audio/WaveformPlayer.js', () => ({
  WaveformPlayer: () => <div data-testid="waveform-player" />,
}));

vi.mock('../../../hooks/useAssetUrl.js', () => ({
  useAssetUrl: (hash?: string) => ({
    url: hash ? `file://${hash}` : undefined,
  }),
}));

vi.mock('../../ui/Dialog.js', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div data-testid="dialog-content">{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function makeBaseProps<TData extends object>(
  type: string,
  data: TData,
): NodeProps<Node<TData & Record<string, unknown>, string>> {
  return {
    id: `${type}-node-1`,
    type,
    data: data as TData & Record<string, unknown>,
    width: 240,
    height: 180,
    sourcePosition: undefined,
    targetPosition: undefined,
    dragHandle: undefined,
    parentId: undefined,
    dragging: false,
    zIndex: 1,
    selectable: true,
    deletable: true,
    selected: false,
    draggable: true,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
  };
}

describe('media node layout', () => {
  it('does not render hover tooltip wrappers for content nodes', () => {
    const imageData: ImageNodeFlowData = {
      nodeId: 'image-1',
      title: 'Image',
      status: 'idle',
      bypassed: false,
      locked: false,
      generationStatus: 'done',
      assetHash: 'image-hash',
      variants: ['image-hash'],
      selectedVariantIndex: 0,
      seedLocked: false,
    };
    const videoData: VideoNodeFlowData = {
      nodeId: 'video-1',
      title: 'Video',
      status: 'idle',
      bypassed: false,
      locked: false,
      generationStatus: 'done',
      assetHash: 'video-hash',
      variants: ['video-hash'],
      selectedVariantIndex: 0,
      seedLocked: false,
    };
    const audioData: AudioNodeFlowData = {
      nodeId: 'audio-1',
      title: 'Audio',
      status: 'idle',
      bypassed: false,
      locked: false,
      audioType: 'voice',
      generationStatus: 'done',
      assetHash: 'audio-hash',
      variants: ['audio-hash'],
      selectedVariantIndex: 0,
      seedLocked: false,
    };
    const textData: TextNodeFlowData = {
      nodeId: 'text-1',
      title: 'Text',
      content: 'Test content',
      status: 'idle',
      bypassed: false,
      locked: false,
    };

    render(
      <>
        <ImageNode {...makeBaseProps('image', imageData)} />
        <VideoNode {...makeBaseProps('video', videoData)} />
        <AudioNode {...makeBaseProps('audio', audioData)} />
        <TextNode {...makeBaseProps('text', textData)} />
      </>,
    );

    expect(screen.queryAllByTestId('canvas-node-tooltip')).toHaveLength(0);
  });

  it('renders image content inside a dedicated viewport with contain styling', () => {
    const data: ImageNodeFlowData = {
      nodeId: 'image-1',
      title: 'Image',
      status: 'idle',
      bypassed: false,
      locked: false,
      generationStatus: 'done',
      assetHash: 'image-hash',
      variants: ['image-hash'],
      selectedVariantIndex: 0,
      seedLocked: false,
    };

    render(<ImageNode {...makeBaseProps('image', data)} />);

    expect(screen.getByTestId('image-media-viewport')).toBeTruthy();
    expect(screen.getByRole('img').className).toContain('object-contain');
  });

  it('renders video content without a forced aspect-video wrapper', () => {
    const data: VideoNodeFlowData = {
      nodeId: 'video-1',
      title: 'Video',
      status: 'idle',
      bypassed: false,
      locked: false,
      generationStatus: 'done',
      assetHash: 'video-hash',
      variants: ['video-hash'],
      selectedVariantIndex: 0,
      seedLocked: false,
    };

    render(<VideoNode {...makeBaseProps('video', data)} />);

    const viewport = screen.getByTestId('video-media-viewport');
    expect(viewport.className).not.toContain('aspect-video');
    expect(screen.getByTestId('video-media-element').className).toContain('object-contain');
  });

  it('renders uploaded first and last frame previews on video nodes', () => {
    const data: VideoNodeFlowData = {
      nodeId: 'video-1',
      title: 'Video',
      status: 'idle',
      bypassed: false,
      locked: false,
      generationStatus: 'done',
      assetHash: 'video-hash',
      variants: ['video-hash'],
      selectedVariantIndex: 0,
      seedLocked: false,
      firstFrameHash: 'first-frame-hash',
      lastFrameHash: 'last-frame-hash',
    };

    render(<VideoNode {...makeBaseProps('video', data)} />);

    expect(screen.getByAltText('First')).toBeTruthy();
    expect(screen.getByAltText('Last')).toBeTruthy();
  });

  it('renders selected nodes with corner resize controls that allow freeform resizing', () => {
    const imageData: ImageNodeFlowData = {
      nodeId: 'image-1',
      title: 'Image',
      status: 'idle',
      bypassed: false,
      locked: false,
      generationStatus: 'done',
      assetHash: 'image-hash',
      variants: ['image-hash'],
      selectedVariantIndex: 0,
      seedLocked: false,
    };
    const textData: TextNodeFlowData = {
      nodeId: 'text-1',
      title: 'Text',
      content: 'Test content',
      status: 'idle',
      bypassed: false,
      locked: false,
    };

    render(
      <>
        <ImageNode {...{ ...makeBaseProps('image', imageData), selected: true }} />
        <TextNode {...{ ...makeBaseProps('text', textData), selected: true }} />
      </>,
    );

    const controls = screen.getAllByTestId('node-resize-control');
    expect(controls).toHaveLength(8);
    expect(controls.map((control) => control.getAttribute('data-position'))).toEqual([
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
      'top-left',
      'top-right',
      'bottom-left',
      'bottom-right',
    ]);

    for (const control of controls) {
      expect(control.getAttribute('data-keep-aspect-ratio')).toBe('false');
    }

    expect(resizeControlSpy).not.toHaveBeenCalledWith(expect.objectContaining({ position: 'top' }));
    expect(resizeControlSpy).not.toHaveBeenCalledWith(expect.objectContaining({ position: 'right' }));
    expect(resizeControlSpy).not.toHaveBeenCalledWith(expect.objectContaining({ position: 'bottom' }));
    expect(resizeControlSpy).not.toHaveBeenCalledWith(expect.objectContaining({ position: 'left' }));
  });
});
