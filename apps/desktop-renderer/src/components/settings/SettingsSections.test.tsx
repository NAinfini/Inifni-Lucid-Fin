// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import type { Locale } from '../../i18n.js';
import { setLocale, t } from '../../i18n.js';
import {
  getDefaultSkillName,
  type SkillDefinition,
} from '../../store/slices/skillDefinitions.js';
import type { Theme } from '../../store/slices/ui.js';
import { settingsSlice } from '../../store/slices/settings.js';
import { getAPI } from '../../utils/api.js';
import { SettingsSidebarNav, type SettingsTab } from './SettingsSidebarNav.js';
import { SettingsAppearanceSection } from './SettingsAppearanceSection.js';
import { SettingsGuidesSection } from './SettingsGuidesSection.js';
import { SettingsProcessPromptsSection } from './SettingsProcessPromptsSection.js';

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

    expect(
      screen.getByRole('button', { current: 'page', name: 'Providers' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Guides' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Process Injection' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Prompt Templates' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Workflows' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));

    expect(onTabChange).toHaveBeenCalledWith('appearance' satisfies SettingsTab);
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
        id: 'wf-video-clone',
        name: getDefaultSkillName('wf-video-clone') ?? 'Video Clone → Remake',
        category: 'workflow',
        defaultContent: 'Built-in workflow content',
        customContent: null,
        builtIn: true,
        source: 'workflowSkill',
        createdAt: 0,
      },
      {
        id: 'custom-wf-1',
        name: 'Custom Workflow',
        category: 'workflow',
        defaultContent: '',
        customContent: 'Existing workflow content',
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

    fireEvent.click(screen.getByText('Custom Workflow').closest('button')!);
    fireEvent.change(screen.getByDisplayValue('Custom Workflow'), {
      target: { value: 'Refined Workflow' },
    });
    fireEvent.change(screen.getByDisplayValue('Existing workflow content'), {
      target: { value: 'Updated workflow content' },
    });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0]);
    fireEvent.click(screen.getByText('Refined Workflow').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    expect(onResetAllSkills).toHaveBeenCalledTimes(1);
    expect(onRenameSkill).toHaveBeenCalledWith({ id: 'meta-prompt', name: 'Director Notes' });
    expect(onSetSkillContent).toHaveBeenCalledWith({ id: 'meta-prompt', content: 'Updated content' });
    expect(onResetSkill).toHaveBeenCalledWith('meta-prompt');
    expect(onAddSkill).toHaveBeenCalledWith({
      id: expect.stringMatching(/^custom-/),
      name: 'New Template',
      category: 'skill',
      content: '# New Template\n\nWrite your prompt template here...',
    });
    expect(onRenameSkill).toHaveBeenCalledWith({ id: 'custom-wf-1', name: 'Refined Workflow' });
    expect(onSetSkillContent).toHaveBeenCalledWith({
      id: 'custom-wf-1',
      content: 'Updated workflow content',
    });
    expect(onRemoveSkill).toHaveBeenCalledWith('custom-wf-1');
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
        id: 'wf-video-clone',
        name: getDefaultSkillName('wf-video-clone') ?? 'Video Clone → Remake',
        category: 'workflow',
        defaultContent: 'Built-in workflow content',
        customContent: null,
        builtIn: true,
        source: 'workflowSkill',
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
    expect(screen.getAllByText(t('settings.category.workflow')).length).toBeGreaterThan(0);
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
          {
            processKey: 'series-management',
            name: 'Series Management',
            description: 'Guidance for series and episode planning work.',
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

    expect(await screen.findByText('Node Preset Tracks')).toBeTruthy();
    expect(screen.getByText('Provider Management')).toBeTruthy();
    expect(screen.getByText('Series Management')).toBeTruthy();
    expect(screen.getAllByText('Triggered by')).toHaveLength(3);
    expect(screen.getByText('canvas.writePresetTracksBatch')).toBeTruthy();
    expect(screen.getByText('provider.list')).toBeTruthy();
    expect(screen.getByText('series.addEpisode')).toBeTruthy();
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

  it('renders split ref-image process prompts as separate cards', async () => {
    setLocale('en-US');
    const api = {
      processPrompt: {
        list: vi.fn(async () => [
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
        ]),
        setCustom: vi.fn(async () => undefined),
        reset: vi.fn(async () => undefined),
      },
    };

    render(<SettingsProcessPromptsSection api={api.processPrompt as never} />);

    expect(await screen.findByText('Character Reference Image Generation')).toBeTruthy();
    expect(screen.getByText('Location Reference Image Generation')).toBeTruthy();
    expect(screen.getByText('Equipment Reference Image Generation')).toBeTruthy();
    expect(screen.getAllByText('Triggered by')).toHaveLength(3);
    expect(screen.getByText('character.generateRefImage')).toBeTruthy();
    expect(screen.getByText('character.setRefImage')).toBeTruthy();
    expect(screen.getByText('location.generateRefImage')).toBeTruthy();
    expect(screen.getByText('location.setRefImageFromNode')).toBeTruthy();
    expect(screen.getByText('equipment.generateRefImage')).toBeTruthy();
    expect(screen.getByText('equipment.deleteRefImage')).toBeTruthy();
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

    expect(screen.getByText('Loading process injection...')).toBeTruthy();

    await waitFor(() => {
      expect(currentApi.processPrompt.list).toHaveBeenCalledTimes(1);
    }, { timeout: 1500 });

    expect(await screen.findByText('Image Node Generation')).toBeTruthy();
    expect(screen.queryByText(t('settings.processGuides.unavailable'))).toBeNull();
    expect(currentApi.processPrompt.list).toHaveBeenCalledTimes(1);
  });
});
