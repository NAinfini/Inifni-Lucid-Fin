// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Canvas, CanvasNode } from '@lucid-fin/contracts';
import { Provider } from 'react-redux';
import { VirtuosoMockContext } from 'react-virtuoso';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommanderPanel } from './CommanderPanel.js';
import { canvasSlice, setActiveCanvas } from '../../store/slices/canvas/canvas.js';
import { charactersSlice } from '../../store/slices/characters.js';
import {
  commanderSlice,
  type CommanderMessage,
  type CommanderState,
} from '../../store/slices/commander.js';
import {
  appendEvent,
  commanderTimelineSlice,
} from '../../commander/state/commander-timeline-slice.js';
import { createCommanderSession } from '../../commander/state/index.js';
import { setBootstrapped, settingsSlice } from '../../store/slices/settings.js';
import { taskListsSlice } from '../../store/slices/task-lists.js';
import { setLocale, t } from '../../i18n.js';

const commanderMocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  sendIntent: vi.fn(),
  cancel: vi.fn(),
  isStreaming: false,
}));

vi.mock('../../hooks/useCommander.js', () => ({
  useCommander: () => ({
    sendMessage: commanderMocks.sendMessage,
    sendIntent: commanderMocks.sendIntent,
    cancel: commanderMocks.cancel,
    isStreaming: commanderMocks.isStreaming,
  }),
}));

vi.mock('../../utils/api.js', () => ({
  getAPI: vi.fn(() => null),
}));

function createCanvasNode(overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id: 'node-1',
    type: 'image',
    title: 'Opening Shot',
    position: { x: 0, y: 0 },
    bypassed: false,
    locked: false,
    width: 320,
    height: 180,
    createdAt: 1,
    updatedAt: 1,
    data: {
      status: 'empty',
      progress: 0,
      variants: [],
      selectedVariantIndex: 0,
    },
    ...overrides,
  };
}

function createCanvas(nodes: CanvasNode[] = [], overrides: Partial<Canvas> = {}): Canvas {
  return {
    id: 'canvas-1',
    name: 'Commander Test Canvas',
    nodes,
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    createdAt: 1,
    updatedAt: 1,
    notes: [],
    ...overrides,
  };
}

function renderCommanderPanel(
  messages: CommanderMessage[],
  canvases: Canvas[] = [createCanvas()],
  options?: { bootstrapped?: boolean; commanderState?: CommanderState },
) {
  const session = createCommanderSession('session-1', canvases[0]?.id ?? null, 1);
  session.messages = messages;
  const suppliedSessions = options?.commanderState?.sessions;
  const sessions = suppliedSessions?.length ? suppliedSessions : [session];
  const store = configureStore({
    reducer: {
      canvas: canvasSlice.reducer,
      characters: charactersSlice.reducer,
      commander: commanderSlice.reducer,
      commanderTimeline: commanderTimelineSlice.reducer,
      settings: settingsSlice.reducer,
      taskLists: taskListsSlice.reducer,
    },
    preloadedState: {
      commander: {
        ...commanderSlice.getInitialState(),
        ...options?.commanderState,
        open: true,
        activeSessionId: options?.commanderState?.activeSessionId ?? sessions[0]?.id ?? null,
        sessions,
      },
    },
  });
  store.dispatch(canvasSlice.actions.setCanvases(canvases));
  store.dispatch(setActiveCanvas(canvases[0]?.id ?? null));
  if (options?.bootstrapped ?? true) {
    store.dispatch(setBootstrapped());
  }

  const result = render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 240, itemHeight: 28 }}>
      <Provider store={store}>
        <CommanderPanel />
      </Provider>
    </VirtuosoMockContext.Provider>,
  );

  return { store, ...result };
}

