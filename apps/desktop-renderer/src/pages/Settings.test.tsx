// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { Settings } from './Settings.js';
import { addCustomProvider, settingsSlice, type SettingsState } from '../store/slices/settings.js';
import { skillDefinitionsSlice, setCustomContent } from '../store/slices/skillDefinitions.js';
import { uiSlice } from '../store/slices/ui.js';
import { commanderSlice } from '../store/slices/commander.js';
import { getAPI } from '../utils/api.js';
import { setLocale, t } from '../i18n.js';

vi.mock('../utils/api.js', () => ({ getAPI: vi.fn(() => null) }));

/** onReady fires callback immediately (simulates app already initialized) */
function mockOnReady() {
  return vi.fn((cb: () => void) => { cb(); return () => {}; });
}

type UpdateStatus =
  | { state: 'idle' | 'checking' }
  | { state: 'available' | 'downloaded'; info: { version: string } }
  | { state: 'downloading'; progress?: number; info?: { version: string } }
  | { state: 'error'; error?: string };

function createStore(preloadedSettings?: SettingsState) {
  return configureStore({
    reducer: {
      settings: settingsSlice.reducer,
      skillDefinitions: skillDefinitionsSlice.reducer,
      ui: uiSlice.reducer,
      commander: commanderSlice.reducer,
    },
    preloadedState: preloadedSettings ? { settings: preloadedSettings } : undefined,
  });
}

function renderSettings(store = createStore()) {
  render(
    <Provider store={store}>
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    </Provider>,
  );

  return store;
}

function findProviderCard(title: string): HTMLElement {
  const card = screen.getAllByText(new RegExp(`^${title}$`))[0]?.closest('div.rounded-md.border');
  if (!(card instanceof HTMLElement)) {
    throw new Error(`Could not find provider card for ${title}`);
  }
  return card;
}

