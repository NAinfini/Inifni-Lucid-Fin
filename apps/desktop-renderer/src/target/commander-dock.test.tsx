// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { PublicRunEvent } from '@lucid-fin/target-contracts';
import { TargetApp } from './TargetApp.js';
import {
  createTargetApiFixture,
  targetResultFixture,
  targetRunEventsFixture,
} from './test-fixture.js';

afterEach(cleanup);

function appendRunEvent(fixture: ReturnType<typeof createTargetApiFixture>, event: PublicRunEvent) {
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

describe('target Commander Dock', () => {
  it('owns the single inline Run surface and queues a follow-up without a second activity view', async () => {
    const fixture = createTargetApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <TargetApp
          api={fixture.api}
          createRequestId={() => 'request.ui.commander'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Generate four candidates')).toBeTruthy();
    expect(screen.getByText(/generating four opening-direction candidates/i)).toBeTruthy();
    expect(screen.queryByText(/agent activity/i)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/describe the next change/i), {
      target: { value: 'Keep candidate two quieter.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

    await waitFor(() => expect(fixture.calls.runSendFollowup).toHaveBeenCalledTimes(1));
    expect(fixture.calls.runSendFollowup.mock.calls[0]?.[0].input.text).toBe(
      'Keep candidate two quieter.',
    );
  });

  it('enters Focus with the same conversation and restores the workspace on exit', async () => {
    const fixture = createTargetApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/canvas']}>
        <TargetApp api={fixture.api} createRequestId={() => 'request.ui.focus'} locale="en-US" />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Focus$/ }));
    expect(screen.getByRole('button', { name: /exit focus/i })).toBeTruthy();
    expect(screen.getByText(/generating four opening-direction candidates/i)).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByText(/spatial workspace/i)).toBeTruthy();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Focus$/ })),
    );
  });

  it('uses Focus as the single Commander surface at narrow width', async () => {
    const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) =>
        ({
          matches: query === '(max-width: 959px)' || query === '(max-width: 1279px)',
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => true,
        }) as MediaQueryList,
    });

    try {
      const fixture = createTargetApiFixture();
      render(
        <MemoryRouter initialEntries={['/projects/project.blue-hour/delivery']}>
          <TargetApp api={fixture.api} createRequestId={() => 'request.ui.narrow'} locale="en-US" />
        </MemoryRouter>,
      );

      const openCommander = await screen.findByRole('button', { name: 'Open Commander' });
      expect(await screen.findByText(/delivery is assembled/i)).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Focus$/ })).toBeNull();

      fireEvent.click(openCommander);
      expect(await screen.findByRole('button', { name: /exit focus/i })).toBeTruthy();
      expect(screen.queryByText(/delivery is assembled/i)).toBeNull();

      fireEvent.keyDown(window, { key: 'Escape' });
      await waitFor(() =>
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open Commander' })),
      );
      expect(screen.getByText(/delivery is assembled/i)).toBeTruthy();

      fixture.calls.runSendFollowup.mockRejectedValueOnce(
        new Error('Commander request was not accepted.'),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Prepare Review Cut' }));
      await waitFor(() => expect(fixture.calls.runSendFollowup).toHaveBeenCalledTimes(1));
      expect((await screen.findByRole('alert')).textContent).toContain(
        'Commander request was not accepted.',
      );
      expect(screen.queryByRole('button', { name: /exit focus/i })).toBeNull();
      expect(screen.getByText(/delivery is assembled/i)).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Prepare Review Cut' }));
      await waitFor(() => expect(fixture.calls.runSendFollowup).toHaveBeenCalledTimes(2));
      expect(await screen.findByRole('button', { name: /exit focus/i })).toBeTruthy();
    } finally {
      if (originalMatchMedia === undefined) Reflect.deleteProperty(window, 'matchMedia');
      else Object.defineProperty(window, 'matchMedia', originalMatchMedia);
    }
  });

  it('resolves a published result to exact authority refs and undoes its current decision', async () => {
    const fixture = createTargetApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <TargetApp api={fixture.api} createRequestId={() => 'request.ui.quick'} locale="en-US" />
      </MemoryRouter>,
    );

    const summary = await screen.findByText('A restrained harbor arrival candidate.');
    const card = summary.closest('article');
    if (card === null) throw new Error('Expected the published Result card.');
    fireEvent.click(within(card).getByRole('button', { name: /^Select$/ }));

    await waitFor(() => expect(fixture.calls.decisionRecord).toHaveBeenCalledTimes(1));
    expect(fixture.calls.decisionRecord.mock.calls[0]?.[0].input).toMatchObject({
      action: 'select',
      shot: { authority: 'production', id: 'shot.04', revision: 3 },
      result: { authority: 'generated_result', id: 'result.opening.1', revision: 0 },
    });

    fireEvent.click(await within(card).findByRole('button', { name: /^Undo$/ }));
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
  });

  it('refreshes authoritative Result projections when a persisted result is published', async () => {
    const fixture = createTargetApiFixture();
    fixture.calls.historyQuery.mockImplementation(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'history.query',
      result: { items: [], nextCursor: null },
    }));
    fixture.calls.resultQuery.mockImplementation(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'result.query',
      result: {
        items: request.input.query.resultIds.includes(targetResultFixture.resultRef.id)
          ? [targetResultFixture]
          : [],
        nextCursor: null,
      },
    }));
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <TargetApp
          api={fixture.api}
          createRequestId={() => 'request.ui.result-push'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    const summary = await screen.findByText('A restrained harbor arrival candidate.');
    const card = summary.closest('article');
    if (card === null) throw new Error('Expected the published Result card.');
    const select = within(card).getByRole('button', { name: /^Select$/ }) as HTMLButtonElement;
    expect(select.disabled).toBe(true);

    const event = targetRunEventsFixture[1]!;
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

    await waitFor(() =>
      expect(
        fixture.calls.resultQuery.mock.calls.some(([request]) =>
          request.input.query.resultIds.includes(targetResultFixture.resultRef.id),
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(select.disabled).toBe(false));
    fireEvent.click(select);
    await waitFor(() => expect(fixture.calls.decisionRecord).toHaveBeenCalledTimes(1));
  });

  it('shows failures for Run questions and confirmations without auto-retrying either action', async () => {
    const fixture = createTargetApiFixture();
    fixture.calls.interactionAnswer.mockRejectedValueOnce(
      new Error('The answer was not accepted.'),
    );
    fixture.calls.confirmationRespond.mockRejectedValueOnce(
      new Error('The confirmation was not accepted.'),
    );
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <TargetApp
          api={fixture.api}
          createRequestId={() => 'request.ui.interaction-failure'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Generate four candidates')).toBeTruthy();
    const question: PublicRunEvent = {
      ...targetRunEventsFixture[0],
      eventId: 'event.question.failure',
      sequence: 10,
      payloadState: {
        state: 'available',
        payload: {
          type: 'question',
          interactionId: 'interaction.failure',
          prompt: 'Which harbor reference should remain?',
        },
      },
    };
    appendRunEvent(fixture, question);

    fireEvent.change(await screen.findByRole('textbox', { name: 'Answer Commander' }), {
      target: { value: 'Keep the northern pier.' },
    });
    const answer = screen.getByRole('button', { name: 'Answer' });
    fireEvent.click(answer);
    await waitFor(() => expect(fixture.calls.interactionAnswer).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The answer was not accepted.',
    );
    expect((answer as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(answer);
    await waitFor(() => expect(fixture.calls.interactionAnswer).toHaveBeenCalledTimes(2));

    const confirmation: PublicRunEvent = {
      ...targetRunEventsFixture[0],
      eventId: 'event.confirmation.failure',
      sequence: 11,
      payloadState: {
        state: 'available',
        payload: {
          type: 'confirmation_requested',
          interactionId: 'confirmation.failure',
          confirmationId: 'confirmation.failure',
          summary: 'Confirm the final harbor direction.',
          target: {
            kind: 'domain_object',
            ref: {
              authority: 'production',
              id: 'shot.04',
              revision: 3,
              contentHash: 'd'.repeat(64),
            },
          },
          immutableInputHash: 'd'.repeat(64),
        },
      },
    };
    appendRunEvent(fixture, confirmation);

    const approve = await screen.findByRole('button', { name: 'Approve' });
    fireEvent.click(approve);
    await waitFor(() => expect(fixture.calls.confirmationRespond).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The confirmation was not accepted.',
    );
    expect((approve as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(approve);
    await waitFor(() => expect(fixture.calls.confirmationRespond).toHaveBeenCalledTimes(2));
  });

  it('renders the immutable public Delivery export preview before confirmation', async () => {
    const fixture = createTargetApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <TargetApp
          api={fixture.api}
          createRequestId={() => 'request.ui.delivery-confirmation'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    await screen.findByText('Generate four candidates');

    const confirmation: PublicRunEvent = {
      ...targetRunEventsFixture[0],
      eventId: 'event.confirmation.delivery-export',
      sequence: 12,
      payloadState: {
        state: 'available',
        payload: {
          type: 'confirmation_requested',
          interactionId: 'interaction.delivery-export',
          confirmationId: 'confirmation.delivery-export',
          summary: 'Approve the Delivery export.',
          target: {
            kind: 'delivery_export',
            manifest: {
              authority: 'delivery_manifest',
              id: 'manifest.blue-hour',
              revision: 0,
              contentHash: 'e'.repeat(64),
            },
            formatIntent: {
              container: 'mp4',
              videoCodec: 'h264',
              audioCodec: 'aac',
              width: 1920,
              height: 1080,
              frameRate: 24,
              quality: 'review',
            },
            itemCount: 2,
            destination: { kind: 'user_selected_file', displayLabel: 'blue-hour-final.mp4' },
            overwriteExisting: false,
            cost: { state: 'known', value: '0', currency: 'USD' },
          },
          immutableInputHash: 'f'.repeat(64),
        },
      },
    };
    appendRunEvent(fixture, confirmation);

    expect(await screen.findByText('Frozen manifest')).toBeTruthy();
    expect(screen.getByText('manifest.blue-hour')).toBeTruthy();
    expect(screen.getByText(/MP4.*h264.*1920×1080.*24 fps/)).toBeTruthy();
    expect(screen.getByText(/blue-hour-final.mp4.*user selected file/)).toBeTruthy();
    expect(screen.getByText('USD 0')).toBeTruthy();
    expect(screen.queryByText('e'.repeat(64))).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(fixture.calls.confirmationRespond).toHaveBeenCalledTimes(1));
    expect(fixture.calls.confirmationRespond.mock.calls[0]?.[0].input).toEqual({
      confirmationId: 'confirmation.delivery-export',
      immutableInputHash: 'f'.repeat(64),
      decision: 'approved',
    });
  });

  it('opens a Commander result in Media Candidates when Media is already showing Library', async () => {
    const fixture = createTargetApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/media']}>
        <TargetApp
          api={fixture.api}
          createRequestId={() => 'request.ui.open-result'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('tab', { name: 'Library', selected: true })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Open in Media' }));

    expect(await screen.findByRole('tab', { name: 'Candidates', selected: true })).toBeTruthy();
    expect(screen.getByRole('tabpanel').textContent).toContain('result.opening.1');
  });

  it('shows the selected Result in the Focus inspector without duplicating Commander state', async () => {
    const fixture = createTargetApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/media']}>
        <TargetApp
          api={fixture.api}
          createRequestId={() => 'request.ui.inspector'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('tab', { name: 'Candidates' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Inspect candidate result.opening.1' }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Focus$/ }));

    const inspector = await screen.findByRole('complementary', { name: 'Result inspector' });
    expect(within(inspector).getByRole('heading', { name: 'result.opening.1' })).toBeTruthy();
    expect(within(inspector).getByRole('button', { name: /^Select$/ })).toBeTruthy();
    expect(within(inspector).getByText('Lucid Video 1')).toBeTruthy();
  });

  it('protects the exact selected Result decision only after explicit confirmation', async () => {
    const fixture = createTargetApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/media']}>
        <TargetApp
          api={fixture.api}
          createRequestId={() => 'request.ui.protection'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('tab', { name: 'Candidates' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Inspect candidate result.opening.1' }),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Focus$/ }));

    const inspector = await screen.findByRole('complementary', { name: 'Result inspector' });
    fireEvent.click(within(inspector).getByRole('button', { name: 'Request protection' }));

    await waitFor(() => expect(fixture.calls.decisionProtect).toHaveBeenCalledTimes(1));
    expect(fixture.calls.decisionProtect.mock.calls[0]?.[0].input).toMatchObject({
      mode: 'protect',
      owner: {
        authority: 'production',
        id: 'shot.04',
        revision: 3,
      },
      field: {
        owner: 'production',
        objectId: 'shot.04',
        field: 'resultDecision',
        resultId: 'result.opening.1',
      },
    });
    expect(within(inspector).getByRole('alert').textContent).toContain(
      'Explicit confirmation required',
    );

    fireEvent.click(within(inspector).getByRole('button', { name: 'Confirm explicitly' }));
    await waitFor(() => expect(fixture.calls.confirmationRespond).toHaveBeenCalledTimes(1));
    expect(fixture.calls.confirmationRespond.mock.calls[0]?.[0].input).toMatchObject({
      confirmationId: 'confirmation.protection.1',
      decision: 'approved',
    });
    await waitFor(() =>
      expect(within(inspector).getByText(/Protected; changing this fact/)).toBeTruthy(),
    );
  });

  it('opens authoritative History evidence in the Focus Project-change inspector', async () => {
    const fixture = createTargetApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <TargetApp api={fixture.api} createRequestId={() => 'request.ui.history'} locale="en-US" />
      </MemoryRouter>,
    );

    fireEvent.click(
      await screen.findByRole('button', { name: /generated candidate recorded for shot 04/i }),
    );

    const inspector = await screen.findByRole('complementary', { name: 'Result inspector' });
    expect(
      within(inspector).getByRole('heading', {
        name: 'Generated candidate recorded for Shot 04.',
      }),
    ).toBeTruthy();
    expect(within(inspector).getByText('Project change')).toBeTruthy();
  });
});