describe('CommanderPanel', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1_600 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1_200 });
    if (!HTMLElement.prototype.scrollBy) {
      Object.defineProperty(HTMLElement.prototype, 'scrollBy', {
        configurable: true,
        value: () => undefined,
      });
    }
    setLocale('en-US');
    commanderMocks.isStreaming = false;
    commanderMocks.sendMessage.mockReset();
    commanderMocks.sendMessage.mockResolvedValue(true);
    commanderMocks.sendIntent.mockReset();
    commanderMocks.sendIntent.mockResolvedValue(true);
    commanderMocks.cancel.mockReset();
  });

  afterEach(cleanup);

  it('automatically sends a queued message while Commander is idle', async () => {
    const { store } = renderCommanderPanel([]);
    const queuedMessage = 'Create durable media for node-1';

    act(() => {
      store.dispatch(
        commanderSlice.actions.enqueueMessage({ sessionId: 'session-1', content: queuedMessage }),
      );
    });

    await waitFor(() => expect(commanderMocks.sendMessage).toHaveBeenCalledWith(queuedMessage));
    await waitFor(() =>
      expect(store.getState().commander.sessions[0]?.runtime.messageQueue).toEqual([]),
    );
  });

  it('keeps a queued message while Commander is streaming, then sends it when idle', async () => {
    commanderMocks.isStreaming = true;
    const { store, rerender } = renderCommanderPanel([]);
    const queuedMessage = 'Cancel durable media for node-1';

    act(() => {
      store.dispatch(
        commanderSlice.actions.enqueueMessage({ sessionId: 'session-1', content: queuedMessage }),
      );
    });

    expect(commanderMocks.sendMessage).not.toHaveBeenCalled();
    expect(store.getState().commander.sessions[0]?.runtime.messageQueue).toHaveLength(1);

    commanderMocks.isStreaming = false;
    rerender(
      <Provider store={store}>
        <CommanderPanel />
      </Provider>,
    );

    await waitFor(() => expect(commanderMocks.sendMessage).toHaveBeenCalledWith(queuedMessage));
    await waitFor(() =>
      expect(store.getState().commander.sessions[0]?.runtime.messageQueue).toEqual([]),
    );
  });

  it('attaches an extra Canvas only to the next submitted message', async () => {
    const defaultCanvas = createCanvas([], { id: 'canvas-default', name: 'Default Canvas' });
    const referenceCanvas = createCanvas([], {
      id: 'canvas-reference',
      name: 'Reference Canvas',
    });
    renderCommanderPanel([], [defaultCanvas, referenceCanvas]);

    fireEvent.click(screen.getByRole('button', { name: 'Add context' }));
    const contextMenu = screen.getByRole('group', { name: 'Add context' });
    expect(within(contextMenu).queryByRole('button', { name: 'Default Canvas' })).toBeNull();
    fireEvent.click(within(contextMenu).getByRole('button', { name: 'Reference Canvas' }));
    expect(screen.getByText('Canvas: Reference Canvas')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText(/Message Commander AI/), {
      target: { value: 'Compare the visual direction' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() =>
      expect(commanderMocks.sendMessage).toHaveBeenCalledWith('Compare the visual direction', {
        attachments: [],
        selectedNodes: [],
        extraCanvasIds: ['canvas-reference'],
      }),
    );
    await waitFor(() => expect(screen.queryByText('Canvas: Reference Canvas')).toBeNull());
  });

  it('stores one-message Canvas context on a queued message and clears the chip', () => {
    commanderMocks.isStreaming = true;
    const defaultCanvas = createCanvas([], { id: 'canvas-default', name: 'Default Canvas' });
    const referenceCanvas = createCanvas([], {
      id: 'canvas-reference',
      name: 'Reference Canvas',
    });
    const { store } = renderCommanderPanel([], [defaultCanvas, referenceCanvas]);

    fireEvent.click(screen.getByRole('button', { name: 'Add context' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reference Canvas' }));
    fireEvent.change(screen.getByPlaceholderText(/Message Commander AI/), {
      target: { value: 'Queue with reference context' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));

    expect(store.getState().commander.sessions[0]?.runtime.messageQueue[0]).toMatchObject({
      content: 'Queue with reference context',
      extraCanvasIds: ['canvas-reference'],
    });
    expect(screen.queryByText('Canvas: Reference Canvas')).toBeNull();
  });

  it('localizes the one-message Canvas context chooser', async () => {
    setLocale('zh-CN');
    const defaultCanvas = createCanvas([], { id: 'canvas-default', name: '默认项目' });
    const referenceCanvas = createCanvas([], { id: 'canvas-reference', name: '参考项目' });
    renderCommanderPanel([], [defaultCanvas, referenceCanvas]);

    fireEvent.click(screen.getByRole('button', { name: '添加上下文' }));

    expect(await screen.findByText('画布上下文')).toBeTruthy();
    expect(screen.getByText('仅用于本次运行')).toBeTruthy();
    expect(screen.getByRole('button', { name: '参考项目' })).toBeTruthy();
  });

  it('mounts only a virtual queue window for a large queued-message run', async () => {
    commanderMocks.isStreaming = true;
    const queuedSession = createCommanderSession('session-1', 'canvas-1', 1);
    queuedSession.runtime.messageQueue = Array.from({ length: 10_000 }, (_, index) => ({
      id: `queue-${index}`,
      content: `Queue item ${index}`,
    }));
    const queuedCommanderState: CommanderState = {
      ...commanderSlice.getInitialState(),
      activeSessionId: queuedSession.id,
      sessions: [queuedSession],
    };
    const { container } = renderCommanderPanel([], [createCanvas()], {
      commanderState: queuedCommanderState,
    });

    await waitFor(() => expect(screen.getByText('1. Queue item 0')).toBeTruthy());
    const queueRows = [...container.querySelectorAll('footer span')].filter((element) =>
      /^\d+\. Queue item \d+$/.test(element.textContent ?? ''),
    );
    expect(queueRows.length).toBeLessThan(100);
  });

  it('renders a top action strip inside assistant bubbles for copy actions', () => {
    renderCommanderPanel([
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Assistant copy target',
        timestamp: Date.now(),
      },
    ]);

    const bubble = screen.getByText('Assistant copy target').closest('article');
    expect(bubble).toBeTruthy();

    const actionStrip = within(bubble as HTMLElement).getByTestId(
      'commander-message-actions-assistant-1',
    );
    const copyButton = within(actionStrip).getByRole('button');

    expect(actionStrip.contains(copyButton)).toBe(true);
    expect(bubble?.contains(actionStrip)).toBe(true);
  });

  it('does not expose raw tool arguments or results in conversation history', () => {
    renderCommanderPanel(
      [
        {
          id: 'assistant-2',
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'tool-1',
              name: 'canvas.configureNode',
              summary: 'Configure one node',
              details: { canvasId: 'canvas-1', nodeId: 'node-1' },
              artifacts: [{ kind: 'canvas_node', id: 'node-1', label: 'Opening Shot' }],
              startedAt: 1,
              completedAt: 2,
              status: 'done',
            },
          ],
          timestamp: Date.now(),
        },
      ],
      [createCanvas([createCanvasNode({ id: 'node-1', title: 'Opening Shot' })])],
    );

    expect(screen.queryByText(/Configure Node/i)).toBeNull();
    expect(screen.queryByText(/Opening Shot \(node-1\)/)).toBeNull();
    expect(screen.queryByText(/providerId/)).toBeNull();
  });

  it('keeps horizontal overflow clipped to the message pane while allowing message text to wrap', () => {
    const { container } = renderCommanderPanel([
      {
        id: 'assistant-overflow',
        role: 'assistant',
        content:
          'averyveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryveryverylongtoken',
        timestamp: Date.now(),
      },
    ]);

    const messageScroll = container.querySelector('[data-testid="commander-message-scroll"]');
    const markdown = container.querySelector('[data-testid="markdown"]');

    expect(messageScroll?.className).toContain('overflow-x-hidden');
    expect(markdown?.className).toContain('break-words');
  });

  it('renders historical question messages as a localized question card', () => {
    setLocale('zh-CN');

    const historyQuestionMessage = {
      id: 'assistant-question',
      role: 'assistant',
      content:
        'Which relationship should we show?\n\n- Pure warmth: Keep it subtle\n- Clear confession: Be direct',
      timestamp: Date.now(),
    } as CommanderMessage & {
      questionMeta: {
        question: string;
        options: Array<{ label: string; description?: string }>;
      };
    };

    historyQuestionMessage.questionMeta = {
      question: '再定一下情感表达强度：你想要哪种关系呈现?',
      options: [
        { label: '纯爱暖味', description: '轻微暧昧，点到为止' },
        { label: '明确告白', description: '情感更直接' },
      ],
    };

    renderCommanderPanel([historyQuestionMessage]);

    expect(screen.getByText('需要你的选择')).toBeTruthy();
    expect(screen.getByText('再定一下情感表达强度：你想要哪种关系呈现?')).toBeTruthy();
    expect(screen.getByText('纯爱暖味')).toBeTruthy();
    expect(screen.getByText('明确告白')).toBeTruthy();
    expect(screen.queryByText(/^Question:/)).toBeNull();
  });
  it('disables chat input and send button until bootstrap finishes', () => {
    const { container } = renderCommanderPanel([], [createCanvas()], { bootstrapped: false });

    const input = container.querySelector(
      'textarea[placeholder="Message Commander AI... (/ for commands)"]',
    );
    const sendButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Send',
    );

    expect(input instanceof HTMLTextAreaElement).toBe(true);
    expect(input && (input as HTMLTextAreaElement).disabled).toBe(true);
    expect(sendButton instanceof HTMLButtonElement).toBe(true);
    expect(sendButton && (sendButton as HTMLButtonElement).disabled).toBe(true);
    expect(sendButton?.getAttribute('title')).toBe(
      'Commander backend is still starting. Wait for the app to finish loading and try again.',
    );
  });

  it('keeps a visible command entry point that opens the slash-command list', () => {
    const { container } = renderCommanderPanel([]);

    const commands = within(container).getByRole('button', { name: 'Commands' });
    fireEvent.click(commands);

    expect(within(container).getByText('Compact context')).toBeTruthy();
    expect(within(container).queryByText('New session')).toBeNull();
  });

  it('renders an active askUser prompt inside the chat scroll area', () => {
    const { container, store } = renderCommanderPanel([]);
    const previewAssetHash = 'c'.repeat(64);

    act(() => {
      store.dispatch(
        appendEvent({
          sessionId: 'session-1',
          event: {
            kind: 'run_start',
            workType: 'agent',
            runId: 'run-question',
            step: 1,
            seq: 0,
            emittedAt: 1,
            intent: 'create',
            resourceBudget: {},
          },
        }),
      );
      store.dispatch(
        appendEvent({
          sessionId: 'session-1',
          event: {
            kind: 'question_prompt',
            runId: 'run-question',
            step: 1,
            seq: 1,
            emittedAt: 2,
            questionId: 'question-1',
            prompt: 'Choose a visual direction',
            options: [
              { id: 'warm', label: 'Warm', previewAssetHash },
              { id: 'cool', label: 'Cool' },
            ],
            allowFreeText: false,
          },
        }),
      );
    });

    const messageScroll = within(container).getByTestId('commander-message-scroll');
    expect(within(messageScroll).getByText('Choose a visual direction')).toBeTruthy();
    expect(within(messageScroll).getByRole('button', { name: 'Warm' })).toBeTruthy();
    expect(within(messageScroll).getByRole('img', { name: 'Warm' }).getAttribute('src')).toBe(
      `lucid-asset://${previewAssetHash}/image/png`,
    );
  });

  it('renders as a floating window and minimizes in place', () => {
    const { container } = renderCommanderPanel([]);
    const panelView = within(container);
    const commanderLabel = t('commander.commanderAI');

    const panel = panelView.getByRole('region', { name: commanderLabel });
    expect(panel.className).toContain('fixed');
    expect(panel.style.width).toBe('520px');
    expect(panel.style.height).toBe('720px');

    fireEvent.click(panelView.getByRole('button', { name: 'Minimize' }));

    expect(panelView.queryByRole('region', { name: commanderLabel })).toBeNull();
    expect(panelView.getByRole('button', { name: commanderLabel })).toBeTruthy();
  });

  it('hides Commander without cancelling an active run', () => {
    commanderMocks.isStreaming = true;
    const { store } = renderCommanderPanel([]);

    fireEvent.click(screen.getByRole('button', { name: t('commander.close') }));

    expect(store.getState().commander.open).toBe(false);
    expect(commanderMocks.cancel).not.toHaveBeenCalled();
  });

  it('lets the minimized Commander pill move without reopening it', () => {
    const { container, store } = renderCommanderPanel([]);
    const panelView = within(container);
    fireEvent.click(panelView.getByRole('button', { name: 'Minimize' }));

    const pill = panelView.getByRole('button', { name: t('commander.commanderAI') });
    fireEvent.mouseDown(pill, { button: 0, clientX: 34, clientY: 106 });
    fireEvent.mouseMove(document, { clientX: 154, clientY: 236 });
    fireEvent.mouseUp(document);

    expect(store.getState().commander.position).toEqual({ x: 144, y: 226 });
    fireEvent.click(pill);
    expect(store.getState().commander.minimized).toBe(true);
    fireEvent.click(pill);
    expect(store.getState().commander.minimized).toBe(false);
  });

  it('uses one conversation column without a separate run activity panel', () => {
    const { container } = renderCommanderPanel([]);
    const panel = within(container).getByRole('region', { name: t('commander.commanderAI') });

    expect(panel.style.left).toBe('24px');
    expect(panel.style.width).toBe('520px');
    expect(within(container).queryByTestId('commander-run-activity')).toBeNull();
    expect(within(container).getByPlaceholderText(/Message Commander AI/)).toBeTruthy();
  });

  it('keeps new-chat management in the persistent chat sidebar', () => {
    const { container } = renderCommanderPanel([]);

    expect(within(container).queryByRole('button', { name: 'New chat' })).toBeNull();
    expect(within(container).queryByRole('button', { name: 'Clear history' })).toBeNull();
  });

  it('does not surface raw run steps after completion', () => {
    const completedTool = {
      id: 'tool-step-1',
      name: 'canvas.getNodes',
      summary: 'Read canvas nodes',
      details: { canvasId: 'canvas-1' },
      startedAt: 1_100,
      completedAt: 1_500,
      status: 'done' as const,
    };
    const message: CommanderMessage = {
      id: 'assistant-stepped-run',
      role: 'assistant',
      content: 'The plan is ready.',
      timestamp: 2_000,
      segments: [
        { kind: 'step_marker', id: 'step-1', step: 1, at: 1_000 },
        { kind: 'tool', id: 'step-1-tool', toolCall: completedTool },
        { kind: 'step_marker', id: 'step-2', step: 2, at: 1_600 },
        {
          kind: 'progress',
          id: 'step-2-progress',
          operationId: 'model:2',
          status: 'completed',
          summary: 'Preparing the answer.',
        },
        { kind: 'text', id: 'step-2-text', content: 'The plan is ready.' },
      ],
      toolCalls: [completedTool],
      runMeta: {
        status: 'completed',
        collapsed: true,
        startedAt: 1_000,
        completedAt: 2_000,
        summary: {
          excerpt: 'The plan is ready.',
          toolCount: 1,
          failedToolCount: 0,
          durationMs: 1_000,
        },
      },
    };
    const { container } = renderCommanderPanel([message]);

    expect(within(container).queryByRole('button', { name: /Step 1/i })).toBeNull();
    expect(within(container).queryByText('Preparing the answer.')).toBeNull();
    expect(within(container).getByText('The plan is ready.')).toBeTruthy();
  });
});
