// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { COMMANDER_GUIDE_LIMITS } from '@lucid-fin/contracts';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import type { Locale } from '../../i18n.js';
import { localizeSkillName, localizeToolName, setLocale, t } from '../../i18n.js';
import {
  getDefaultSkillName,
  skillDefinitionsSlice,
  type SkillDefinition,
} from '../../store/slices/skillDefinitions.js';
import type { Theme } from '../../store/slices/ui.js';
import { settingsSlice } from '../../store/slices/settings.js';
import { getAPI } from '../../utils/api.js';
import { SettingsSidebarNav, type SettingsTab } from './SettingsSidebarNav.js';
import { SettingsAppearanceSection } from './SettingsAppearanceSection.js';
import { SettingsGuidesSection } from './SettingsGuidesSection.js';
import {
  PROCESS_GUIDE_GROUPS,
  SettingsProcessPromptsSection,
} from './SettingsProcessPromptsSection.js';
import { getProcessPromptTriggerTools } from './processPromptTriggers.js';

vi.mock('../../utils/api.js', () => ({
  getAPI: vi.fn(() => undefined),
}));

function createMinimalStore() {
  return configureStore({
    reducer: { settings: settingsSlice.reducer },
  });
}

describe('settings extracted sections', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
    setLocale('en-US');
  });

  it('renders sidebar tabs and reports the requested tab change', () => {
    const onTabChange = vi.fn();

    render(
      <Provider store={createMinimalStore()}>
        <SettingsSidebarNav activeTab="providers" onTabChange={onTabChange} />
      </Provider>,
    );

    expect(screen.getByRole('button', { current: 'page', name: 'Providers' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Appearance' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Storage' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Usage' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'About' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Canvas' })).toBeTruthy();
    const advancedToggle = screen.getByRole('button', { name: 'Advanced' });
    expect(advancedToggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Guides' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run Guides' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Prompt Templates' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Workflows' })).toBeNull();

    fireEvent.click(advancedToggle);
    expect(advancedToggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Guides' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Run Guides' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));

    expect(onTabChange).toHaveBeenCalledWith('appearance' satisfies SettingsTab);
  });

  it('keeps the active advanced tab visible', () => {
    const onTabChange = vi.fn();

    render(
      <Provider store={createMinimalStore()}>
        <SettingsSidebarNav activeTab="guides" onTabChange={onTabChange} />
      </Provider>,
    );

    expect(screen.getByRole('button', { name: 'Advanced' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { current: 'page', name: 'Guides' })).toBeTruthy();
  });

  it('renders appearance controls and forwards theme and locale changes', () => {
    setLocale('en-US');
    const onThemeChange = vi.fn();
    const onLocaleChange = vi.fn();

    render(
      <SettingsAppearanceSection
        locale={'en-US' satisfies Locale}
        onLocaleChange={onLocaleChange}
        onThemeChange={onThemeChange}
        theme={'dark' satisfies Theme}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Light' }));
    fireEvent.click(screen.getByRole('button', { name: 'Chinese' }));

    expect(onThemeChange).toHaveBeenCalledWith('light');
    expect(onLocaleChange).toHaveBeenCalledWith('zh-CN');
  });

  it('renders merged guide controls and delegates skill actions', () => {
    setLocale('en-US');
    const onAddSkill = vi.fn();
    const onRemoveSkill = vi.fn();
    const onRenameSkill = vi.fn();
    const onSetSkillContent = vi.fn();
    const onResetAllSkills = vi.fn();
    const onResetSkill = vi.fn();

    const skills: SkillDefinition[] = [
      {
        id: 'meta-prompt',
        name: 'Meta Prompt',
        category: 'system',
        defaultContent: 'Default content',
        customContent: 'Custom content',
        builtIn: true,
        source: 'promptTemplate',
        createdAt: 0,
      },
      {
        id: 'task-style-transfer',
        name: getDefaultSkillName('task-style-transfer') ?? 'Style Transfer Across Shots',
        category: 'task',
        defaultContent: 'Built-in task content',
        customContent: null,
        builtIn: true,
        source: 'taskSkill',
        createdAt: 0,
      },
      {
        id: 'custom-task-1',
        name: 'Custom Task Guide',
        category: 'task',
        defaultContent: '',
        customContent: 'Existing task-guide content',
        builtIn: false,
        source: 'user',
        createdAt: 1,
      },
    ];

    function GuidesHarness() {
      const [localSkills, setLocalSkills] = useState(skills);
      return (
        <SettingsGuidesSection
          skills={localSkills}
          onAddSkill={(payload) => {
            setLocalSkills((previous) => [
              ...previous,
              {
                id: payload.id ?? 'custom-added',
                name: payload.name,
                category: payload.category,
                defaultContent: '',
                customContent: payload.content,
                builtIn: false,
                source: 'user',
                createdAt: Date.now(),
              },
            ]);
            onAddSkill(payload);
          }}
          onRemoveSkill={(id) => {
            setLocalSkills((previous) => previous.filter((s) => s.id !== id));
            onRemoveSkill(id);
          }}
          onRenameSkill={(payload) => {
            setLocalSkills((previous) =>
              previous.map((s) => (s.id === payload.id ? { ...s, name: payload.name } : s)),
            );
            onRenameSkill(payload);
          }}
          onSetSkillContent={(payload) => {
            setLocalSkills((previous) =>
              previous.map((s) =>
                s.id === payload.id ? { ...s, customContent: payload.content } : s,
              ),
            );
            onSetSkillContent(payload);
          }}
          onResetAllSkills={() => {
            onResetAllSkills();
          }}
          onResetSkill={(id) => {
            setLocalSkills((previous) =>
              previous.map((s) =>
                s.id === id
                  ? {
                      ...s,
                      name: getDefaultSkillName(s.id) ?? s.name,
                      customContent: null,
                    }
                  : s,
              ),
            );
            onResetSkill(id);
          }}
        />
      );
    }

    render(<GuidesHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    fireEvent.click(screen.getByText('Meta Prompt').closest('button')!);
    fireEvent.change(screen.getByDisplayValue('Meta Prompt'), {
      target: { value: 'Director Notes' },
    });
    fireEvent.change(screen.getByDisplayValue('Custom content'), {
      target: { value: 'Updated content' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByText('Director Notes').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Restore default' }));

    fireEvent.click(screen.getByRole('button', { name: 'Add Template' }));

    fireEvent.click(screen.getByText('Custom Task Guide').closest('button')!);
    fireEvent.change(screen.getByDisplayValue('Custom Task Guide'), {
      target: { value: 'Refined Task Guide' },
    });
    fireEvent.change(screen.getByDisplayValue('Existing task-guide content'), {
      target: { value: 'Updated task-guide content' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    fireEvent.click(screen.getByText('Refined Task Guide').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onResetAllSkills).toHaveBeenCalledTimes(1);
    expect(onRenameSkill).toHaveBeenCalledWith({ id: 'meta-prompt', name: 'Director Notes' });
    expect(onSetSkillContent).toHaveBeenCalledWith({
      id: 'meta-prompt',
      content: 'Updated content',
    });
    expect(onResetSkill).toHaveBeenCalledWith('meta-prompt');
    expect(onAddSkill).toHaveBeenCalledWith({
      id: expect.stringMatching(/^custom-/),
      name: 'New Template',
      category: 'skill',
      content: '# New Template\n\nWrite your prompt template here...',
    });
    expect(onRenameSkill).toHaveBeenCalledWith({
      id: 'custom-task-1',
      name: 'Refined Task Guide',
    });
    expect(onSetSkillContent).toHaveBeenCalledWith({
      id: 'custom-task-1',
      content: 'Updated task-guide content',
    });
    expect(onRemoveSkill).toHaveBeenCalledWith('custom-task-1');
  });

  it('renders skill list in zh-CN locale', () => {
    setLocale('zh-CN');

    const skills: SkillDefinition[] = [
      {
        id: 'audio-prompting',
        name: 'My Audio Template',
        category: 'audio',
        defaultContent: 'Default audio content',
        customContent: null,
        builtIn: true,
        source: 'promptTemplate',
        createdAt: 0,
      },
      {
        id: 'task-style-transfer',
        name: getDefaultSkillName('task-style-transfer') ?? 'Style Transfer Across Shots',
        category: 'task',
        defaultContent: 'Built-in task content',
        customContent: null,
        builtIn: true,
        source: 'taskSkill',
        createdAt: 0,
      },
    ];

    render(
      <SettingsGuidesSection
        skills={skills}
        onAddSkill={vi.fn()}
        onRemoveSkill={vi.fn()}
        onRenameSkill={vi.fn()}
        onSetSkillContent={vi.fn()}
        onResetAllSkills={vi.fn()}
        onResetSkill={vi.fn()}
      />,
    );

    expect(screen.getByText('My Audio Template')).toBeTruthy();
    expect(screen.getAllByText(t('settings.category.audio')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t('settings.category.task')).length).toBeGreaterThan(0);
  });

  it('localizes every bundled guide and current run-guide metadata in zh-CN', () => {
    setLocale('zh-CN');
    const builtIns = skillDefinitionsSlice
      .getInitialState()
      .skills.filter((skill) => skill.builtIn);
    for (const skill of builtIns) {
      expect(localizeSkillName(skill.id, skill.name), skill.id).not.toBe(skill.name);
    }

    for (const group of PROCESS_GUIDE_GROUPS) {
      for (const processKey of group.keys) {
        expect(t(`processPromptNames.${processKey}`)).not.toBe(`processPromptNames.${processKey}`);
        expect(t(`processPromptDescriptions.${processKey}`)).not.toBe(
          `processPromptDescriptions.${processKey}`,
        );
      }
    }
  });

  it('shows guide source, load mode, and bounded content sizes', () => {
    setLocale('en-US');
    const oversizedContent = 'x'.repeat(COMMANDER_GUIDE_LIMITS.maxTaskSkillChars + 1);
    const onSetSkillContent = vi.fn();
    const skills: SkillDefinition[] = [
      {
        id: 'oversized-task-skill',
        name: 'Oversized Task Skill',
        category: 'skill',
        defaultContent: oversizedContent,
        customContent: null,
        builtIn: true,
        source: 'taskSkill',
        createdAt: 0,
        autoInject: true,
        autoInjectContent: 'bounded kernel',
      },
    ];

    render(
      <SettingsGuidesSection
        skills={skills}
        onAddSkill={vi.fn()}
        onRemoveSkill={vi.fn()}
        onRenameSkill={vi.fn()}
        onSetSkillContent={onSetSkillContent}
        onResetAllSkills={vi.fn()}
        onResetSkill={vi.fn()}
      />,
    );

    expect(screen.getByText('Skill')).toBeTruthy();
    expect(
      screen.getByText((_, element) => element?.textContent === 'Task skill · Automatic summary'),
    ).toBeTruthy();
    fireEvent.click(screen.getByText('Oversized Task Skill').closest('button')!);
    expect(screen.getByText('Automatic context summary')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      COMMANDER_GUIDE_LIMITS.maxTaskSkillChars.toLocaleString(),
    );
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSetSkillContent).not.toHaveBeenCalled();
  });

  it('fires onAddSkill with a new-template payload when Add Template is clicked', () => {
    setLocale('zh-CN');

    const onAddSkill = vi.fn();

    render(
      <SettingsGuidesSection
        skills={[]}
        onAddSkill={onAddSkill}
        onRemoveSkill={vi.fn()}
        onRenameSkill={vi.fn()}
        onSetSkillContent={vi.fn()}
        onResetAllSkills={vi.fn()}
        onResetSkill={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('settings.addTemplate') }));

    expect(onAddSkill).toHaveBeenCalledWith({
      id: expect.stringMatching(/^custom-/),
      name: t('settings.newTemplateName'),
      category: 'skill',
      content: t('settings.newTemplateContent'),
    });
  });

  it('renders process prompt controls and delegates save/reset actions', async () => {
    setLocale('en-US');
    const api = {
      processPrompt: {
        list: vi.fn(async () => [
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
        setCustom: vi.fn(async () => undefined),
        reset: vi.fn(async () => undefined),
      },
    };

    render(<SettingsProcessPromptsSection api={api.processPrompt as never} />);

    // Wait for data to load — group headers become visible
    expect(await screen.findByText('Entities')).toBeTruthy();

    // Expand all groups that contain our test prompts
    fireEvent.click(screen.getByText('Entities'));
    fireEvent.click(screen.getByText('Configuration'));

    expect(screen.getByText('Node Preset Tracks')).toBeTruthy();
    expect(screen.getByText('Provider Management')).toBeTruthy();
    expect(screen.getAllByText('Related tools')).toHaveLength(2);
    expect(screen.getByText('Preset Tracks')).toBeTruthy();
    expect(screen.getByText('Provider')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Custom image rules' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(api.processPrompt.setCustom).toHaveBeenCalledWith(
        'node-preset-tracks',
        'Custom image rules',
      );
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Reset' })[0]!);

    await waitFor(() => {
      expect(api.processPrompt.reset).toHaveBeenCalledWith('node-preset-tracks');
    });
  });

  it('provides localized related-tool labels for every current run guide', () => {
    for (const locale of ['en-US', 'zh-CN'] as const) {
      setLocale(locale);
      for (const group of PROCESS_GUIDE_GROUPS) {
        for (const processKey of group.keys) {
          const tools = getProcessPromptTriggerTools(processKey);
          expect(tools.length, `${processKey} should declare related tools`).toBeGreaterThan(0);
          for (const tool of tools) {
            expect(localizeToolName(tool), `${locale} should localize ${tool}`).not.toBe(tool);
          }
        }
      }
    }
  });

  it('localizes built-in process prompt names and descriptions in zh-CN', async () => {
    setLocale('zh-CN');
    const api = {
      processPrompt: {
        list: vi.fn(async () => [
          {
            processKey: 'image-node-generation',
            name: 'Image Node Generation',
            description: 'Prompt compilation rules for image nodes.',
            defaultValue: 'Default rules',
            customValue: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ]),
        setCustom: vi.fn(async () => undefined),
        reset: vi.fn(async () => undefined),
      },
    };

    render(<SettingsProcessPromptsSection api={api.processPrompt as never} />);

    await screen.findByText((content) => content.length > 0 && content !== 'Image Node Generation');
    expect(screen.queryByText('Image Node Generation')).toBeNull();
    expect(screen.queryByText('Prompt compilation rules for image nodes.')).toBeNull();
  });

  it('localizes run-guide titles and descriptions in zh-CN', async () => {
    setLocale('zh-CN');
    const prompts = [
      {
        processKey: 'style-plate-lock',
        name: 'Style Plate Lock (ref-image precondition)',
        description:
          'Triggered when a canvas has ref-image entities but no stylePlate set. Forces Commander to lock a canvas-scoped style prompt before running character/equipment/location ref-image generation.',
      },
      {
        processKey: 'entities-before-generation',
        name: 'Entities Before Generation',
        description:
          'Triggered on early steps when a visual-generation tool is pending. Reminds Commander to verify that referenced entities have reference images before generating scene visuals.',
      },
      {
        processKey: 'batch-create-guidance',
        name: 'Batch Create Guidance',
        description:
          'Triggered when canvas.createNodes is called with more than 5 nodes. Provides structural guidance for large batch operations.',
      },
      {
        processKey: 'prompt-quality-gate',
        name: 'Prompt Quality Gate',
        description:
          'Triggered when canvas.generation is called. Reminds Commander to verify and expand thin prompts before committing to generation.',
      },
      {
        processKey: 'story-task-list-phase',
        name: 'Story Task-list Phase',
        description:
          'Triggered when task-list-orchestration is active. Reinforces phase-gate discipline for the story-to-video pipeline.',
      },
    ].map((prompt) => ({
      ...prompt,
      defaultValue: 'Default rules',
      customValue: null,
      createdAt: 1,
      updatedAt: 1,
    }));
    const api = {
      processPrompt: {
        list: vi.fn(async () => prompts),
        setCustom: vi.fn(async () => undefined),
        reset: vi.fn(async () => undefined),
      },
    };

    render(<SettingsProcessPromptsSection api={api.processPrompt as never} />);

    await screen.findByText((content) => content.length > 0 && content !== prompts[0]!.name);
    for (const prompt of prompts) {
      expect(screen.queryByText(prompt.name)).toBeNull();
      expect(screen.queryByText(prompt.description)).toBeNull();
    }
  });

  it('renders unified entity ref-image process prompt as a single card', async () => {
    setLocale('en-US');
    const api = {
      processPrompt: {
        list: vi.fn(async () => [
          {
            processKey: 'entity-ref-image-generation',
            name: 'Entity Reference Image Generation',
            description:
              'Guidance for entity (character, location, equipment) reference image creation.',
            defaultValue: 'Default rules',
            customValue: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ]),
        setCustom: vi.fn(async () => undefined),
        reset: vi.fn(async () => undefined),
      },
    };

    render(<SettingsProcessPromptsSection api={api.processPrompt as never} />);

    // Wait for data to load — group headers become visible
    expect(await screen.findByText('Generation')).toBeTruthy();

    // Expand the Generation group to see the entity ref-image card
    fireEvent.click(screen.getByText('Generation'));

    expect(screen.getByText('Entity Reference Image Generation')).toBeTruthy();
    expect(screen.getAllByText('Related tools')).toHaveLength(1);
    expect(screen.getByText('Create Nodes')).toBeTruthy();
    expect(screen.getByText('Configure Node')).toBeTruthy();
    expect(screen.getByText('Set Ref Image from Node')).toBeTruthy();
    expect(screen.getByText('Set Ref Image')).toBeTruthy();
    expect(screen.getByText('Delete Ref Image')).toBeTruthy();
    expect(screen.getByText('Set Ref Image from Node')).toBeTruthy();
  });

  it('retries process guide loading until the preload API becomes available', async () => {
    setLocale('en-US');

    const currentApi: { processPrompt: { list: ReturnType<typeof vi.fn> } } = {
      processPrompt: {
        list: vi.fn(async () => [
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
      },
    };
    vi.mocked(getAPI).mockImplementation(() => currentApi as never);

    render(<SettingsProcessPromptsSection />);

    expect(screen.getByText('Loading run guides...')).toBeTruthy();

    await waitFor(
      () => {
        expect(currentApi.processPrompt.list).toHaveBeenCalledTimes(1);
      },
      { timeout: 1500 },
    );

    // Group header should be visible after load
    expect(await screen.findByText('Generation')).toBeTruthy();
    // Expand the Generation group to see the item
    fireEvent.click(screen.getByText('Generation'));
    expect(screen.getByText('Image Node Generation')).toBeTruthy();
    expect(screen.queryByText(t('settings.processGuides.unavailable'))).toBeNull();
    expect(currentApi.processPrompt.list).toHaveBeenCalledTimes(1);
  });

  it('shows process-guide size and blocks an oversized legacy override', async () => {
    setLocale('en-US');
    const oversizedContent = 'x'.repeat(COMMANDER_GUIDE_LIMITS.maxProcessPromptChars + 1);
    const api = {
      list: vi.fn(async () => [
        {
          processKey: 'image-node-generation',
          name: 'Image Node Generation',
          description: 'Prompt compilation for image nodes.',
          defaultValue: 'Default rules',
          customValue: oversizedContent,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
      setCustom: vi.fn(async () => undefined),
      reset: vi.fn(async () => undefined),
    };

    render(<SettingsProcessPromptsSection api={api as never} />);

    fireEvent.click(await screen.findByText('Generation'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('alert').textContent).toContain(
      COMMANDER_GUIDE_LIMITS.maxProcessPromptChars.toLocaleString(),
    );
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.setCustom).not.toHaveBeenCalled();
  });
});
