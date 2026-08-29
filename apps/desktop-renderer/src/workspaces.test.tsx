// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { PublicRunEvent, Run } from '@lucid-fin/contracts';
import { App } from './App.js';
import type { WireResult } from './api.js';
import {
  createDesktopApiFixture,
  chatFixture,
  exportGrantFixture,
  historyFixture,
  mediaFixture,
  messagesFixture,
  projectFixture,
  resultFixture,
  runEventsFixture,
  runFixture,
} from './test-fixture.js';

afterEach(cleanup);

function appendRunEvent(
  fixture: ReturnType<typeof createDesktopApiFixture>,
  event: PublicRunEvent,
) {
  for (const listener of fixture.listeners) {
    listener({
      wireVersion: 1,
      kind: 'push',
      method: 'run.events.appended',
      payload: {
        cursor: { sequence: event.sequence, eventHash: event.eventHash },
        event,
      },
    });
  }
}

const deliveryPlan = {
  authority: 'delivery' as const,
  id: 'delivery.blue-hour',
  projectId: 'project.blue-hour',
  revision: 4,
  contentHash: 'a'.repeat(64),
  name: 'Blue Hour Review',
  lifecycle: 'active' as const,
  formatIntent: {
    container: 'mp4' as const,
    videoCodec: 'h264' as const,
    audioCodec: 'aac' as const,
    width: 1920,
    height: 1080,
    frameRate: 24,
    quality: 'review' as const,
  },
  items: [],
  currentChoices: [],
  protections: [],
  createdAt: '2026-08-24T16:00:00.000Z',
  updatedAt: '2026-08-24T16:00:00.000Z',
};

const deliveryManifest = {
  authority: 'delivery_manifest' as const,
  id: 'delivery.manifest.blue-hour',
  projectId: deliveryPlan.projectId,
  revision: 0 as const,
  contentHash: 'b'.repeat(64),
  sourcePlan: {
    authority: deliveryPlan.authority,
    id: deliveryPlan.id,
    revision: deliveryPlan.revision,
    contentHash: deliveryPlan.contentHash,
  },
  formatIntent: deliveryPlan.formatIntent,
  items: [],
  currentChoices: [],
  protections: [],
  createdBy: { kind: 'run' as const, runId: 'run.opening-direction' },
  frozenAt: '2026-08-24T16:10:00.000Z',
};

const reviewOperationRef = {
  id: 'operation.review.blue-hour',
  revision: 1,
  kind: 'review_cut_attempt' as const,
  ownerRef: {
    authority: 'review_cut_attempt' as const,
    id: 'review.blue-hour',
    revision: 1,
    contentHash: 'c'.repeat(64),
  },
};
const exportOperationRef = {
  id: 'operation.export.blue-hour',
  revision: 1,
  kind: 'delivery_export' as const,
  ownerRef: {
    authority: 'delivery_export' as const,
    id: 'export.blue-hour',
    revision: 1,
    contentHash: 'd'.repeat(64),
  },
};

function deliveryOperationViews(reviewCancelled = false) {
  const reviewRef = reviewCancelled
    ? {
        ...reviewOperationRef,
        revision: 2,
        ownerRef: { ...reviewOperationRef.ownerRef, revision: 2, contentHash: 'e'.repeat(64) },
      }
    : reviewOperationRef;
  return [
    {
      ref: reviewRef,
      state: 'running' as const,
      cancelRequested: reviewCancelled,
      progressPercent: 42,
      usage: {
        inputTokens: { state: 'known' as const, value: 0 },
        outputTokens: { state: 'known' as const, value: 0 },
        generatedUnits: { state: 'known' as const, value: 1 },
        cost: { state: 'known' as const, value: '0', currency: 'USD' as const },
      },
      publicErrorCode: null,
      resultRefs: [],
      artifacts: [
        {
          kind: 'review_cut' as const,
          id: 'artifact.review.blue-hour',
          contentHash: 'f'.repeat(64),
          mimeType: 'video/mp4',
          width: null,
          height: null,
          durationMs: 8_000,
        },
      ],
    },
    {
      ref: exportOperationRef,
      state: 'failed' as const,
      cancelRequested: false,
      progressPercent: null,
      usage: null,
      publicErrorCode: 'execution_failed' as const,
      resultRefs: [],
      artifacts: [
        {
          kind: 'delivery_export' as const,
          id: 'artifact.export.blue-hour',
          contentHash: 'f'.repeat(64),
          mimeType: 'video/mp4',
          width: null,
          height: null,
          durationMs: 8_000,
        },
      ],
    },
  ];
}

