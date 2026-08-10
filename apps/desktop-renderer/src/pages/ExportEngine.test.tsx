// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
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

function managedFinalExportContext(input: {
  status: 'failed' | 'cancelled' | 'recovery_required';
  attempt: number;
  maxRenderAttempts?: number;
  error?: string;
}) {
  const manifestHash = 'c'.repeat(64);
  return {
    run: { id: 'run-1' },
    approval: { status: 'approved' },
    manifest: {
      revision: 3,
      contentHash: manifestHash,
      content: { maxRenderAttempts: input.maxRenderAttempts ?? 2 },
    },
    execution: {
      id: 'execution-1',
      workflowRunId: 'run-1',
      manifestRevision: 3,
      manifestHash,
      idempotencyKey: 'd'.repeat(64),
      status: input.status,
      rowVersion: 4,
      destinationPath: 'C:/renders/final.mp4',
      attempt: input.attempt,
      error: input.error,
      createdAt: 1,
      updatedAt: 2,
    },
  };
}

describe('ExportEngine', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
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

  it('polls the render job and reaches 100% only after the renderer reports completion', async () => {
    vi.useFakeTimers();
    const start = vi.fn().mockResolvedValue({
      jobId: 'render-job-1',
      outputPath: 'C:/renders/final.mp4',
      duration: 5,
      format: 'mp4',
    });
    const status = vi
      .fn()
      .mockResolvedValueOnce({ progress: 12, stage: 'queued' })
      .mockResolvedValueOnce({ progress: 72, stage: 'rendering' })
      .mockResolvedValueOnce({ progress: 100, stage: 'completed' });

    vi.mocked(getAPI).mockReturnValue({
      render: { start, status, cancel: vi.fn() },
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

    fireEvent.click(screen.getByText(/开始渲染|Start Render/));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(status).toHaveBeenCalledWith('render-job-1');
    expect(screen.getByText('12%')).toBeTruthy();
    expect(screen.queryByText('100%')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText('72%')).toBeTruthy();
    expect(screen.queryByText('100%')).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText('100%')).toBeTruthy();
  });

  it('cancels the saved render job and stops status polling', async () => {
    vi.useFakeTimers();
    const start = vi.fn().mockResolvedValue({
      jobId: 'render-job-cancel',
      outputPath: 'C:/renders/final.mp4',
      duration: 5,
      format: 'mp4',
    });
    const status = vi.fn().mockResolvedValue({ progress: 30, stage: 'rendering' });
    const cancel = vi.fn().mockResolvedValue(undefined);

    vi.mocked(getAPI).mockReturnValue({
      render: { start, status, cancel },
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

    fireEvent.click(screen.getByText(/开始渲染|Start Render/));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByText(/取消渲染|Cancel Render/));
    await act(async () => {
      await Promise.resolve();
    });

    expect(cancel).toHaveBeenCalledWith('render-job-cancel');
    const statusCallsBeforeAdvance = status.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(status).toHaveBeenCalledTimes(statusCallsBeforeAdvance);
  });

  it('shows the renderer error instead of treating a failed job as complete', async () => {
    vi.useFakeTimers();
    const start = vi.fn().mockResolvedValue({
      jobId: 'render-job-failed',
      outputPath: 'C:/renders/final.mp4',
      duration: 5,
      format: 'mp4',
    });
    const status = vi.fn().mockResolvedValue({
      progress: 68,
      stage: 'failed',
      error: 'FFmpeg exited with code 1',
    });

    vi.mocked(getAPI).mockReturnValue({
      render: { start, status, cancel: vi.fn() },
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

    fireEvent.click(screen.getByText(/开始渲染|Start Render/));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('alert').textContent).toContain('FFmpeg exited with code 1');
    expect(screen.getByText('68%')).toBeTruthy();
    expect(screen.queryByText('100%')).toBeNull();
  });

  it.each(['failed', 'cancelled', 'recovery_required'] as const)(
    'restores a matching %s Final Export as a bounded retry instead of a completed render',
    async (status) => {
      vi.useFakeTimers();
      const context = managedFinalExportContext({
        status,
        attempt: 1,
        error:
          status === 'recovery_required' ? 'Renderer stopped while the app was closed' : undefined,
      });
      const statusRequest = vi.fn();

      vi.mocked(getAPI).mockReturnValue({
        render: { start: vi.fn(), status: statusRequest, cancel: vi.fn() },
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
          getFinalExport: vi.fn(async () => context),
        },
      } as unknown as ReturnType<typeof getAPI>);

      render(
        <Provider store={createStore()}>
          <MemoryRouter>
            <ExportEngine />
          </MemoryRouter>
        </Provider>,
      );

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByRole('button', { name: /重试最终导出|Retry Final Export/ })).toBeTruthy();
      expect(screen.queryByText('100%')).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(statusRequest).not.toHaveBeenCalled();
    },
  );

  it('retries a recovered Final Export with its exact approved manifest and retry flag', async () => {
    const recovery = managedFinalExportContext({
      status: 'recovery_required',
      attempt: 1,
      error: 'Renderer stopped while the app was closed',
    });
    const queuedRetry = {
      ...recovery,
      execution: {
        ...recovery.execution,
        status: 'queued' as const,
        attempt: 2,
        error: undefined,
      },
    };
    const start = vi.fn().mockResolvedValue({
      jobId: 'execution-1',
      outputPath: 'C:/renders/final.mp4',
      duration: 5,
      format: 'mp4',
    });
    const getFinalExport = vi
      .fn()
      .mockResolvedValueOnce(recovery)
      .mockResolvedValueOnce(recovery)
      .mockResolvedValueOnce(queuedRetry);

    vi.mocked(getAPI).mockReturnValue({
      render: {
        start,
        status: vi.fn().mockResolvedValue({ progress: 0, stage: 'queued' }),
        cancel: vi.fn(),
      },
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
        getFinalExport,
      },
    } as unknown as ReturnType<typeof getAPI>);

    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <ExportEngine />
        </MemoryRouter>
      </Provider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /重试最终导出|Retry Final Export/ })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole('button', { name: /重试最终导出|Retry Final Export/ }));

    await waitFor(() => {
      expect(start).toHaveBeenCalledWith({
        sceneId: 'canvas-1',
        workflowRunId: 'run-1',
        expectedManifestRevision: 3,
        expectedManifestHash: 'c'.repeat(64),
        retry: true,
      });
    });
  });

  it('keeps the Final Export retry action disabled once its approved retry budget is exhausted', async () => {
    const context = managedFinalExportContext({
      status: 'failed',
      attempt: 2,
      maxRenderAttempts: 2,
      error: 'FFmpeg exited with code 1',
    });

    vi.mocked(getAPI).mockReturnValue({
      render: { start: vi.fn(), status: vi.fn(), cancel: vi.fn() },
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
        getFinalExport: vi.fn(async () => context),
      },
    } as unknown as ReturnType<typeof getAPI>);

    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <ExportEngine />
        </MemoryRouter>
      </Provider>,
    );

    await waitFor(() => {
      expect(
        screen
          .getByRole('button', { name: /重试次数已用尽|retry limit reached/i })
          .getAttribute('disabled'),
      ).not.toBeNull();
    });
  });
});
