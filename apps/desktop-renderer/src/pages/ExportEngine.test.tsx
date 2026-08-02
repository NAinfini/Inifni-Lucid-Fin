// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { ExportEngine } from './ExportEngine.js';
import { getAPI } from '../utils/api.js';

vi.mock('../utils/api.js', () => ({ getAPI: vi.fn(() => null) }));

function createStore() {
  return configureStore({
    reducer: {
      project: (s = { title: 'Test Project' }) => s,
      canvas: (
        s = {
          activeCanvasId: 'canvas-1',
          canvases: {
            ids: ['canvas-1'],
            entities: {
              'canvas-1': {
                id: 'canvas-1',
                name: 'Test Canvas',
                nodes: [],
                edges: [],
                createdAt: 1,
                updatedAt: 1,
              },
            },
          },
        },
      ) => s,
    },
  });
}

describe('ExportEngine', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders export page with render tab', () => {
    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <ExportEngine />
        </MemoryRouter>
      </Provider>,
    );
    expect(screen.getByText(/导出引擎|Export Engine/)).toBeTruthy();
  });

  it('renders format options', () => {
    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <ExportEngine />
        </MemoryRouter>
      </Provider>,
    );
    expect(screen.getByText('H.264 (MP4)')).toBeTruthy();
  });

  it('renders fps options', () => {
    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <ExportEngine />
        </MemoryRouter>
      </Provider>,
    );
    expect(screen.getByText('30fps')).toBeTruthy();
  });

  it('does not offer AAF in NLE export formats', () => {
    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <ExportEngine />
        </MemoryRouter>
      </Provider>,
    );
    fireEvent.click(screen.getByText(/NLE导出|NLE Export/));
    expect(screen.queryByText(/AAF/i)).toBeNull();
  });

  it('passes selected fps to render.start', async () => {
    const start = vi.fn().mockResolvedValue({ outputPath: '', duration: 0, format: 'mp4' });

    vi.mocked(getAPI).mockReturnValue({
      render: { start, status: vi.fn(), cancel: vi.fn() },
      export: { nle: vi.fn(), assetBundle: vi.fn(), subtitles: vi.fn() },
      workflow: { list: vi.fn(async () => []), getFinalExport: vi.fn() },
    } as unknown as ReturnType<typeof getAPI>);

    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <ExportEngine />
        </MemoryRouter>
      </Provider>,
    );

    fireEvent.click(screen.getByText('60fps'));
    fireEvent.click(screen.getByText(/开始渲染|Start Render/));

    await waitFor(() => {
      expect(start).toHaveBeenCalledWith(
        expect.objectContaining({ sceneId: 'canvas-1', codec: 'h264', fps: 60 }),
      );
    });
  });

  it('renders a persistent workflow only from its exact approved manifest', async () => {
    const start = vi.fn().mockResolvedValue({ outputPath: '', duration: 5, format: 'mp4' });
    const manifestHash = 'a'.repeat(64);
    vi.mocked(getAPI).mockReturnValue({
      render: { start, status: vi.fn(), cancel: vi.fn() },
      export: { nle: vi.fn(), assetBundle: vi.fn(), subtitles: vi.fn() },
      workflow: {
        list: vi.fn(async () => [
          {
            id: 'run-1',
            workflowType: 'movie.production.v2',
            entityType: 'canvas',
            entityId: 'canvas-1',
            status: 'ready',
          },
        ]),
        getFinalExport: vi.fn(async () => ({
          approval: { status: 'approved' },
          manifest: { revision: 3, contentHash: manifestHash },
        })),
      },
    } as unknown as ReturnType<typeof getAPI>);

    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <ExportEngine />
        </MemoryRouter>
      </Provider>,
    );
    fireEvent.click(screen.getByText(/开始渲染|Start Render/));

    await waitFor(() => {
      expect(start).toHaveBeenCalledWith({
        sceneId: 'canvas-1',
        workflowRunId: 'run-1',
        expectedManifestRevision: 3,
        expectedManifestHash: manifestHash,
      });
    });
  });

  it('does not bypass a pending persistent Final Export approval', async () => {
    const start = vi.fn();
    vi.mocked(getAPI).mockReturnValue({
      render: { start, status: vi.fn(), cancel: vi.fn() },
      export: { nle: vi.fn(), assetBundle: vi.fn(), subtitles: vi.fn() },
      workflow: {
        list: vi.fn(async () => [
          {
            id: 'run-1',
            workflowType: 'movie.production.v2',
            entityType: 'canvas',
            entityId: 'canvas-1',
            status: 'awaiting_approval',
          },
        ]),
        getFinalExport: vi.fn(async () => ({
          approval: { status: 'pending' },
          manifest: { revision: 1, contentHash: 'b'.repeat(64) },
        })),
      },
    } as unknown as ReturnType<typeof getAPI>);

    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <ExportEngine />
        </MemoryRouter>
      </Provider>,
    );
    fireEvent.click(screen.getByText(/开始渲染|Start Render/));

    await waitFor(() => expect(start).not.toHaveBeenCalled());
  });
});