function projectDelivery(fixture: ReturnType<typeof createDesktopApiFixture>) {
  let reviewCancelled = false;
  fixture.calls.deliveryQuery.mockImplementation(async (request) => ({
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method: 'delivery.query',
    result: {
      plans: [deliveryPlan],
      manifests: [deliveryManifest],
      operations: [reviewOperationRef, exportOperationRef],
      nextCursor: null,
    },
  }));
  fixture.calls.operationGet.mockImplementation(async (request) => ({
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method: 'operation.get',
    result: {
      operations: deliveryOperationViews(reviewCancelled).filter((view) =>
        request.input.operations.some((operation) => operation.id === view.ref.id),
      ),
    },
  }));
  fixture.calls.operationCancel.mockImplementation(async (request) => {
    reviewCancelled = request.input.operations.some(
      (operation) => operation.ref.id === reviewOperationRef.id,
    );
    return {
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'operation.cancel',
      result: {
        operations: deliveryOperationViews(reviewCancelled).filter((view) =>
          request.input.operations.some((operation) => operation.ref.id === view.ref.id),
        ),
      },
    };
  });
}

function productionView(
  id: string,
  title: string,
): WireResult<'production.query'>['items'][number] {
  return {
    object: {
      authority: 'production',
      id,
      projectId: 'project.blue-hour',
      revision: 1,
      contentHash: 'd'.repeat(64),
      lifecycle: 'active',
      type: 'shot',
      content: {
        title,
        description: `${title} description.`,
        durationMs: 8_000,
        shotSize: 'wide',
        cameraMovement: 'static',
      },
      relations: [],
      protections: [],
      resultDecisions: [],
      createdBy: { kind: 'run', runId: 'run.opening-direction' },
      updatedBy: { kind: 'run', runId: 'run.opening-direction' },
      createdAt: '2026-08-24T16:00:00.000Z',
      updatedAt: '2026-08-24T16:00:00.000Z',
    },
    factSources: [],
    currentChoices: [],
  };
}

function historyEntry(
  resultId: string,
  summary: string,
): WireResult<'history.query'>['items'][number] {
  return { ...historyFixture[0], resultId, summary };
}