describe('Settings updater UI', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    setLocale('en-US');
  });

  it('renders the about and updates section', async () => {
    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        check: vi.fn().mockResolvedValue(undefined),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
    } as unknown as ReturnType<typeof getAPI>);

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'About' }));

    await waitFor(() => {
      expect(screen.getAllByText('About and Updates').length).toBeGreaterThan(0);
      expect(screen.getByText('Version 1.2.3')).toBeTruthy();
      // Auto-check is triggered on mount, so we see either checking or upToDate
      expect(screen.getByText('Lucid Fin')).toBeTruthy();
    });
  });

  it('shows the merged guides surface from the sidebar navigation', async () => {
    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
    } as unknown as ReturnType<typeof getAPI>);

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Guides' }));

    await waitFor(() => {
      expect(screen.getAllByText('Guides').length).toBeGreaterThan(0);
      expect(screen.getByRole('button', { name: 'Add Template' })).toBeTruthy();
      expect(screen.getByText('Meta-Prompt (AI Instructor)')).toBeTruthy();
      expect(screen.getByText('Story Idea → Video')).toBeTruthy();
    });
  });

  it('shows the process guides section from the sidebar navigation', async () => {
    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
      },
      processPrompt: {
        list: vi.fn().mockResolvedValue([
          {
            processKey: 'character-ref-image-generation',
            name: 'Character Reference Image Generation',
            description: 'Guidance for character reference image creation.',
            defaultValue: 'Default rules',
            customValue: null,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            processKey: 'location-ref-image-generation',
            name: 'Location Reference Image Generation',
            description: 'Guidance for location reference image creation.',
            defaultValue: 'Default rules',
            customValue: null,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            processKey: 'equipment-ref-image-generation',
            name: 'Equipment Reference Image Generation',
            description: 'Guidance for equipment reference image creation.',
            defaultValue: 'Default rules',
            customValue: null,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            processKey: 'character-management',
            name: 'Character Management',
            description: 'Guidance for character CRUD work.',
            defaultValue: 'Default rules',
            customValue: null,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            processKey: 'node-preset-tracks',
            name: 'Node Preset Tracks',
            description: 'Guidance for node-level preset track work.',
            defaultValue: 'Default rules',
            customValue: null,
            createdAt: 1,
            updatedAt: 1,
          },
          {
            processKey: 'provider-management',
            name: 'Provider Management',
            description: 'Guidance for provider setup and capability checks.',
            defaultValue: 'Default rules',
            customValue: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ]),
        get: vi.fn(),
        setCustom: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn().mockResolvedValue(undefined),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
    } as unknown as ReturnType<typeof getAPI>);

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Process Injection' }));

    await waitFor(() => {
      expect(screen.getAllByText('Process Injection').length).toBeGreaterThan(0);
      expect(screen.getByText(t('settings.processGuides.subtitle'))).toBeTruthy();
      expect(screen.getByText('Character Reference Image Generation')).toBeTruthy();
      expect(screen.getByText('Location Reference Image Generation')).toBeTruthy();
      expect(screen.getByText('Equipment Reference Image Generation')).toBeTruthy();
      expect(screen.getByText('Character Management')).toBeTruthy();
      expect(screen.getByText('Node Preset Tracks')).toBeTruthy();
      expect(screen.getByText('Provider Management')).toBeTruthy();
      expect(screen.getAllByText(t('settings.processGuides.triggeredBy'))).toHaveLength(6);
      expect(screen.getByText('character.generateRefImage')).toBeTruthy();
      expect(screen.getByText('location.generateRefImage')).toBeTruthy();
      expect(screen.getByText('equipment.generateRefImage')).toBeTruthy();
      expect(screen.getByText('character.create')).toBeTruthy();
      expect(screen.getByText('canvas.writePresetTracksBatch')).toBeTruthy();
      expect(screen.getByText('provider.list')).toBeTruthy();
    });
  });

  it('renders only one in-panel process guides header block', async () => {
    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
      },
      processPrompt: {
        list: vi.fn().mockResolvedValue([
          {
            processKey: 'image-node-generation',
            name: 'Image Node Generation',
            description: 'Prompt compilation for image nodes.',
            defaultValue: 'Default rules',
            customValue: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ]),
        get: vi.fn(),
        setCustom: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn().mockResolvedValue(undefined),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
    } as unknown as ReturnType<typeof getAPI>);

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Process Injection' }));

    await waitFor(() => {
      expect(screen.getByText('Image Node Generation')).toBeTruthy();
    });

    expect(screen.getAllByText('Process Injection')).toHaveLength(2);
  });

  it.skip('localizes workflow section title, subtitle, badges, and built-in workflow names in zh-CN', async () => {
    setLocale('zh-CN');

    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
    } as unknown as ReturnType<typeof getAPI>);

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: t('settings.nav.workflows') }));

    await waitFor(() => {
      expect(screen.getByText(t('workflowDefinitionNames.wf-video-clone'))).toBeTruthy();
      expect(screen.getByText(t('workflowDefinitionNames.wf-style-transfer'))).toBeTruthy();
      expect(screen.getByText(t('workflowDefinitionNames.sk-reverse-prompt'))).toBeTruthy();
      expect(screen.getByText(t('workflowDefinitionNames.sk-lip-sync'))).toBeTruthy();
      expect(screen.getByText(t('workflowDefinitionNames.sk-srt-import'))).toBeTruthy();
      expect(screen.getByText(t('workflowDefinitionNames.sk-capcut-export'))).toBeTruthy();
      expect(screen.getByText(t('workflowDefinitionNames.sk-semantic-search'))).toBeTruthy();
      expect(screen.getByText(t('workflowDefinitionNames.sk-multi-view'))).toBeTruthy();
      expect(screen.queryByText(t('promptTemplateNames.video-clone'))).toBeNull();
      expect(screen.queryByText(t('promptTemplateNames.dual-prompt-strategy'))).toBeNull();
      expect(screen.queryByText(t('promptTemplateNames.lip-sync-workflow'))).toBeNull();
    });

    const builtInSkillButton = screen
      .getByText(t('workflowDefinitionNames.sk-reverse-prompt'))
      .closest('button') as HTMLElement | null;
    expect(builtInSkillButton).toBeTruthy();
    expect(within(builtInSkillButton as HTMLElement).getByText(t('settings.builtIn'))).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('工作流与技能')).toBeTruthy();
      expect(screen.getByText('专门管理工作流和技能的空间。')).toBeTruthy();
      expect(screen.getByText('故事创意 → 视频')).toBeTruthy();
      expect(screen.getByText('小说/书籍 → 视频')).toBeTruthy();
      expect(screen.getAllByText('工作流').length).toBeGreaterThan(0);
      expect(screen.getAllByText('内置').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByText(t('workflowDefinitionNames.wf-video-clone')).closest('button')!);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: t('action.close') })).toBeTruthy();
    });
  });

  it.skip('does not render prompt-template skills inside the workflows settings tab', async () => {
    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
    } as unknown as ReturnType<typeof getAPI>);

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Workflows' }));

    await waitFor(() => {
      expect(screen.getAllByText('Workflows & Skills').length).toBeGreaterThan(0);
      expect(screen.getByText('Reverse Prompt Inference')).toBeTruthy();
      expect(screen.queryByText('Style Transfer')).toBeNull();
      expect(screen.queryByText('Shot List from Script')).toBeNull();
      expect(screen.queryByText('Dual Prompt Strategy')).toBeNull();
    });
  });

  it('localizes the merged guides tab in zh-CN and shows both template and workflow guides', async () => {
    setLocale('zh-CN');

    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
    } as unknown as ReturnType<typeof getAPI>);

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: t('settings.nav.guides') }));

    await waitFor(() => {
      expect(screen.getAllByText(t('settings.guides.title')).length).toBeGreaterThan(0);
      expect(screen.getByText(t('settings.guides.subtitle'))).toBeTruthy();
      expect(screen.getByText('Video Clone → Remake')).toBeTruthy();
      expect(screen.getByText('Reverse Prompt Inference')).toBeTruthy();
      expect(screen.getAllByText(t('settings.builtIn')).length).toBeGreaterThan(0);
    });
  });

  it('renders prompt-template skills inside the merged guides tab', async () => {
    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
    } as unknown as ReturnType<typeof getAPI>);

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Guides' }));

    await waitFor(() => {
      expect(screen.getAllByText('Guides').length).toBeGreaterThan(0);
      expect(screen.getByText('Reverse Prompt Inference')).toBeTruthy();
      expect(screen.getByText('Style Transfer')).toBeTruthy();
      expect(screen.getByText('Shot List from Script')).toBeTruthy();
      expect(screen.getByText('Dual Prompt Strategy')).toBeTruthy();
    });
  });

  it('saves renamed prompt templates from the guides tab', async () => {
    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
    } as unknown as ReturnType<typeof getAPI>);

    const store = renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'Guides' }));
    fireEvent.click(screen.getByText('Meta-Prompt (AI Instructor)').closest('button')!);

    const nameInput = await screen.findByDisplayValue('Meta-Prompt (AI Instructor)');
    fireEvent.change(nameInput, { target: { value: 'Director Notes' } });

    const contentEditor = screen
      .getAllByRole('textbox')
      .find((element) => element.tagName === 'TEXTAREA');
    expect(contentEditor).toBeTruthy();

    fireEvent.change(contentEditor as HTMLElement, {
      target: { value: 'Custom prompt template content' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const updatedSkill = store
      .getState()
      .skillDefinitions.skills.find((skill: { id: string }) => skill.id === 'meta-prompt');

    expect(updatedSkill).toEqual(
      expect.objectContaining({
        id: 'meta-prompt',
        name: 'Director Notes',
        customContent: 'Custom prompt template content',
      }),
    );
    expect(screen.getByText('Director Notes')).toBeTruthy();
  });

  it('shows customized badges for guides in zh-CN', async () => {
    setLocale('zh-CN');

    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
    } as unknown as ReturnType<typeof getAPI>);

    const store = createStore();
    store.dispatch(setCustomContent({ id: 'meta-prompt', content: 'customized system prompt' }));
    store.dispatch(setCustomContent({ id: 'style-transfer', content: 'customized skill prompt' }));

    renderSettings(store);

    fireEvent.click(screen.getByRole('button', { name: t('settings.nav.guides') }));
    expect(screen.getAllByText(t('settings.customized')).length).toBeGreaterThan(0);
  });

  it('updates the UI when download progress events arrive', async () => {
    let onProgress: ((status: UpdateStatus) => void) | undefined;

    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
      },
      updater: {
        status: vi.fn().mockResolvedValue({
          state: 'available',
          info: { version: '2.0.0' },
        } satisfies UpdateStatus),
        onProgress: vi.fn((cb: (status: UpdateStatus) => void) => {
          onProgress = cb;
          return () => {};
        }),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
    } as unknown as ReturnType<typeof getAPI>);

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: 'About' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
    });

    onProgress?.({
      state: 'downloading',
      progress: 42,
      info: { version: '2.0.0' },
    });

    await waitFor(() => {
      expect(screen.getByText('Downloading...')).toBeTruthy();
      expect(screen.getByText('42%')).toBeTruthy();
    });
  });

  it('groups built-in providers by kind and opens hub model docs from registry metadata', async () => {
    const openExternal = vi.fn();

    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        test: vi.fn().mockResolvedValue({ ok: false }),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
      openExternal,
    } as unknown as ReturnType<typeof getAPI>);

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /Providers/i }));

    await waitFor(() => {
      expect(screen.getAllByText('Official Providers')).toHaveLength(1);
      expect(screen.getAllByText('API Hubs')).toHaveLength(1);
    });

    expect(screen.queryAllByLabelText('Active')).toHaveLength(0);

    const openRouterCard = findProviderCard('OpenRouter');
    fireEvent.click(within(openRouterCard).getByLabelText('Expand'));

    await waitFor(() => {
      expect(screen.getByText('Example: openai/gpt-5.4')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'View Models' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'View Models' }));
    expect(openExternal).toHaveBeenCalledWith(
      'https://openrouter.ai/docs/api-reference/chat-completion',
    );
  });

  it('loads, copies, updates, and clears an existing API key', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const isConfigured = vi
      .fn()
      .mockImplementation(async (provider: string) => provider === 'openai');
    const getKey = vi.fn().mockResolvedValue('sk-live-old');
    const setKey = vi.fn().mockResolvedValue(undefined);
    const deleteKey = vi.fn().mockResolvedValue(undefined);

    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured,
        get: getKey,
        set: setKey,
        delete: deleteKey,
        test: vi.fn().mockResolvedValue({ ok: true }),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
      openExternal: vi.fn(),
    } as unknown as ReturnType<typeof getAPI>);

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /Providers/i }));

    await waitFor(() => {
      expect(screen.getAllByText('Key set').length).toBeGreaterThan(0);
    });

    const openAiCard = findProviderCard('OpenAI');
    fireEvent.click(within(openAiCard).getByLabelText('Expand'));

    await waitFor(() => {
      expect(getKey).toHaveBeenCalledWith('openai');
      expect(screen.getByDisplayValue('sk-live-old')).toBeTruthy();
      expect(within(openAiCard).getByText('Configured in keychain')).toBeTruthy();
    });

    fireEvent.click(within(openAiCard).getByRole('button', { name: 'Copy Key' }));
    expect(writeText).toHaveBeenCalledWith('sk-live-old');

    const input = screen.getByDisplayValue('sk-live-old');
    fireEvent.change(input, { target: { value: 'sk-live-new' } });
    fireEvent.click(within(openAiCard).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(setKey).toHaveBeenCalledWith('openai', 'sk-live-new');
    });

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(within(openAiCard).getByRole('button', { name: /Save|Saved/ }));

    await waitFor(() => {
      expect(deleteKey).toHaveBeenCalledWith('openai');
    });

    await waitFor(() => {
      expect(within(openAiCard).queryByText('Configured in keychain')).toBeNull();
      expect(within(openAiCard).queryByText('Key set')).toBeNull();
      expect(within(openAiCard).getByText('No key')).toBeTruthy();
    });
  });

  it('allows resetting built-in provider endpoint and model back to defaults', async () => {
    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
      openExternal: vi.fn(),
    } as unknown as ReturnType<typeof getAPI>);

    const store = renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /Providers/i }));

    const openAiCard = findProviderCard('OpenAI');
    fireEvent.click(within(openAiCard).getByLabelText('Expand'));

    const endpointInput = await screen.findByDisplayValue('https://api.openai.com/v1');
    const modelInput = await screen.findByDisplayValue('gpt-5.4');

    fireEvent.change(endpointInput, { target: { value: 'https://proxy.example.com/v1' } });
    fireEvent.change(modelInput, { target: { value: 'gpt-5.4-mini' } });

    // Draft is dirty — Save is enabled; click Save to commit to Redux
    fireEvent.click(within(openAiCard).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(
        store.getState().settings.llm.providers.find((p) => p.id === 'openai')?.baseUrl,
      ).toBe('https://proxy.example.com/v1');
    });

    // Now committed state differs from defaults → Reset to Defaults appears
    await waitFor(() => {
      expect(within(openAiCard).getByRole('button', { name: 'Reset to Defaults' })).toBeTruthy();
    });

    fireEvent.click(within(openAiCard).getByRole('button', { name: 'Reset to Defaults' }));

    await waitFor(() => {
      expect(screen.getByDisplayValue('https://api.openai.com/v1')).toBeTruthy();
      expect(screen.getByDisplayValue('gpt-5.4')).toBeTruthy();
    });

    expect(
      store.getState().settings.llm.providers.find((provider) => provider.id === 'openai'),
    ).toMatchObject({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.4',
    });
  });

  it('localizes custom provider labels and saved state in zh-CN', async () => {
    setLocale('zh-CN');

    const isConfigured = vi
      .fn()
      .mockImplementation(async (provider: string) => provider === 'custom-llm-localized');
    const getKey = vi.fn().mockResolvedValue('sk-localized');
    const setKey = vi.fn().mockResolvedValue(undefined);

    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured,
        get: getKey,
        set: setKey,
        delete: vi.fn().mockResolvedValue(undefined),
        test: vi.fn().mockResolvedValue({ ok: true }),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
      openExternal: vi.fn(),
    } as unknown as ReturnType<typeof getAPI>);

    const store = createStore();
    store.dispatch(
      addCustomProvider({
        group: 'llm',
        id: 'custom-llm-localized',
        name: 'Local Proxy',
      }),
    );

    renderSettings(store);

    fireEvent.click(screen.getByRole('button', { name: t('settings.nav.providers') }));

    await waitFor(() => {
      expect(screen.getByText(t('settings.providerSections.custom'))).toBeTruthy();
    });

    const customCard = screen
      .getByText('Local Proxy')
      .closest('div.rounded-md.border') as HTMLElement | null;
    expect(customCard).toBeTruthy();
    const resolvedCustomCard = customCard as HTMLElement;
    fireEvent.click(within(resolvedCustomCard).getByLabelText(t('settings.providerCard.expand')));

    await waitFor(() => {
      expect(
        within(resolvedCustomCard).getByText(t('settings.providerCard.protocol')),
      ).toBeTruthy();
      expect(
        within(resolvedCustomCard).getByText(t('settings.providerCard.configuredInKeychain')),
      ).toBeTruthy();
    });

    const input = screen.getByDisplayValue('sk-localized');
    fireEvent.change(input, { target: { value: 'sk-localized-new' } });
    fireEvent.click(
      within(resolvedCustomCard).getByRole('button', { name: t('settings.providerCard.save') }),
    );

    await waitFor(() => {
      expect(setKey).toHaveBeenCalledWith('custom-llm-localized', 'sk-localized-new');
      expect(
        within(resolvedCustomCard).getByRole('button', { name: t('settings.providerCard.saved') }),
      ).toBeTruthy();
    });
  });

  it('keeps a newly saved API key in the field and re-hides it after saving', async () => {
    const setKey = vi.fn().mockResolvedValue(undefined);

    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
        get: vi.fn().mockResolvedValue(null),
        set: setKey,
        delete: vi.fn().mockResolvedValue(undefined),
        test: vi.fn().mockResolvedValue({ ok: true }),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
      openExternal: vi.fn(),
    } as unknown as ReturnType<typeof getAPI>);

    const store = createStore();
    store.dispatch(
      addCustomProvider({
        group: 'llm',
        id: 'custom-llm-new-key',
        name: 'Custom Proxy',
      }),
    );

    renderSettings(store);

    fireEvent.click(screen.getByRole('button', { name: /Providers/i }));

    const customCard = screen
      .getByText('Custom Proxy')
      .closest('div.rounded-md.border') as HTMLElement | null;
    expect(customCard).toBeTruthy();
    const resolvedCustomCard = customCard as HTMLElement;
    fireEvent.click(within(resolvedCustomCard).getByLabelText('Expand'));

    const input = await screen.findByPlaceholderText('sk-...');
    fireEvent.change(input, { target: { value: 'sk-live-added' } });
    fireEvent.click(within(resolvedCustomCard).getByRole('button', { name: '' }));
    expect((input as HTMLInputElement).type).toBe('text');
    fireEvent.click(within(resolvedCustomCard).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(setKey).toHaveBeenCalledWith('custom-llm-new-key', 'sk-live-added');
      expect(within(resolvedCustomCard).getByText('Configured in keychain')).toBeTruthy();
    });

    const savedInput = screen.getByDisplayValue('sk-live-added');
    expect((savedInput as HTMLInputElement).getAttribute('type')).toBe('password');
    expect((savedInput as HTMLInputElement).value).toBe('sk-live-added');
  });

  it('retries loading a configured custom provider key after a transient keychain read failure', async () => {
    const getKey = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary keychain failure'))
      .mockResolvedValueOnce('sk-refresh-loaded');

    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi
          .fn()
          .mockImplementation(async (provider: string) => provider === 'custom-llm-refresh'),
        get: getKey,
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        test: vi.fn().mockResolvedValue({ ok: true }),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
      openExternal: vi.fn(),
    } as unknown as ReturnType<typeof getAPI>);

    const store = createStore();
    store.dispatch(
      addCustomProvider({
        group: 'llm',
        id: 'custom-llm-refresh',
        name: 'Refresh Proxy',
      }),
    );

    renderSettings(store);

    fireEvent.click(screen.getByRole('button', { name: /Providers/i }));

    const customCard = screen
      .getByText('Refresh Proxy')
      .closest('div.rounded-md.border') as HTMLElement | null;
    expect(customCard).toBeTruthy();
    const resolvedCustomCard = customCard as HTMLElement;
    fireEvent.click(within(resolvedCustomCard).getByLabelText('Expand'));

    await waitFor(() => {
      expect(getKey).toHaveBeenCalledTimes(2);
      expect(screen.getByDisplayValue('sk-refresh-loaded')).toBeTruthy();
    });
  });

  it('shows localized names for China providers when locale is zh-CN', async () => {
    setLocale('zh-CN');

    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
    } as unknown as ReturnType<typeof getAPI>);

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: t('settings.nav.providers') }));

    await waitFor(() => {
      expect(screen.getByText(t('providerNames.qwen'))).toBeTruthy();
      expect(screen.getByText(t('providerNames.doubao'))).toBeTruthy();
      expect(screen.getByText(t('providerNames.volcengine-ark'))).toBeTruthy();
    });
  });

  it('localizes the commander settings tab in zh-CN', async () => {
    setLocale('zh-CN');

    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
    } as unknown as ReturnType<typeof getAPI>);

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: '梦鱼 AI' }));

    await waitFor(() => {
      expect(screen.getAllByText('梦鱼 AI').length).toBeGreaterThan(0);
      // Permission mode was removed from settings; check agent params section instead
      expect(screen.getByText(t('settings.commander.temperature'))).toBeTruthy();
      expect(screen.getByText(t('settings.commander.contextWindow'))).toBeTruthy();
    });
  });

  it('localizes provider hub helper text in zh-CN', async () => {
    setLocale('zh-CN');

    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        test: vi.fn().mockResolvedValue({ ok: false }),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
      openExternal: vi.fn(),
    } as unknown as ReturnType<typeof getAPI>);

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: t('settings.nav.providers') }));

    const openRouterCard = findProviderCard('OpenRouter');
    fireEvent.click(within(openRouterCard).getByLabelText(t('settings.providerCard.expand')));

    await waitFor(() => {
      expect(screen.getByText(`示例: openai/gpt-5.4`)).toBeTruthy();
      expect(screen.getByRole('button', { name: '查看模型' })).toBeTruthy();
    });
  });

  it('hydrates distinct keychain ids for OpenAI image and TTS providers', async () => {
    const isConfigured = vi.fn().mockResolvedValue(false);

    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured,
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
    } as unknown as ReturnType<typeof getAPI>);

    renderSettings();

    fireEvent.click(screen.getByRole('button', { name: /Providers/i }));

    await waitFor(() => {
      expect(isConfigured).toHaveBeenCalledWith('openai');
    });

    fireEvent.click(screen.getByRole('button', { name: t('settings.group.image') }));
    await waitFor(() => {
      expect(isConfigured).toHaveBeenCalledWith('openai-image');
    });

    fireEvent.click(screen.getByRole('button', { name: t('settings.group.audio') }));
    await waitFor(() => {
      expect(isConfigured).toHaveBeenCalledWith('openai-tts');
    });
  });

  it('renders the Usage tab button and shows overview cards when clicked', async () => {
    vi.mocked(getAPI).mockReturnValue({
      onReady: mockOnReady(),
      keychain: {
        isConfigured: vi.fn().mockResolvedValue(false),
      },
      updater: {
        status: vi.fn().mockResolvedValue({ state: 'idle' } satisfies UpdateStatus),
        onProgress: vi.fn(() => () => {}),
      },
      app: {
        version: vi.fn().mockResolvedValue('1.2.3'),
      },
    } as unknown as ReturnType<typeof getAPI>);

    renderSettings();

    expect(screen.getByRole('button', { name: 'Usage' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Usage' }));

    await waitFor(() => {
      expect(screen.getAllByText('Usage Statistics').length).toBeGreaterThan(0);
      expect(screen.getByText('Total Sessions')).toBeTruthy();
      expect(screen.getAllByText('Tool Calls').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Generations').length).toBeGreaterThan(0);
      expect(screen.getByText('Usage Time')).toBeTruthy();
    });
  });
});
