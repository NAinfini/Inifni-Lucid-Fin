// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { VirtuosoGridMockContext } from 'react-virtuoso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EntityFileExplorer } from './EntityFileExplorer.js';

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
  ({
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

const gridMetrics = {
  viewportHeight: 300,
  viewportWidth: 300,
  itemHeight: 100,
  itemWidth: 100,
};

const renderExplorer = (items: Array<{ id: string; name: string }>) =>
  render(
    <VirtuosoGridMockContext.Provider value={gridMetrics}>
      <EntityFileExplorer
        items={items}
        folders={[]}
        currentFolderId={null}
        onNavigateFolder={vi.fn()}
        onCreateFolder={vi.fn()}
        onRenameFolder={vi.fn()}
        onDeleteFolder={vi.fn()}
        onMoveItemsToFolder={vi.fn()}
        onCreateItem={vi.fn()}
        onOpenItem={vi.fn()}
        onDeleteItems={vi.fn()}
        renderThumbnail={() => null}
        newItemLabel="New"
        emptyLabel="Empty"
      />
    </VirtuosoGridMockContext.Provider>,
  );

describe('EntityFileExplorer', () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        frames.push(callback);
        return frames.length;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mounts a small virtual window for 10k entries and updates it on scroll', async () => {
    const { container } = renderExplorer(
      Array.from({ length: 10_000 }, (_, index) => ({
        id: `item-${index}`,
        name: `Item ${String(index).padStart(5, '0')}`,
      })),
    );

    await waitFor(() => {
      expect(container.querySelectorAll('[data-tile-id]').length).toBeGreaterThan(0);
    });

    const scroller = container.querySelector<HTMLElement>('.overflow-y-auto');
    const initialTileCount = container.querySelectorAll('[data-tile-id]').length;
    expect(scroller).not.toBeNull();
    expect(initialTileCount).toBeLessThan(100);
    expect(container.querySelector('[data-tile-id="item-0"]')).not.toBeNull();

    act(() => {
      scroller!.scrollTop = 5_000;
      fireEvent.scroll(scroller!);
    });

    await waitFor(() => {
      expect(container.querySelector('[data-tile-id="item-0"]')).toBeNull();
    });
    expect(
      [...container.querySelectorAll<HTMLElement>('[data-tile-id]')].some((tile) => {
        const id = tile.dataset.tileId;
        return id !== undefined && Number(id.replace('item-', '')) > 0;
      }),
    ).toBe(true);
  });

  it('coalesces pointer movement to one selection pass per animation frame', async () => {
    const { container } = renderExplorer([
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ]);

    await waitFor(() => {
      expect(container.querySelector<HTMLElement>('[data-tile-id="a"]')).not.toBeNull();
    });

    const scroller = container.querySelector<HTMLElement>('.overflow-y-auto');
    const first = container.querySelector<HTMLElement>('[data-tile-id="a"]');
    const second = container.querySelector<HTMLElement>('[data-tile-id="b"]');
    expect(scroller).not.toBeNull();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    vi.spyOn(scroller!, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 300, 300));
    vi.spyOn(first!, 'getBoundingClientRect').mockReturnValue(rect(10, 10, 40, 40));
    vi.spyOn(second!, 'getBoundingClientRect').mockReturnValue(rect(100, 100, 40, 40));
    frames = [];
    vi.mocked(requestAnimationFrame).mockClear();

    fireEvent.mouseDown(scroller!, { button: 0, clientX: 0, clientY: 0 });
    for (let index = 0; index < 20; index += 1) {
      fireEvent.mouseMove(document, { clientX: 200 + index, clientY: 200 + index });
    }

    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
    act(() => frames.shift()?.(0));
    expect(first!.className).toContain('bg-primary/15');
    expect(second!.className).toContain('bg-primary/15');
    fireEvent.mouseUp(document);
  });

  it('removes marquee handlers and cancels pending frames on mouseup and unmount', async () => {
    const addListener = vi.spyOn(document, 'addEventListener');
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const { container, unmount } = renderExplorer([{ id: 'a', name: 'A' }]);

    await waitFor(() => {
      expect(container.querySelector<HTMLElement>('[data-tile-id="a"]')).not.toBeNull();
    });

    const scroller = container.querySelector<HTMLElement>('.overflow-y-auto');
    const tile = container.querySelector<HTMLElement>('[data-tile-id="a"]');
    expect(scroller).not.toBeNull();
    expect(tile).not.toBeNull();
    vi.spyOn(scroller!, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 300, 300));
    vi.spyOn(tile!, 'getBoundingClientRect').mockReturnValue(rect(10, 10, 40, 40));
    frames = [];
    vi.mocked(requestAnimationFrame).mockClear();
    vi.mocked(cancelAnimationFrame).mockClear();
    addListener.mockClear();
    removeListener.mockClear();

    fireEvent.mouseDown(scroller!, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(document, { clientX: 100, clientY: 100 });
    expect(addListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1);

    fireEvent.mouseUp(document);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(removeListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('mouseup', expect.any(Function));

    frames = [];
    vi.mocked(requestAnimationFrame).mockClear();
    vi.mocked(cancelAnimationFrame).mockClear();
    removeListener.mockClear();
    fireEvent.mouseDown(scroller!, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.mouseMove(document, { clientX: 100, clientY: 100 });
    unmount();

    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(removeListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeListener).toHaveBeenCalledWith('mouseup', expect.any(Function));
  });
});