describe('Project workspaces', () => {
  it('turns machine history into readable inline details without opening Commander focus', async () => {
    const fixture = createDesktopApiFixture();
    const contentHash = historyFixture[0].contentHash;
    const event = {
      projectId: projectFixture.id,
      occurredAt: historyFixture[0].occurredAt,
      summary: `{"payload":{"contentHash":"${contentHash}","revision":0,"type":"object_created"},"state":"available"}`,
      source: 'project_event',
      eventId: 'event.object-created',
      sequence: 1,
      eventVersion: 1,
      eventType: 'object_created',
      actor: 'commander',
      subject: { authority: 'production', id: 'shot.opening' },
      causation: { kind: 'run', runId: runFixture.id },
      correlationId: 'correlation.object-created',
      payloadHash: contentHash,
      payloadState: {
        state: 'available',
        payload: { type: 'object_created', revision: 0, contentHash },
      },
      previousEventHash: null,
      eventHash: contentHash,
    } satisfies WireResult<'history.query'>['items'][number];
    fixture.calls.historyQuery.mockImplementation(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'history.query',
      result: { items: [event], nextCursor: null },
    }));

    const { container } = render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App
          api={fixture.api}
          createRequestId={() => 'request.ui.readable-history'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    const summary = await screen.findByText('Production object created');
    const change = summary.closest('button');
    expect(change).not.toBeNull();
    expect(screen.queryByText(event.summary)).toBeNull();
    fireEvent.click(change!);
    expect(screen.getByRole('region', { name: 'Change details' })).toBeTruthy();
    expect(container.querySelector('.lucid-focus-shell')).toBeNull();
    fireEvent.click(change!);
    expect(screen.queryByRole('region', { name: 'Change details' })).toBeNull();
  });

  it('queries each authoritative projection and shares one selected object with Commander', async () => {
    const fixture = createDesktopApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.workspace'} locale="en-US" />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Production 2$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /select shot 04/i }));
    expect(await screen.findByRole('button', { name: /remove shot 04/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Canvas 1$/ }));
    await screen.findByText(/spatial workspace/i);
    fireEvent.click(screen.getByRole('button', { name: /^Media 1$/ }));
    await screen.findByText('Harbor reference');
    expect((await screen.findByRole('img', { name: 'Harbor reference' })).getAttribute('src')).toBe(
      'lucid-fin-media://preview/cap_fixture_project_media_ref',
    );
    expect(fixture.calls.mediaPreviewIssue).toHaveBeenCalledWith({
      requestId: 'request.ui.workspace',
      input: {
        projectId: 'project.blue-hour',
        source: {
          kind: 'project_media_ref',
          ref: {
            authority: 'project_media_ref',
            id: 'media.harbor-reference',
            revision: 1,
            contentHash: 'b'.repeat(64),
          },
        },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Delivery 0$/ }));
    await screen.findByText(/delivery is assembled/i);

    expect(fixture.calls.productionQuery).toHaveBeenCalled();
    expect(fixture.calls.canvasGet).toHaveBeenCalled();
    expect(fixture.calls.mediaProjectList).toHaveBeenCalled();
    expect(fixture.calls.deliveryQuery).toHaveBeenCalled();
    expect(fixture.calls.resultQuery).toHaveBeenCalled();
    expect(fixture.calls.historyQuery).toHaveBeenCalled();
  });

  it('surfaces authoritative generated-result decisions directly on Overview', async () => {
    const fixture = createDesktopApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App
          api={fixture.api}
          createRequestId={() => 'request.ui.overview-result'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    const heading = await screen.findByRole('heading', { name: 'Recent generated results' });
    const section = heading.closest('section');
    expect(section).toBeTruthy();
    expect(within(section!).getByText(resultFixture.resultRef.id)).toBeTruthy();
    expect(
      (
        await within(section!).findByLabelText(
          `Shot 04 · Harbor arrival · ${resultFixture.resultRef.id}`,
        )
      ).getAttribute('src'),
    ).toBe('lucid-fin-media://preview/cap_fixture_generated_result');

    fireEvent.click(within(section!).getByRole('button', { name: /^Select$/ }));

    await waitFor(() => expect(fixture.calls.decisionRecord).toHaveBeenCalledTimes(1));
    expect(fixture.calls.decisionRecord.mock.calls[0]?.[0].input).toEqual({
      action: 'select',
      shot: {
        authority: 'production',
        id: 'shot.04',
        revision: 3,
        contentHash: 'b'.repeat(64),
      },
      result: resultFixture.resultRef,
      feedback: '',
    });
  });

  it('reviews generated candidates and undoes a decision from Compare with exact Choice and Shot refs', async () => {
    const fixture = createDesktopApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/media']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.result'} locale="en-US" />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('tab', { name: 'Candidates' }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText(resultFixture.resultRef.id)).toBeTruthy();
    expect(
      (
        await within(panel).findByLabelText(
          `Shot 04 · Harbor arrival · ${resultFixture.resultRef.id}`,
        )
      ).getAttribute('src'),
    ).toBe('lucid-fin-media://preview/cap_fixture_generated_result');
    fireEvent.click(within(panel).getByRole('button', { name: /^Select$/ }));

    await waitFor(() => expect(fixture.calls.decisionRecord).toHaveBeenCalledTimes(1));
    expect(fixture.calls.decisionRecord.mock.calls[0]?.[0].input).toEqual({
      action: 'select',
      shot: {
        authority: 'production',
        id: 'shot.04',
        revision: 3,
        contentHash: 'b'.repeat(64),
      },
      result: resultFixture.resultRef,
      feedback: '',
    });
    expect(await within(panel).findByText('Selected')).toBeTruthy();

    expect(within(panel).getByRole('button', { name: /^Undo$/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Compare' }));
    const compare = screen.getByRole('tabpanel');
    fireEvent.click(within(compare).getByRole('button', { name: /^Undo$/ }));

    await waitFor(() => expect(fixture.calls.decisionRecord).toHaveBeenCalledTimes(2));
    expect(fixture.calls.decisionRecord.mock.calls[1]?.[0].input).toEqual({
      action: 'undo',
      targetChoice: {
        authority: 'user_choice',
        id: 'choice.result.opening.1',
        choiceHash: 'c'.repeat(64),
      },
      currentOwner: {
        authority: 'production',
        id: 'shot.04',
        revision: 4,
        contentHash: 'c'.repeat(64),
      },
    });
    await waitFor(() =>
      expect(within(compare).queryByRole('button', { name: /^Undo$/ })).toBeNull(),
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Candidates' }));
    const candidatesAfterUndo = screen.getByRole('tabpanel');
    fireEvent.click(within(candidatesAfterUndo).getByRole('button', { name: /^Refine$/ }));
    fireEvent.change(
      within(candidatesAfterUndo).getByRole('textbox', { name: 'What should change' }),
      { target: { value: 'Hold the harbor wide for two more seconds.' } },
    );
    fireEvent.click(within(candidatesAfterUndo).getByRole('button', { name: 'Record decision' }));

    await waitFor(() => expect(fixture.calls.decisionRecord).toHaveBeenCalledTimes(3));
    expect(fixture.calls.decisionRecord.mock.calls[2]?.[0].input).toEqual({
      action: 'refine',
      shot: {
        authority: 'production',
        id: 'shot.04',
        revision: 5,
        contentHash: 'c'.repeat(64),
      },
      result: resultFixture.resultRef,
      instruction: 'Hold the harbor wide for two more seconds.',
    });
    expect(await within(candidatesAfterUndo).findByText('Refine requested')).toBeTruthy();
  });

  it('shows media preview failure and retries only after an explicit action', async () => {
    const fixture = createDesktopApiFixture();
    fixture.calls.mediaPreviewIssue.mockRejectedValueOnce(new Error('Preview capability expired.'));
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/media']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.preview'} locale="en-US" />
      </MemoryRouter>,
    );

    expect((await screen.findByRole('alert')).textContent).toContain('Preview capability expired.');
    expect(fixture.calls.mediaPreviewIssue).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect((await screen.findByRole('img', { name: 'Harbor reference' })).getAttribute('src')).toBe(
      'lucid-fin-media://preview/cap_fixture_project_media_ref',
    );
    expect(fixture.calls.mediaPreviewIssue).toHaveBeenCalledTimes(2);
  });

  it('fetches the latest historical Result when it falls beyond the first Result page', async () => {
    const fixture = createDesktopApiFixture();
    const firstPage = [1, 100].map((index) => {
      const ordinal = String(index).padStart(3, '0');
      return {
        ...resultFixture,
        resultRef: { ...resultFixture.resultRef, id: `result.page.${ordinal}` },
        requestId: `request.page.${ordinal}`,
      };
    });
    const latestResult = {
      ...resultFixture,
      resultRef: { ...resultFixture.resultRef, id: 'result.page.101' },
      requestId: 'request.page.101',
      submittedPrompt: 'Latest historical candidate',
    };
    fixture.calls.historyQuery.mockImplementation(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'history.query',
      result: {
        items: [historyEntry(latestResult.resultRef.id, 'Latest generated candidate')],
        nextCursor: null,
      },
    }));
    fixture.calls.resultQuery.mockImplementation(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'result.query',
      result:
        request.input.query.resultIds.length > 0
          ? { items: [latestResult], nextCursor: null }
          : { items: firstPage, nextCursor: 'cursor.results.100' },
    }));

    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.latest-result'} locale="en-US" />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('button', { name: 'Inspect candidate result.page.101' }),
    ).toBeTruthy();
    expect(
      fixture.calls.resultQuery.mock.calls.some(
        ([request]) => request.input.query.resultIds[0] === latestResult.resultRef.id,
      ),
    ).toBe(true);
  });

  it('retains the Result cursor and loads candidates beyond the first 100', async () => {
    const fixture = createDesktopApiFixture();
    const firstPage = [1, 100].map((index) => {
      const ordinal = String(index).padStart(3, '0');
      return {
        ...resultFixture,
        resultRef: { ...resultFixture.resultRef, id: `result.page.${ordinal}` },
        requestId: `request.page.${ordinal}`,
        artifact: null,
        submittedPrompt: `Candidate ${ordinal}`,
      };
    });
    const finalCandidate = {
      ...resultFixture,
      resultRef: { ...resultFixture.resultRef, id: 'result.page.101' },
      requestId: 'request.page.101',
      artifact: null,
      submittedPrompt: 'Candidate 101',
    };
    fixture.calls.resultQuery.mockImplementation(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'result.query',
      result:
        request.input.query.resultIds.length > 0
          ? { items: [resultFixture], nextCursor: null }
          : request.input.query.page.cursor === null
            ? { items: firstPage, nextCursor: 'cursor.results.100' }
            : { items: [finalCandidate], nextCursor: null },
    }));

    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/media']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.pages'} locale="en-US" />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('tab', { name: 'Candidates' }));
    expect(
      await screen.findByRole('button', { name: 'Inspect candidate result.page.100' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more candidates' }));

    await waitFor(() =>
      expect(
        fixture.calls.resultQuery.mock.calls.some(
          ([request]) => request.input.query.page.cursor === 'cursor.results.100',
        ),
      ).toBe(true),
    );
    expect(
      await screen.findByRole('button', { name: 'Inspect candidate result.page.101' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more candidates' })).toBeNull();
  });

  it('loads more Project media with the original cursor, keeps selection, and retries a failed page', async () => {
    const fixture = createDesktopApiFixture();
    const nextMedia = {
      ...mediaFixture,
      id: 'media.second-reference',
      globalAssetId: 'asset.second-reference',
      revision: 2,
      contentHash: 'd'.repeat(64),
      label: 'Second reference',
    };
    let pageAttempts = 0;
    fixture.calls.mediaProjectList.mockImplementation(async (request) => {
      if (request.input.page.cursor === null) {
        return {
          wireVersion: 1,
          kind: 'success',
          requestId: request.requestId,
          method: 'media.project.list',
          result: { items: [mediaFixture], nextCursor: 'cursor.media.page.2' },
        };
      }
      pageAttempts += 1;
      if (pageAttempts === 1) throw new Error('Media page is temporarily unavailable.');
      return {
        wireVersion: 1,
        kind: 'success',
        requestId: request.requestId,
        method: 'media.project.list',
        result: { items: [mediaFixture, nextMedia], nextCursor: null },
      };
    });

    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/media']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.media-pages'} locale="en-US" />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Select Harbor reference' }));
    const pager = screen.getByRole('button', { name: 'Load more media' });
    fireEvent.click(pager);

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Media page is temporarily unavailable.',
    );
    expect(
      (screen.getByRole('button', { name: 'Load more media' }) as HTMLButtonElement).disabled,
    ).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Load more media' }));
    await waitFor(() =>
      expect(
        fixture.calls.mediaProjectList.mock.calls.filter(
          ([request]) => request.input.page.cursor === 'cursor.media.page.2',
        ),
      ).toHaveLength(2),
    );
    expect(await screen.findByRole('button', { name: 'Select Second reference' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Select Harbor reference' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Remove Harbor reference' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more media' })).toBeNull();
  });

  it('loads more Production objects with the original cursor, keeps selection, and retries a failed page', async () => {
    const fixture = createDesktopApiFixture();
    const first = productionView('shot.page.1', 'Paged Shot 01');
    const second = productionView('shot.page.2', 'Paged Shot 02');
    let pageAttempts = 0;
    fixture.calls.productionQuery.mockImplementation(async (request) => {
      if (request.input.page.cursor === null) {
        return {
          wireVersion: 1,
          kind: 'success',
          requestId: request.requestId,
          method: 'production.query',
          result: { items: [first], nextCursor: 'cursor.production.page.2' },
        };
      }
      pageAttempts += 1;
      if (pageAttempts === 1) throw new Error('Production page is temporarily unavailable.');
      return {
        wireVersion: 1,
        kind: 'success',
        requestId: request.requestId,
        method: 'production.query',
        result: { items: [first, second], nextCursor: null },
      };
    });

    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/production']}>
        <App
          api={fixture.api}
          createRequestId={() => 'request.ui.production-pages'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Select Paged Shot 01' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load more Production' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Production page is temporarily unavailable.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load more Production' }));

    await waitFor(() =>
      expect(
        fixture.calls.productionQuery.mock.calls.filter(
          ([request]) => request.input.page.cursor === 'cursor.production.page.2',
        ),
      ).toHaveLength(2),
    );
    expect(await screen.findByRole('button', { name: 'Select Paged Shot 02' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Select Paged Shot 01' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Remove Paged Shot 01' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more Production' })).toBeNull();
  });

  it('reveals every loaded Overview history item and pages History without replacing existing evidence', async () => {
    const fixture = createDesktopApiFixture();
    const firstPage = Array.from({ length: 9 }, (_, index) =>
      historyEntry(`result.history.${index + 1}`, `History entry ${index + 1}`),
    );
    const finalEntry = historyEntry('result.history.10', 'History entry 10');
    let pageAttempts = 0;
    fixture.calls.resultQuery.mockImplementation(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'result.query',
      result: {
        items:
          request.input.query.resultIds.length === 0
            ? [resultFixture]
            : request.input.query.resultIds.map((resultId) => ({
                ...resultFixture,
                resultRef: { ...resultFixture.resultRef, id: resultId },
              })),
        nextCursor: null,
      },
    }));
    fixture.calls.historyQuery.mockImplementation(async (request) => {
      if (request.input.query.page.cursor === null) {
        return {
          wireVersion: 1,
          kind: 'success',
          requestId: request.requestId,
          method: 'history.query',
          result: { items: firstPage, nextCursor: 'cursor.history.page.2' },
        };
      }
      pageAttempts += 1;
      if (pageAttempts === 1) throw new Error('History page is temporarily unavailable.');
      return {
        wireVersion: 1,
        kind: 'success',
        requestId: request.requestId,
        method: 'history.query',
        result: { items: [firstPage[0], finalEntry], nextCursor: null },
      };
    });

    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.history-pages'} locale="en-US" />
      </MemoryRouter>,
    );

    await screen.findByText('History entry 1');
    expect(screen.queryByText('History entry 9')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View all 9 changes' }));
    expect(await screen.findByText('History entry 9')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Load more History' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'History page is temporarily unavailable.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load more History' }));

    await waitFor(() =>
      expect(
        fixture.calls.historyQuery.mock.calls.filter(
          ([request]) => request.input.query.page.cursor === 'cursor.history.page.2',
        ),
      ).toHaveLength(2),
    );
    expect(await screen.findByText('History entry 10')).toBeTruthy();
    expect(screen.getAllByText('History entry 1')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Load more History' })).toBeNull();
  });

  it('loads more Delivery plans with the original cursor, keeps selection, and retries a failed page', async () => {
    const fixture = createDesktopApiFixture();
    const additionalPlan = {
      ...deliveryPlan,
      id: 'delivery.sunrise',
      revision: 1,
      contentHash: 'e'.repeat(64),
      name: 'Sunrise Review',
    };
    let pageAttempts = 0;
    fixture.calls.deliveryQuery.mockImplementation(async (request) => {
      if (request.input.page.cursor === null) {
        return {
          wireVersion: 1,
          kind: 'success',
          requestId: request.requestId,
          method: 'delivery.query',
          result: {
            plans: [deliveryPlan],
            manifests: [],
            operations: [],
            nextCursor: 'cursor.delivery.page.2',
          },
        };
      }
      pageAttempts += 1;
      if (pageAttempts === 1) throw new Error('Delivery page is temporarily unavailable.');
      return {
        wireVersion: 1,
        kind: 'success',
        requestId: request.requestId,
        method: 'delivery.query',
        result: {
          plans: [deliveryPlan, additionalPlan],
          manifests: [],
          operations: [],
          nextCursor: null,
        },
      };
    });

    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/delivery']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.delivery-pages'} locale="en-US" />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /Blue Hour Review.*1920×1080/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Load more Delivery plans' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Delivery page is temporarily unavailable.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Load more Delivery plans' }));

    await waitFor(() =>
      expect(
        fixture.calls.deliveryQuery.mock.calls.filter(
          ([request]) => request.input.page.cursor === 'cursor.delivery.page.2',
        ),
      ).toHaveLength(2),
    );
    expect(await screen.findByText('Sunrise Review')).toBeTruthy();
    expect(screen.getAllByText('Blue Hour Review')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Remove delivery.blue-hour' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Load more Delivery plans' })).toBeNull();
  });

  it('moves a Canvas placement through revision-checked canvas.apply', async () => {
    const fixture = createDesktopApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/canvas']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.canvas'} locale="en-US" />
      </MemoryRouter>,
    );

    const placement = await screen.findByRole('button', { name: /select and move shot 04/i });
    fixture.calls.overviewGet.mockRejectedValueOnce(new Error('refresh unavailable'));
    fireEvent.keyDown(placement, {
      key: 'ArrowRight',
    });

    await waitFor(() => expect(fixture.calls.canvasApply).toHaveBeenCalledTimes(1));
    expect(fixture.calls.canvasApply.mock.calls[0]?.[0].input).toEqual({
      projectId: 'project.blue-hour',
      expectedCanvasRevision: 1,
      command: {
        action: 'move',
        placementId: 'placement.shot-04',
        position: { x: 130, y: 90 },
      },
    });
    const warning = await screen.findByRole('alert');
    expect(warning.textContent).toContain('The authority accepted the change');
    expect(warning.textContent).not.toContain('could not be moved');

    fireEvent.click(within(warning).getByRole('button', { name: 'Retry refresh' }));
    await waitFor(() => expect(screen.queryByText(/The authority accepted the change/)).toBeNull());
  });

  it('routes Review Cut preparation through the existing Commander Run', async () => {
    const fixture = createDesktopApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/delivery']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.delivery'} locale="en-US" />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Prepare Review Cut' }));

    await waitFor(() => expect(fixture.calls.runSendFollowup).toHaveBeenCalledTimes(1));
    expect(fixture.calls.runSendFollowup.mock.calls[0]?.[0].input.text).toMatch(
      /reversible draft Delivery plan.*do not export without explicit confirmation/i,
    );
    expect(fixture.calls.runSendFollowup.mock.calls[0]?.[0].input.selectedContext).toEqual([]);
  });

  it('renders a frozen manifest and binds Review Cut to the exact authoritative Delivery ref', async () => {
    const fixture = createDesktopApiFixture();
    projectDelivery(fixture);
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/delivery']}>
        <App
          api={fixture.api}
          createRequestId={() => 'request.ui.delivery-review'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Frozen manifest.*0 items/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare Review Cut via Commander' }));

    await waitFor(() => expect(fixture.calls.runSendFollowup).toHaveBeenCalledTimes(1));
    const request = fixture.calls.runSendFollowup.mock.calls[0]?.[0].input;
    expect(request?.text).toMatch(
      /Blue Hour Review.*current authoritative plan revision.*missing or invalid item/i,
    );
    expect(request?.selectedContext).toEqual([
      {
        ref: {
          authority: 'delivery',
          id: deliveryPlan.id,
          revision: deliveryPlan.revision,
          contentHash: deliveryPlan.contentHash,
        },
        role: 'selected',
      },
    ]);
  });

  it('loads Delivery operation views, shows public receipts, and cancels with the exact revision', async () => {
    const fixture = createDesktopApiFixture();
    projectDelivery(fixture);
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/delivery']}>
        <App
          api={fixture.api}
          createRequestId={() => 'request.ui.delivery-operation'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    await waitFor(() => expect(fixture.calls.operationGet).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Blue Hour Review')).toBeTruthy();
    const loaded = (await fixture.calls.operationGet.mock.results[0]?.value) as {
      readonly result: {
        readonly operations: readonly { readonly ref: { readonly id: string } }[];
      };
    };
    expect(loaded.result.operations.map((operation) => operation.ref.id)).toEqual([
      reviewOperationRef.id,
      exportOperationRef.id,
    ]);
    expect(await screen.findByText(/Review Cut artifact/)).toBeTruthy();
    expect(screen.getByText(/Export receipt.*export.blue-hour/)).toBeTruthy();
    expect(screen.getByText('execution failed')).toBeTruthy();
    expect(screen.getByText(/Usage.*0 in.*0 out.*1 units.*USD 0/)).toBeTruthy();

    const cancel = screen.getByRole('button', {
      name: 'Cancel Review Cut operation.review.blue-hour',
    });
    fixture.calls.operationCancel.mockRejectedValueOnce(new Error('Cancellation was rejected.'));
    fireEvent.click(cancel);
    await waitFor(() => expect(fixture.calls.operationCancel).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Cancellation was rejected.')).toBeTruthy();
    expect((cancel as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(cancel);
    await waitFor(() => expect(fixture.calls.operationCancel).toHaveBeenCalledTimes(2));
    expect(fixture.calls.operationCancel.mock.calls[1]?.[0].input).toEqual({
      operations: [
        {
          ref: reviewOperationRef,
          expectedRevision: reviewOperationRef.revision,
          expectedState: 'running',
        },
      ],
    });
    expect(await screen.findByText('Cancellation requested')).toBeTruthy();
  });

  it('refreshes Delivery operation views after an operation state push', async () => {
    const fixture = createDesktopApiFixture();
    projectDelivery(fixture);
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/delivery']}>
        <App
          api={fixture.api}
          createRequestId={() => 'request.ui.delivery-operation-push'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    await screen.findByText(/Review Cut artifact/);
    fixture.calls.deliveryQuery.mockClear();
    fixture.calls.operationGet.mockClear();
    appendRunEvent(fixture, {
      ...runEventsFixture[0],
      eventId: 'event.delivery-operation.running',
      sequence: 17,
      payloadState: {
        state: 'available',
        payload: {
          type: 'operation_state_changed',
          operation: reviewOperationRef,
          previousRevision: 0,
          previousState: 'prepared',
          previousCancelRequested: false,
          state: 'running',
          cancelRequested: false,
          publicErrorCode: null,
        },
      },
    });

    await waitFor(() => expect(fixture.calls.deliveryQuery).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fixture.calls.operationGet).toHaveBeenCalledTimes(1));
    expect(fixture.calls.operationGet.mock.calls[0]?.[0].input.operations).toEqual([
      reviewOperationRef,
      exportOperationRef,
    ]);
  });

  it('binds a selected export destination to the active Run follow-up and exact Delivery ref', async () => {
    const fixture = createDesktopApiFixture();
    projectDelivery(fixture);
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/delivery']}>
        <App
          api={fixture.api}
          createRequestId={() => 'request.ui.delivery-export'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Choose destination & export' }));

    await waitFor(() => expect(fixture.calls.exportPick).toHaveBeenCalledTimes(1));
    expect(fixture.calls.exportPick.mock.calls[0]?.[0].input).toEqual({
      chatId: runFixture.chatId,
      projectId: projectFixture.id,
      deliveryPlan: {
        authority: 'delivery',
        id: deliveryPlan.id,
        revision: deliveryPlan.revision,
        contentHash: deliveryPlan.contentHash,
      },
      destination: 'file',
      suggestedFileName: `${deliveryPlan.id}.mp4`,
      allowedExtensions: ['mp4'],
    });
    await waitFor(() => expect(fixture.calls.runSendFollowup).toHaveBeenCalledTimes(1));
    const request = fixture.calls.runSendFollowup.mock.calls[0]?.[0].input;
    expect(request?.text).toMatch(
      /Blue Hour Review.*frozen manifest and destination.*explicit confirmation bound to the immutable input/i,
    );
    expect(request?.selectedContext).toEqual([
      {
        ref: {
          authority: 'delivery',
          id: deliveryPlan.id,
          revision: deliveryPlan.revision,
          contentHash: deliveryPlan.contentHash,
        },
        role: 'selected',
      },
    ]);
    expect(request?.exportDestinationGrant).toEqual(exportGrantFixture);
    expect(request?.text).not.toContain(exportGrantFixture.destination.grantId);
    expect(fixture.calls.messageSend).not.toHaveBeenCalled();
  });

  it('does not enqueue export work when destination selection is cancelled', async () => {
    const fixture = createDesktopApiFixture();
    projectDelivery(fixture);
    fixture.calls.exportPick.mockImplementation(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'os.export.pick',
      result: { state: 'cancelled' },
    }));
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/delivery']}>
        <App
          api={fixture.api}
          createRequestId={() => 'request.ui.delivery-export-cancelled'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    const button = await screen.findByRole('button', { name: 'Choose destination & export' });
    fireEvent.click(button);

    await waitFor(() => expect(fixture.calls.exportPick).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    expect(fixture.calls.runSendFollowup).not.toHaveBeenCalled();
    expect(fixture.calls.messageSend).not.toHaveBeenCalled();
  });

  it('shows destination picker failures without enqueuing export work', async () => {
    const fixture = createDesktopApiFixture();
    projectDelivery(fixture);
    fixture.calls.exportPick.mockRejectedValueOnce(new Error('Export picker is unavailable.'));
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/delivery']}>
        <App
          api={fixture.api}
          createRequestId={() => 'request.ui.delivery-export-error'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Choose destination & export' }));

    await waitFor(() =>
      expect(
        screen
          .getAllByRole('alert')
          .some((alert) => alert.textContent?.includes('Export picker is unavailable.')),
      ).toBe(true),
    );
    expect(fixture.calls.runSendFollowup).not.toHaveBeenCalled();
    expect(fixture.calls.messageSend).not.toHaveBeenCalled();
  });

  it('binds a selected export destination to a new root Run when the prior Run is terminal', async () => {
    const fixture = createDesktopApiFixture();
    projectDelivery(fixture);
    const completedRun: Run = {
      ...runFixture,
      status: 'completed',
      terminalOutcome: {
        status: 'completed',
        summary: 'The previous Run completed.',
        terminalEventId: 'event.run.completed',
        finishedAt: '2026-08-24T16:05:00.000Z',
      },
    };
    fixture.calls.runGet.mockImplementation(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'run.get',
      result: completedRun,
    }));
    fixture.calls.messageSend.mockImplementation(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'message.send',
      result: {
        message: {
          ...(messagesFixture[0] as Extract<(typeof messagesFixture)[number], { role: 'user' }>),
          id: 'message.delivery-export-root',
          blocks: request.input.blocks,
        },
        chat: chatFixture,
        acceptedRun: runFixture,
      },
    }));
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/delivery']}>
        <App
          api={fixture.api}
          createRequestId={() => 'request.ui.delivery-export-root'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Choose destination & export' }));

    await waitFor(() => expect(fixture.calls.messageSend).toHaveBeenCalledTimes(1));
    const request = fixture.calls.messageSend.mock.calls[0]?.[0].input;
    expect(request?.chatId).toBe(runFixture.chatId);
    expect(request?.selectedContext).toEqual([
      {
        ref: {
          authority: 'delivery',
          id: deliveryPlan.id,
          revision: deliveryPlan.revision,
          contentHash: deliveryPlan.contentHash,
        },
        role: 'selected',
      },
    ]);
    expect(request?.exportDestinationGrant).toEqual(exportGrantFixture);
    expect(JSON.stringify(request?.blocks)).not.toContain(exportGrantFixture.destination.grantId);
    expect(fixture.calls.runSendFollowup).not.toHaveBeenCalled();
  });
});
