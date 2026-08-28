// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PublicRunEvent, Run } from '@lucid-fin/contracts';
import type { WireResult } from './api.js';
import { App } from './App.js';
import {
  createDesktopApiFixture,
  chatFixture,
  messagesFixture,
  projectFixture,
  runEventsFixture,
  runFixture,
} from './test-fixture.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function ProjectSwitch() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/projects/project.second/overview')}>
      Switch Project
    </button>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="route-location">{`${location.pathname}${location.search}`}</output>;
}

function QuerySwitch({ to }: { readonly to: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(to)}>
      Switch query
    </button>
  );
}

function messageListResponse(
  request: { readonly requestId: string },
  result: WireResult<'message.list'>,
) {
  return {
    wireVersion: 1 as const,
    kind: 'success' as const,
    requestId: request.requestId,
    method: 'message.list' as const,
    result,
  };
}

function runResponse(request: { readonly requestId: string }, result: Run) {
  return {
    wireVersion: 1 as const,
    kind: 'success' as const,
    requestId: request.requestId,
    method: 'run.get' as const,
    result,
  };
}

function runEventsResponse(
  request: { readonly requestId: string },
  result: WireResult<'run.events.list'>,
) {
  return {
    wireVersion: 1 as const,
    kind: 'success' as const,
    requestId: request.requestId,
    method: 'run.events.list' as const,
    result,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

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

describe('Project shell', () => {
  it('opens from a compact Projects list and keeps the frozen workspace order', async () => {
    const fixture = createDesktopApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.1'} locale="en-US" />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /open blue hour/i }));

    const navigation = await screen.findByRole('navigation', { name: /project workspace/i });
    expect(
      within(navigation)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Overview 1', 'Canvas 1', 'Media 1', 'Production 2', 'Delivery 0']);
    expect(screen.getByRole('complementary', { name: /commander/i })).toBeTruthy();
  });

  it('keeps Global Media reachable from an open Project', async () => {
    const fixture = createDesktopApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.shell-global-media'} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Blue Hour' })).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Global Media' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Global Media' })).toBeTruthy();
  });

  it('archives an open Project through project.update before returning Home', async () => {
    const fixture = createDesktopApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.shell-archive'} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Blue Hour' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Archive Project' }));

    await waitFor(() => expect(fixture.calls.projectUpdate).toHaveBeenCalledTimes(1));
    expect(fixture.calls.projectUpdate.mock.calls[0]?.[0].input).toMatchObject({
      projectId: 'project.blue-hour',
      expectedRevision: projectFixture.revision,
      name: null,
      lifecycle: 'archived',
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Projects' })).toBeTruthy();
  });

  it('keeps an open Project visible when archiving is rejected', async () => {
    const fixture = createDesktopApiFixture();
    fixture.calls.projectUpdate.mockRejectedValueOnce(
      new Error('The Project changed on another screen.'),
    );
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.shell-archive-failure'} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Blue Hour' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Archive Project' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'The Project changed on another screen.',
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Blue Hour' })).toBeTruthy();
  });

  it('creates the Project, first Chat, and first Run from one brief', async () => {
    const fixture = createDesktopApiFixture();
    fixture.calls.projectList.mockImplementationOnce(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'project.list',
      result: { items: [], nextCursor: null },
    }));
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.create'} locale="en-US" />
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByPlaceholderText(/describe the film/i), {
      target: { value: 'A patient harbor film at blue hour.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create project & start/i }));

    await waitFor(() => expect(fixture.calls.messageSend).toHaveBeenCalledTimes(1));
    expect(fixture.calls.projectCreate.mock.calls[0]?.[0].input.name).toBe('A patient harbor film');
    expect(fixture.calls.projectCreate.mock.calls[0]?.[0].input.budget).toEqual({
      costUsd: { state: 'unknown', currency: 'USD' },
      maxGenerationCount: 40,
      maxInputTokens: 200_000,
      maxOutputTokens: 40_000,
    });
    expect(fixture.calls.chatCreate.mock.calls[0]?.[0].input.projectId).toBe(projectFixture.id);
    expect(fixture.calls.messageSend.mock.calls[0]?.[0].input.blocks).toEqual([
      { type: 'text', text: 'A patient harbor film at blue hour.' },
    ]);
    expect(await screen.findByRole('heading', { level: 1, name: 'Blue Hour' })).toBeTruthy();
  });

  it('manages ready Providers and eligible Skills through the Project settings authority', async () => {
    const fixture = createDesktopApiFixture();
    const { container } = render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.settings'} locale="en-US" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Blue Hour' })).toBeTruthy();
    const settingsTrigger = container.querySelector<HTMLButtonElement>('.lucid-settings-toggle');
    expect(settingsTrigger).not.toBeNull();
    settingsTrigger!.focus();
    fireEvent.click(settingsTrigger!);

    const dialog = await screen.findByRole('dialog', { name: 'Project settings' });
    const closeSettings = within(dialog).getByRole('button', { name: 'Close Project settings' });
    await waitFor(() => expect(document.activeElement).toBe(closeSettings));
    expect(
      within(dialog).getByRole('option', { name: /Lucid Local · Lucid Video 1/ }),
    ).toBeTruthy();
    const quarantined = within(dialog).getByRole('checkbox', { name: /Unreviewed import/ });
    expect((quarantined as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(within(dialog).getByRole('checkbox', { name: /Cinematography/ }));
    fireEvent.change(within(dialog).getByLabelText('Permission'), {
      target: { value: 'full' },
    });
    fireEvent.change(within(dialog).getByLabelText('Cost ceiling (USD)'), {
      target: { value: '12.50' },
    });
    fireEvent.change(within(dialog).getByLabelText('Generation limit'), {
      target: { value: '55' },
    });
    fireEvent.change(within(dialog).getByLabelText('Input token limit'), {
      target: { value: '250000' },
    });
    fireEvent.change(within(dialog).getByLabelText('Output token limit'), {
      target: { value: '50000' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Project settings' }));

    await waitFor(() => expect(fixture.calls.settingsUpdate).toHaveBeenCalledTimes(1));
    expect(fixture.calls.settingsUpdate.mock.calls[0]?.[0].input).toMatchObject({
      projectId: projectFixture.id,
      defaultProviderProfileId: 'provider.lucid',
      permission: 'full',
      budget: {
        costUsd: { state: 'known', value: '12.5', currency: 'USD' },
        maxGenerationCount: 55,
        maxInputTokens: 250_000,
        maxOutputTokens: 50_000,
      },
      enabledSkills: [],
    });
    expect(within(dialog).getByText('Trusted storyboard review Skills.')).toBeTruthy();
    expect(within(dialog).getByText(/SHA-256 · c{64}/)).toBeTruthy();
    const installPlugin = within(dialog).getByRole('button', {
      name: 'Install Storyboard review',
    });
    fireEvent.click(installPlugin);
    fireEvent.click(installPlugin);
    await waitFor(() => expect(fixture.calls.pluginApply).toHaveBeenCalledTimes(1));
    expect(fixture.calls.pluginApply.mock.calls[0]?.[0].input).toEqual({
      action: 'install',
      packageId: 'plugin.storyboard',
      version: '1.0.0',
      manifestHash: 'c'.repeat(64),
      expectedInstallationRevision: null,
    });
    expect(
      await within(dialog).findByRole('button', { name: 'Remove Storyboard review' }),
    ).toBeTruthy();

    fireEvent.keyDown(closeSettings, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Project settings' })).toBeNull(),
    );
    expect(document.activeElement).toBe(settingsTrigger);
  });

  it('refreshes only the owning Project overview for aggregate events from other Runs', async () => {
    const fixture = createDesktopApiFixture();
    const otherRun: Run = {
      ...runFixture,
      id: 'run.other-chat',
      chatId: 'chat.other',
      revision: 2,
      contentHash: 'd'.repeat(64),
    };
    const foreignRun: Run = {
      ...otherRun,
      id: 'run.foreign-project',
      projectId: 'project.foreign',
      contentHash: 'e'.repeat(64),
    };
    fixture.calls.runGet.mockImplementation(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'run.get',
      result:
        request.input.runId === foreignRun.id
          ? foreignRun
          : request.input.runId === otherRun.id
            ? otherRun
            : runFixture,
    }));
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.aggregate-push'} locale="en-US" />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Blue Hour' })).toBeTruthy();
    fixture.calls.overviewGet.mockClear();
    fixture.calls.runGet.mockClear();

    const event = (eventId: string, runId: string, payload: PublicRunEvent['payloadState']) =>
      ({
        ...runEventsFixture[0],
        eventId,
        runId,
        sequence: 10,
        causation: { kind: 'run' as const, runId },
        payloadState: payload,
      }) satisfies PublicRunEvent;

    appendRunEvent(
      fixture,
      event('event.other.state', otherRun.id, {
        state: 'available',
        payload: {
          type: 'run_state_changed',
          previousState: 'running',
          state: 'waiting_question',
          runRevision: 3,
        },
      }),
    );
    await waitFor(() => expect(fixture.calls.runGet).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fixture.calls.overviewGet).toHaveBeenCalledTimes(1));

    appendRunEvent(
      fixture,
      event('event.other.tasks', otherRun.id, {
        state: 'available',
        payload: {
          type: 'task_list_changed',
          taskListId: 'tasks.other',
          revision: 2,
          publicSummary: 'The other Run advanced its task list.',
        },
      }),
    );
    await waitFor(() => expect(fixture.calls.runGet).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(fixture.calls.overviewGet).toHaveBeenCalledTimes(2));

    appendRunEvent(
      fixture,
      event('event.current.terminal', runFixture.id, {
        state: 'available',
        payload: {
          type: 'terminal_summary',
          status: 'completed',
          summary: 'The current Run completed.',
          resultIds: [],
        },
      }),
    );
    await waitFor(() => expect(fixture.calls.runGet).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(fixture.calls.overviewGet).toHaveBeenCalledTimes(3));

    appendRunEvent(
      fixture,
      event('event.foreign.terminal', foreignRun.id, {
        state: 'available',
        payload: {
          type: 'terminal_summary',
          status: 'completed',
          summary: 'A foreign Run completed.',
          resultIds: [],
        },
      }),
    );
    await waitFor(() => expect(fixture.calls.runGet).toHaveBeenCalledTimes(4));
    await act(async () => {
      await Promise.resolve();
    });
    expect(fixture.calls.overviewGet).toHaveBeenCalledTimes(3);
  });

  it('ignores a stale Project response after navigating to another Project', async () => {
    const fixture = createDesktopApiFixture();
    type ProjectGetResponse = Awaited<ReturnType<typeof fixture.calls.projectGet>>;
    let resolveFirstProject!: (response: ProjectGetResponse) => void;
    const firstProject = new Promise<ProjectGetResponse>((resolve) => {
      resolveFirstProject = resolve;
    });
    fixture.calls.projectGet.mockImplementation(async (request) => {
      if (request.input.projectId === projectFixture.id) return firstProject;
      return {
        wireVersion: 1,
        kind: 'success',
        requestId: request.requestId,
        method: 'project.get',
        result: {
          ...projectFixture,
          id: 'project.second',
          name: 'Second Project',
          contentHash: 'd'.repeat(64),
        },
      };
    });

    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <ProjectSwitch />
        <App api={fixture.api} createRequestId={() => 'request.ui.switch'} locale="en-US" />
      </MemoryRouter>,
    );

    await waitFor(() => expect(fixture.calls.projectGet).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Switch Project' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Second Project' })).toBeTruthy();

    await act(async () => {
      resolveFirstProject({
        wireVersion: 1,
        kind: 'success',
        requestId: 'request.ui.switch',
        method: 'project.get',
        result: projectFixture,
      });
      await Promise.resolve();
    });

    expect(screen.getByRole('heading', { level: 1, name: 'Second Project' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1, name: 'Blue Hour' })).toBeNull();
  });

  it('restores the last successful Chat selection for the Project', async () => {
    const fixture = createDesktopApiFixture();
    const secondChat = {
      ...chatFixture,
      id: 'chat.second-direction',
      title: 'Second direction',
      contentHash: 'd'.repeat(64),
    };
    fixture.calls.chatList.mockImplementationOnce(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'chat.list',
      result: { items: [chatFixture, secondChat], nextCursor: null },
    }));
    localStorage.setItem(`lucid-fin:last-chat:${projectFixture.id}`, secondChat.id);

    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.last-chat'} locale="en-US" />
      </MemoryRouter>,
    );

    const chatSelector = await screen.findByRole('combobox', { name: 'Current Chat' });
    await waitFor(() => expect((chatSelector as HTMLSelectElement).value).toBe(secondChat.id));
    expect(fixture.calls.messageList.mock.calls.at(-1)?.[0].input.chatId).toBe(secondChat.id);
  });

  it('deletes a Chat while its TaskList is active', async () => {
    const fixture = createDesktopApiFixture();
    const deleteChat = vi.fn(async (request) => ({
      wireVersion: 1 as const,
      kind: 'success' as const,
      requestId: request.requestId,
      method: 'chat.delete' as const,
      result: {
        ...chatFixture,
        lifecycle: 'deleted' as const,
        revision: chatFixture.revision + 1,
        contentHash: 'd'.repeat(64),
        deletedAt: '2026-08-24T17:00:00.000Z',
      },
    }));
    const api = {
      ...fixture.api,
      chat: { ...fixture.api.chat, delete: deleteChat },
    };

    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={api} createRequestId={() => 'request.ui.delete-chat'} locale="en-US" />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Create opening direction')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Chat actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Chat' }));
    const confirmation = screen.getByRole('alertdialog', { name: 'Delete Opening direction' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Delete Chat' }));

    await waitFor(() => expect(deleteChat).toHaveBeenCalledTimes(1));
    expect(deleteChat.mock.calls[0]?.[0].input).toEqual({
      chatId: chatFixture.id,
      expectedRevision: chatFixture.revision,
    });
    await waitFor(() =>
      expect(
        (screen.getByRole('combobox', { name: 'Current Chat' }) as HTMLSelectElement).value,
      ).toBe(''),
    );
  });

  it('archives a Chat through the same lifecycle authority', async () => {
    const fixture = createDesktopApiFixture();
    const archiveChat = vi.fn(async (request) => ({
      wireVersion: 1 as const,
      kind: 'success' as const,
      requestId: request.requestId,
      method: 'chat.archive' as const,
      result: {
        ...chatFixture,
        lifecycle: 'archived' as const,
        revision: chatFixture.revision + 1,
        contentHash: 'd'.repeat(64),
        archivedAt: '2026-08-24T17:00:00.000Z',
      },
    }));
    const api = {
      ...fixture.api,
      chat: { ...fixture.api.chat, archive: archiveChat },
    };
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={api} createRequestId={() => 'request.ui.archive-chat'} locale="en-US" />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { level: 1, name: 'Blue Hour' });
    fireEvent.click(screen.getByRole('button', { name: 'Chat actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive Chat' }));

    await waitFor(() => expect(archiveChat).toHaveBeenCalledTimes(1));
    expect(archiveChat.mock.calls[0]?.[0].input).toEqual({
      chatId: chatFixture.id,
      expectedRevision: chatFixture.revision,
    });
  });

  it('uses the authoritative Chat revision after accepting a new root Run', async () => {
    const fixture = createDesktopApiFixture();
    const authoritativeChat = {
      ...chatFixture,
      revision: chatFixture.revision + 1,
      messageCount: chatFixture.messageCount + 1,
      messageHeadSequence: (chatFixture.messageHeadSequence ?? 0) + 1,
      contentHash: 'd'.repeat(64),
    };
    const acceptedMessage = {
      ...messagesFixture[0],
      id: 'message.new-root-run',
      sequence: messagesFixture[0].sequence + 1,
      contentHash: 'd'.repeat(64),
    } as Extract<(typeof messagesFixture)[number], { role: 'user' }>;
    fixture.calls.runGet.mockImplementation(async (request) =>
      runResponse(request, { ...runFixture, status: 'completed' } as Run),
    );
    fixture.calls.messageSend.mockImplementation(async (request) => ({
      wireVersion: 1 as const,
      kind: 'success' as const,
      requestId: request.requestId,
      method: 'message.send' as const,
      result: {
        message: acceptedMessage,
        chat: authoritativeChat,
        acceptedRun: runFixture,
      },
    }));
    const archiveChat = vi.fn(async (request) => ({
      wireVersion: 1 as const,
      kind: 'success' as const,
      requestId: request.requestId,
      method: 'chat.archive' as const,
      result: {
        ...authoritativeChat,
        lifecycle: 'archived' as const,
        revision: authoritativeChat.revision + 1,
        contentHash: 'e'.repeat(64),
        archivedAt: '2026-08-24T17:00:00.000Z',
      },
    }));
    const api = {
      ...fixture.api,
      chat: { ...fixture.api.chat, archive: archiveChat },
    };
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={api} createRequestId={() => 'request.ui.authoritative-chat'} locale="en-US" />
      </MemoryRouter>,
    );

    await screen.findByText('Generate four candidates');
    fireEvent.change(screen.getByPlaceholderText(/describe the next change/i), {
      target: { value: 'Start a new root Run.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
    await waitFor(() => expect(fixture.calls.messageSend).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Chat actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive Chat' }));
    await waitFor(() => expect(archiveChat).toHaveBeenCalledTimes(1));
    expect(archiveChat.mock.calls[0]?.[0].input).toEqual({
      chatId: chatFixture.id,
      expectedRevision: authoritativeChat.revision,
    });
  });

  it('does not apply a delayed root Run acceptance after switching and creating a Chat', async () => {
    const fixture = createDesktopApiFixture();
    const secondChat = {
      ...chatFixture,
      id: 'chat.second-direction',
      title: 'Second direction',
      contentHash: 'd'.repeat(64),
    };
    const createdChat = {
      ...chatFixture,
      id: 'chat.created-after-send',
      title: 'Created after send',
      contentHash: 'e'.repeat(64),
    };
    const secondMessage = {
      ...messagesFixture[0],
      id: 'message.second-direction',
      chatId: secondChat.id,
      blocks: [{ type: 'text' as const, text: 'Second Chat transcript.' }],
      contentHash: 'f'.repeat(64),
    };
    const acceptedMessage = {
      ...messagesFixture[0],
      id: 'message.delayed-root',
      sequence: 2,
      blocks: [{ type: 'text' as const, text: 'Delayed root message from the first Chat.' }],
      contentHash: 'd'.repeat(64),
    } as Extract<(typeof messagesFixture)[number], { role: 'user' }>;
    const completedRun = { ...runFixture, status: 'completed' } as Run;
    const delayedSend = deferred<Awaited<ReturnType<typeof fixture.calls.messageSend>>>();
    const archiveChat = vi.fn(async (request) => ({
      wireVersion: 1 as const,
      kind: 'success' as const,
      requestId: request.requestId,
      method: 'chat.archive' as const,
      result: {
        ...chatFixture,
        lifecycle: 'archived' as const,
        revision: 3,
        contentHash: 'f'.repeat(64),
        archivedAt: '2026-08-24T17:00:00.000Z',
      },
    }));
    let sendRequestId = '';
    fixture.calls.chatList.mockImplementation(async (request) => ({
      wireVersion: 1 as const,
      kind: 'success' as const,
      requestId: request.requestId,
      method: 'chat.list' as const,
      result: { items: [chatFixture, secondChat], nextCursor: null },
    }));
    fixture.calls.chatCreate.mockImplementation(async (request) => ({
      wireVersion: 1 as const,
      kind: 'success' as const,
      requestId: request.requestId,
      method: 'chat.create' as const,
      result: createdChat,
    }));
    fixture.calls.messageList.mockImplementation(async (request) =>
      messageListResponse(
        request,
        request.input.chatId === secondChat.id
          ? { items: [secondMessage], nextCursor: null }
          : { items: messagesFixture, nextCursor: null },
      ),
    );
    fixture.calls.runGet.mockImplementation(async (request) => runResponse(request, completedRun));
    fixture.calls.messageSend.mockImplementation((request) => {
      sendRequestId = request.requestId;
      return delayedSend.promise;
    });
    const api = { ...fixture.api, chat: { ...fixture.api.chat, archive: archiveChat } };

    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={api} createRequestId={() => 'request.ui.delayed-root'} />
      </MemoryRouter>,
    );

    await screen.findByText(
      'Explore opening direction options for Shot 04. Keep the tone moody and grounded.',
    );
    fireEvent.change(screen.getByPlaceholderText(/describe the next change/i), {
      target: { value: 'Start a delayed root Run.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
    await waitFor(() => expect(fixture.calls.messageSend).toHaveBeenCalledTimes(1));

    const chatSelector = screen.getByRole('combobox', { name: 'Current Chat' });
    fireEvent.change(chatSelector, { target: { value: secondChat.id } });
    expect(await screen.findByText('Second Chat transcript.')).toBeTruthy();
    await waitFor(() => expect((chatSelector as HTMLSelectElement).value).toBe(secondChat.id));

    fireEvent.click(screen.getByRole('button', { name: 'New Chat' }));
    await waitFor(() => expect((chatSelector as HTMLSelectElement).value).toBe(createdChat.id));

    await act(async () => {
      delayedSend.resolve({
        wireVersion: 1,
        kind: 'success',
        requestId: sendRequestId,
        method: 'message.send',
        result: {
          message: acceptedMessage,
          chat: { ...chatFixture, revision: 2, contentHash: 'e'.repeat(64) },
          acceptedRun: runFixture,
        },
      });
      await Promise.resolve();
    });

    expect((chatSelector as HTMLSelectElement).value).toBe(createdChat.id);
    expect(screen.queryByText('Delayed root message from the first Chat.')).toBeNull();
    expect(screen.queryByText('Second Chat transcript.')).toBeNull();
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.queryByText('In progress')).toBeNull();

    fireEvent.change(chatSelector, { target: { value: chatFixture.id } });
    await waitFor(() => expect((chatSelector as HTMLSelectElement).value).toBe(chatFixture.id));
    fireEvent.click(screen.getByRole('button', { name: 'Chat actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Archive Chat' }));
    await waitFor(() => expect(archiveChat).toHaveBeenCalledTimes(1));
    expect(archiveChat.mock.calls[0]?.[0].input).toEqual({
      chatId: chatFixture.id,
      expectedRevision: 2,
    });
  });

  it('keeps a failed Chat lifecycle command visible without removing the Chat', async () => {
    const fixture = createDesktopApiFixture();
    const deleteChat = vi.fn(async () => {
      throw new Error('The Chat changed on another screen.');
    });
    const api = {
      ...fixture.api,
      chat: { ...fixture.api.chat, delete: deleteChat },
    };
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={api} createRequestId={() => 'request.ui.delete-chat-failure'} locale="en-US" />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { level: 1, name: 'Blue Hour' });
    fireEvent.click(screen.getByRole('button', { name: 'Chat actions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete Chat' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog', { name: 'Delete Opening direction' })).getByRole(
        'button',
        { name: 'Delete Chat' },
      ),
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'The Chat changed on another screen.',
    );
    expect(
      (screen.getByRole('combobox', { name: 'Current Chat' }) as HTMLSelectElement).value,
    ).toBe(chatFixture.id);
  });

  it('loads additional Chats without replacing the active Chat', async () => {
    const fixture = createDesktopApiFixture();
    const secondChat = {
      ...chatFixture,
      id: 'chat.additional',
      title: 'Additional Chat',
      contentHash: 'd'.repeat(64),
    };
    fixture.calls.chatList.mockImplementation(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'chat.list',
      result:
        request.input.page.cursor === null
          ? { items: [chatFixture], nextCursor: 'cursor.chat.page.2' }
          : { items: [secondChat], nextCursor: null },
    }));
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.chat-page'} locale="en-US" />
      </MemoryRouter>,
    );

    const selector = await screen.findByRole('combobox', { name: 'Current Chat' });
    fireEvent.click(screen.getByRole('button', { name: 'Load more Chats' }));

    expect(await within(selector).findByRole('option', { name: secondChat.title })).toBeTruthy();
    expect((selector as HTMLSelectElement).value).toBe(chatFixture.id);
    expect(fixture.calls.chatList.mock.calls.at(-1)?.[0].input.page.cursor).toBe(
      'cursor.chat.page.2',
    );
  });

  it('loads earlier Messages and remaining Run events on demand', async () => {
    const fixture = createDesktopApiFixture();
    const latestMessage = {
      ...messagesFixture[0],
      id: 'message.latest',
      sequence: 2,
      contentHash: 'd'.repeat(64),
      blocks: [{ type: 'text' as const, text: 'Latest visible message.' }],
    };
    fixture.calls.messageList.mockImplementation(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'message.list',
      result:
        request.input.page.cursor === null
          ? { items: [latestMessage], nextCursor: 'cursor.message.page.2' }
          : { items: messagesFixture, nextCursor: null },
    }));
    fixture.calls.runEventsList.mockImplementation(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'run.events.list',
      result:
        request.input.page.cursor === null
          ? { items: [runEventsFixture[0]], nextCursor: 'cursor.events.page.2' }
          : { items: [runEventsFixture[1]], nextCursor: null },
    }));
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.timeline-page'} locale="en-US" />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Latest visible message.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load earlier Messages' }));
    expect(
      await screen.findByText(
        'Explore opening direction options for Shot 04. Keep the tone moody and grounded.',
      ),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Load more Run events' }));
    expect(await screen.findByText('A restrained harbor arrival candidate.')).toBeTruthy();
    expect(fixture.calls.messageList.mock.calls.at(-1)?.[0].input.page.cursor).toBe(
      'cursor.message.page.2',
    );
    expect(fixture.calls.runEventsList.mock.calls.at(-1)?.[0].input.page.cursor).toBe(
      'cursor.events.page.2',
    );
  });

  it('reloads the authoritative transcript and Run after a follow-up', async () => {
    const fixture = createDesktopApiFixture();
    const followupMessage = {
      ...messagesFixture[0],
      id: 'message.authoritative-followup',
      sequence: 2,
      blocks: [{ type: 'text' as const, text: 'Keep the second candidate quieter.' }],
      contentHash: 'd'.repeat(64),
    };
    let followupAccepted = false;
    fixture.calls.messageList.mockImplementation(async (request) =>
      messageListResponse(request, {
        items: followupAccepted ? [...messagesFixture, followupMessage] : messagesFixture,
        nextCursor: null,
      }),
    );
    fixture.calls.runGet.mockImplementation(async (request) =>
      runResponse(
        request,
        followupAccepted
          ? { ...runFixture, revision: runFixture.revision + 1, contentHash: 'd'.repeat(64) }
          : runFixture,
      ),
    );
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.authoritative-followup'} />
      </MemoryRouter>,
    );

    await screen.findByText('Generate four candidates');
    followupAccepted = true;
    fireEvent.change(screen.getByPlaceholderText(/describe the next change/i), {
      target: { value: 'Keep the second candidate quieter.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

    expect(await screen.findByText('Keep the second candidate quieter.')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/describe the next change/i), {
      target: { value: 'Use the updated Run revision.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

    await waitFor(() => expect(fixture.calls.runSendFollowup).toHaveBeenCalledTimes(2));
    expect(fixture.calls.runSendFollowup.mock.calls[1]?.[0].input.expectedRevision).toBe(
      runFixture.revision + 1,
    );
  });

  it('blocks a stale follow-up revision when its authoritative reload fails', async () => {
    const fixture = createDesktopApiFixture();
    let followupAccepted = false;
    fixture.calls.runGet.mockImplementation(async (request) => {
      if (followupAccepted) throw new Error('Run authority is unavailable.');
      return runResponse(request, runFixture);
    });
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.followup-refresh-failure'} />
      </MemoryRouter>,
    );

    await screen.findByText('Generate four candidates');
    followupAccepted = true;
    fireEvent.change(screen.getByPlaceholderText(/describe the next change/i), {
      target: { value: 'Keep the second candidate quieter.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

    expect(
      await screen.findByText(/follow-up was accepted, but the Chat could not refresh/i),
    ).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/describe the next change/i), {
      target: { value: 'Do not reuse the stale revision.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

    expect(
      await screen.findByText(/accepted follow-up has not refreshed from the authority yet/i),
    ).toBeTruthy();
    expect(fixture.calls.runSendFollowup).toHaveBeenCalledTimes(1);
    expect(fixture.calls.messageSend).not.toHaveBeenCalled();
  });

  it('ignores stale Chat switches and paginated Messages or Run events', async () => {
    const fixture = createDesktopApiFixture();
    const secondChat = {
      ...chatFixture,
      id: 'chat.second-direction',
      title: 'Second direction',
      contentHash: 'd'.repeat(64),
    };
    const firstPageMessage = {
      ...messagesFixture[0],
      id: 'message.first-page',
      sequence: 2,
      blocks: [{ type: 'text' as const, text: 'Latest first Chat message.' }],
      contentHash: 'd'.repeat(64),
    };
    const secondMessage = {
      ...messagesFixture[0],
      id: 'message.second-chat',
      chatId: secondChat.id,
      blocks: [{ type: 'text' as const, text: 'Second Chat message.' }],
      contentHash: 'e'.repeat(64),
    };
    const staleMessage = {
      ...messagesFixture[0],
      id: 'message.stale-page',
      blocks: [{ type: 'text' as const, text: 'Stale first Chat message.' }],
      contentHash: 'f'.repeat(64),
    };
    const staleEvent = {
      ...runEventsFixture[0],
      eventId: 'event.stale-page',
      sequence: 2,
      payloadState: {
        state: 'available' as const,
        payload: { type: 'progress' as const, summary: 'Stale first Run event.' },
      },
    };
    const slowSecond = deferred<ReturnType<typeof messageListResponse>>();
    const staleMessages = deferred<ReturnType<typeof messageListResponse>>();
    const staleEvents = deferred<ReturnType<typeof runEventsResponse>>();
    let slowSecondRequest: { readonly requestId: string } | null = null;
    let staleMessagesRequest: { readonly requestId: string } | null = null;
    let staleEventsRequest: { readonly requestId: string } | null = null;
    let secondChatLoads = 0;
    fixture.calls.chatList.mockImplementation(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'chat.list',
      result: { items: [chatFixture, secondChat], nextCursor: null },
    }));
    fixture.calls.messageList.mockImplementation(async (request) => {
      if (request.input.chatId === secondChat.id) {
        if (secondChatLoads++ === 0) {
          slowSecondRequest = request;
          return slowSecond.promise;
        }
        return messageListResponse(request, { items: [secondMessage], nextCursor: null });
      }
      if (request.input.page.cursor === 'cursor.messages.page.2') {
        staleMessagesRequest = request;
        return staleMessages.promise;
      }
      return messageListResponse(request, {
        items: [firstPageMessage],
        nextCursor: 'cursor.messages.page.2',
      });
    });
    fixture.calls.runEventsList.mockImplementation(async (request) => {
      if (request.input.page.cursor === 'cursor.events.page.2') {
        staleEventsRequest = request;
        return staleEvents.promise;
      }
      return runEventsResponse(request, {
        items: [runEventsFixture[0]],
        nextCursor: 'cursor.events.page.2',
      });
    });
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.chat-race'} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Latest first Chat message.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Focus$/ }));
    const focusChats = screen.getByRole('complementary', { name: 'Project Chats' });
    const firstChatButton = within(focusChats).getByRole('button', { name: 'Opening direction' });
    const secondChatButton = within(focusChats).getByRole('button', { name: 'Second direction' });

    fireEvent.click(secondChatButton);
    fireEvent.click(firstChatButton);
    await act(async () => {
      slowSecond.resolve(
        messageListResponse(slowSecondRequest!, { items: [secondMessage], nextCursor: null }),
      );
      await Promise.resolve();
    });
    expect(firstChatButton.className).toContain('is-active');
    expect(screen.queryByText('Second Chat message.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Load earlier Messages' }));
    fireEvent.click(secondChatButton);
    expect(await screen.findByText('Second Chat message.')).toBeTruthy();
    await act(async () => {
      staleMessages.resolve(
        messageListResponse(staleMessagesRequest!, { items: [staleMessage], nextCursor: null }),
      );
      await Promise.resolve();
    });
    expect(screen.queryByText('Stale first Chat message.')).toBeNull();

    fireEvent.click(firstChatButton);
    expect(await screen.findByText('Latest first Chat message.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more Run events' }));
    fireEvent.click(secondChatButton);
    expect(await screen.findByText('Second Chat message.')).toBeTruthy();
    await act(async () => {
      staleEvents.resolve(
        runEventsResponse(staleEventsRequest!, { items: [staleEvent], nextCursor: null }),
      );
      await Promise.resolve();
    });
    expect(screen.queryByText('Stale first Run event.')).toBeNull();
  });

  it('reloads changed run queries and rejects a Run outside the selected Project Chat', async () => {
    const fixture = createDesktopApiFixture();
    const foreignRun = {
      ...runFixture,
      id: 'run.foreign',
      projectId: 'project.foreign',
      chatId: 'chat.foreign',
      contentHash: 'd'.repeat(64),
    };
    const selectedRun = {
      ...runFixture,
      id: 'run.selected',
      revision: runFixture.revision + 1,
      contentHash: 'e'.repeat(64),
    };
    const selectedRunEvent = {
      ...runEventsFixture[0],
      runId: selectedRun.id,
      payloadState: {
        state: 'available' as const,
        payload: { type: 'progress' as const, summary: 'Selected Run loaded from the URL.' },
      },
    };
    fixture.calls.runGet.mockImplementation(async (request) =>
      runResponse(request, request.input.runId === foreignRun.id ? foreignRun : selectedRun),
    );
    fixture.calls.runEventsList.mockImplementation(async (request) =>
      runEventsResponse(request, { items: [selectedRunEvent], nextCursor: null }),
    );
    render(
      <MemoryRouter
        initialEntries={[
          '/projects/project.blue-hour/overview?chat=chat.opening-direction&run=run.foreign',
        ]}
      >
        <QuerySwitch to="/projects/project.blue-hour/overview?chat=chat.opening-direction&run=run.selected" />
        <App api={fixture.api} createRequestId={() => 'request.ui.run-query'} />
      </MemoryRouter>,
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'The requested Run does not belong to this Project Chat.',
    );
    expect(fixture.calls.runEventsList).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Switch query' }));
    expect(await screen.findByText('Selected Run loaded from the URL.')).toBeTruthy();
    expect(fixture.calls.runEventsList.mock.calls.at(-1)?.[0].input.runId).toBe(selectedRun.id);
  });

  it('surfaces non-not-found transcript Run failures instead of clearing the Run silently', async () => {
    const fixture = createDesktopApiFixture();
    fixture.calls.runGet.mockRejectedValueOnce(new Error('Run authority is unavailable.'));
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.run-failure'} />
      </MemoryRouter>,
    );

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Run authority is unavailable.',
    );
  });

  it('preserves the current transcript when another Chat fails to load its Run', async () => {
    const fixture = createDesktopApiFixture();
    const secondChat = {
      ...chatFixture,
      id: 'chat.second-direction',
      title: 'Second direction',
      contentHash: 'd'.repeat(64),
    };
    const secondMessage = {
      ...messagesFixture[0],
      id: 'message.second-assistant',
      chatId: secondChat.id,
      sequence: 2,
      role: 'assistant' as const,
      status: 'completed' as const,
      originatingRunId: 'run.second-direction',
      originatingImportedRunId: null,
      blocks: [
        { type: 'text' as const, text: 'Second Chat should not replace the visible transcript.' },
      ],
      contentHash: 'e'.repeat(64),
    };
    fixture.calls.chatList.mockImplementation(async (request) => ({
      wireVersion: 1 as const,
      kind: 'success' as const,
      requestId: request.requestId,
      method: 'chat.list' as const,
      result: { items: [chatFixture, secondChat], nextCursor: null },
    }));
    fixture.calls.messageList.mockImplementation(async (request) =>
      messageListResponse(
        request,
        request.input.chatId === secondChat.id
          ? { items: [secondMessage], nextCursor: null }
          : { items: messagesFixture, nextCursor: null },
      ),
    );
    fixture.calls.runGet.mockImplementation(async (request) => {
      if (request.input.runId === 'run.second-direction') {
        throw new Error('Second Run authority is unavailable.');
      }
      return runResponse(request, runFixture);
    });

    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.transcript-atomic'} />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Generating four opening-direction candidates.')).toBeTruthy();
    const chatSelector = screen.getByRole('combobox', { name: 'Current Chat' });
    fireEvent.change(chatSelector, { target: { value: secondChat.id } });

    expect(await screen.findByText('Second Run authority is unavailable.')).toBeTruthy();
    expect((chatSelector as HTMLSelectElement).value).toBe(chatFixture.id);
    expect(
      screen.getByText(
        'Explore opening direction options for Shot 04. Keep the tone moody and grounded.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Generating four opening-direction candidates.')).toBeTruthy();
    expect(screen.queryByText('Second Chat should not replace the visible transcript.')).toBeNull();
  });

  it('canonicalizes invalid workspace routes while preserving the query', async () => {
    const fixture = createDesktopApiFixture();
    render(
      <MemoryRouter
        initialEntries={['/projects/project.blue-hour/invalid?chat=chat.opening-direction']}
      >
        <LocationProbe />
        <App api={fixture.api} createRequestId={() => 'request.ui.workspace-canonical'} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { level: 1, name: 'Blue Hour' })).toBeTruthy();
    expect(screen.getByTestId('route-location').textContent).toBe(
      '/projects/project.blue-hour/overview?chat=chat.opening-direction',
    );
  });

  it('opens a Project at overview when its stored workspace is invalid', async () => {
    const fixture = createDesktopApiFixture();
    localStorage.setItem(`lucid-fin:last-workspace:${projectFixture.id}`, 'obsolete-workspace');
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <LocationProbe />
        <App api={fixture.api} createRequestId={() => 'request.ui.stored-workspace'} />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Open Blue Hour' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Blue Hour' })).toBeTruthy();
    expect(screen.getByTestId('route-location').textContent).toBe(
      '/projects/project.blue-hour/overview',
    );
  });

  it('searches every Chat and Message page instead of silently stopping at page one', async () => {
    const fixture = createDesktopApiFixture();
    const secondChat = {
      ...chatFixture,
      id: 'chat.search-page-two',
      title: 'Search page two',
      contentHash: 'd'.repeat(64),
    };
    const remoteMessage = {
      ...messagesFixture[0],
      id: 'message.search-page-two',
      chatId: secondChat.id,
      sequence: 2,
      contentHash: 'e'.repeat(64),
      blocks: [{ type: 'text' as const, text: 'Remote needle on the final page.' }],
    };
    fixture.calls.chatList.mockImplementation(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'chat.list',
      result:
        request.input.page.cursor === null
          ? { items: [chatFixture], nextCursor: 'cursor.chat.search.2' }
          : { items: [secondChat], nextCursor: null },
    }));
    fixture.calls.messageList.mockImplementation(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'message.list',
      result:
        request.input.chatId !== secondChat.id
          ? { items: messagesFixture, nextCursor: null }
          : request.input.page.cursor === null
            ? { items: [], nextCursor: 'cursor.message.search.2' }
            : { items: [remoteMessage], nextCursor: null },
    }));
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.complete-search'} />
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { level: 1, name: 'Blue Hour' });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.change(screen.getByPlaceholderText('Search this Project’s Chats and messages'), {
      target: { value: 'remote needle' },
    });

    expect(
      await screen.findByRole('button', { name: /Remote needle on the final page/ }),
    ).toBeTruthy();
    expect(
      fixture.calls.chatList.mock.calls.some(
        ([request]) => request.input.page.cursor === 'cursor.chat.search.2',
      ),
    ).toBe(true);
    expect(
      fixture.calls.messageList.mock.calls.some(
        ([request]) => request.input.page.cursor === 'cursor.message.search.2',
      ),
    ).toBe(true);
  });
});
