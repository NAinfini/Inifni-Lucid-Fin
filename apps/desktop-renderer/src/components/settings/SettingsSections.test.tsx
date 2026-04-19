// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React, { useState } from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import type { Locale } from '../../i18n.js';
import { setLocale, t } from '../../i18n.js';
import type { PromptTemplate } from '../../store/slices/promptTemplates.js';
import {
  getDefaultWorkflowDefinitionName,
  type WorkflowDefEntry,
} from '../../store/slices/workflowDefinitions.js';
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

  it('renders merged guide controls and delegates template/workflow actions', () => {
    setLocale('en-US');
    const onAddTemplate = vi.fn();
    const onRemoveTemplate = vi.fn();
    const onRenameTemplate = vi.fn();
    const onSetTemplateContent = vi.fn();
    const onResetAllTemplates = vi.fn();
    const onResetTemplate = vi.fn();
    const onAddWorkflowEntry = vi.fn();
    const onUpdateWorkflowEntry = vi.fn();
    const onRemoveWorkflowEntry = vi.fn();

    const templates: PromptTemplate[] = [
      {
        category: 'system',
        customContent: 'Custom content',
        defaultContent: 'Default content',
        id: 'meta-prompt',
        name: 'Meta Prompt',
      },
    ];

    const workflowEntries: WorkflowDefEntry[] = [
      {
        id: 'wf-video-clone',
        name: getDefaultWorkflowDefinitionName('wf-video-clone') ?? 'Video Clone → Remake',
        category: 'workflow',
        content: 'Built-in workflow content',
        builtIn: true,
        createdAt: 0,
      },
      {
        id: 'custom-wf-1',
        name: 'Custom Workflow',
        category: 'workflow',
        content: 'Existing workflow content',
        builtIn: false,
        createdAt: 1,
      },
    ];

    function GuidesHarness() {
      const [localTemplates, setLocalTemplates] = useState(templates);
      const [localWorkflowEntries, setLocalWorkflowEntries] = useState(workflowEntries);

      return (
        <SettingsGuidesSection
          templates={localTemplates}
          workflowEntries={localWorkflowEntries}
          onAddTemplate={(template) => {
            setLocalTemplates((previous) => [
              ...previous,
              {
                id: template.id,
                name: template.name,
                category: template.category,
                defaultContent: '',
                customContent: template.content,
              },
            ]);
            onAddTemplate(template);
          }}
          onRemoveTemplate={(id) => {
            setLocalTemplates((previous) => previous.filter((template) => template.id !== id));
            onRemoveTemplate(id);
          }}
          onRenameTemplate={(payload) => {
            setLocalTemplates((previous) =>
              previous.map((template) =>
                template.id === payload.id ? { ...template, name: payload.name } : template,
              ),
            );
            onRenameTemplate(payload);
          }}
          onSetTemplateContent={(payload) => {
            setLocalTemplates((previous) =>
              previous.map((template) =>
                template.id === payload.id
                  ? { ...template, customContent: payload.content }
                  : template,
              ),
            );
            onSetTemplateContent(payload);
          }}
          onResetAllTemplates={() => {
            onResetAllTemplates();
          }}
          onResetTemplate={(id) => {
            setLocalTemplates((previous) =>
              previous.map((template) =>
                template.id === id
                  ? {
                      ...template,
                      name: template.id === 'meta-prompt' ? 'Meta-Prompt (AI Instructor)' : template.name,
                      customContent: null,
                    }
                  : template,
              ),
            );
            onResetTemplate(id);
          }}
          onAddWorkflowEntry={(entry) => {
            setLocalWorkflowEntries((previous) => [
              ...previous,
              {
                id: `custom-added-${entry.category}`,
                name: entry.name,
                category: entry.category,
                content: entry.content,
                builtIn: false,
                createdAt: 2,
              },
            ]);
            onAddWorkflowEntry(entry);
          }}
          onUpdateWorkflowEntry={(payload) => {
            setLocalWorkflowEntries((previous) =>
              previous.map((entry) =>
                entry.id === payload.id
                  ? { ...entry, name: payload.name, content: payload.content }
                  : entry,
              ),
            );
            onUpdateWorkflowEntry(payload);
          }}
          onRemoveWorkflowEntry={(id) => {
            setLocalWorkflowEntries((previous) => previous.filter((entry) => entry.id !== id));
            onRemoveWorkflowEntry(id);
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
    fireEvent.click(screen.getByRole('button', { name: 'Add Workflow' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Skill' }));

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

    expect(onResetAllTemplates).toHaveBeenCalledTimes(1);
    expect(onRenameTemplate).toHaveBeenCalledWith({
      id: 'meta-prompt',
      name: 'Director Notes',
    });
    expect(onSetTemplateContent).toHaveBeenCalledWith({
      id: 'meta-prompt',
      content: 'Updated content',
    });
    expect(onResetTemplate).toHaveBeenCalledWith('meta-prompt');
    expect(onAddTemplate).toHaveBeenCalledWith({
      id: expect.stringMatching(/^custom-/),
      name: 'New Template',
      category: 'process',
      content: '# New Template\n\nWrite your prompt template here...',
    });
    expect(onAddWorkflowEntry).toHaveBeenCalledWith({
      name: 'New Workflow',
      category: 'workflow',
      content: '# New Workflow\n\nDescribe your workflow steps here...',
    });
    expect(onAddWorkflowEntry).toHaveBeenCalledWith({
      name: 'New Skill',
      category: 'skill',
      content: '# New Skill\n\nDescribe your skill here...',
    });
    expect(onUpdateWorkflowEntry).toHaveBeenCalledWith({
      id: 'custom-wf-1',
      name: 'Refined Workflow',
      content: 'Updated workflow content',
    });
    expect(onRemoveWorkflowEntry).toHaveBeenCalledWith('custom-wf-1');
  });

  it('localizes built-in guides but preserves renamed template titles', () => {
    setLocale('zh-CN');

    const templates: PromptTemplate[] = [
      {
        category: 'audio',
        customContent: null,
        defaultContent: 'Default audio content',
        id: 'audio-prompting',
        name: 'My Audio Template',
      },
      {
        category: 'workflow',
        customContent: null,
        defaultContent: 'Default workflow content',
        id: 'storyboard-export',
        name: 'Storyboard Export',
      },
      {
        category: 'audio',
        customContent: null,
        defaultContent: 'Default emotion voice content',
        id: 'emotion-voice-prompting',
        name: 'Emotion & Voice Prompting',
      },
    ];

    const workflowEntries: WorkflowDefEntry[] = [
      {
        id: 'wf-video-clone',
        name: getDefaultWorkflowDefinitionName('wf-video-clone') ?? 'Video Clone → Remake',
        category: 'workflow',
        content: 'Built-in workflow content',
        builtIn: true,
        createdAt: 0,
      },
      {
        id: 'sk-lip-sync',
        name: getDefaultWorkflowDefinitionName('sk-lip-sync') ?? 'Lip Sync Video',
        category: 'skill',
        content: 'Built-in skill content',
        builtIn: true,
        createdAt: 0,
      },
    ];

    render(
      <SettingsGuidesSection
        templates={templates}
        workflowEntries={workflowEntries}
        onAddTemplate={vi.fn()}
        onRemoveTemplate={vi.fn()}
        onRenameTemplate={vi.fn()}
        onSetTemplateContent={vi.fn()}
        onResetAllTemplates={vi.fn()}
        onResetTemplate={vi.fn()}
        onAddWorkflowEntry={vi.fn()}
        onUpdateWorkflowEntry={vi.fn()}
        onRemoveWorkflowEntry={vi.fn()}
      />,
    );

    expect(screen.getByText('My Audio Template')).toBeTruthy();
    expect(screen.getByText(t('promptTemplateNames.storyboard-export'))).toBeTruthy();
    expect(screen.getByText(t('promptTemplateNames.emotion-voice-prompting'))).toBeTruthy();
    expect(screen.getByText(t('workflowDefinitionNames.wf-video-clone'))).toBeTruthy();
    expect(screen.getByText(t('workflowDefinitionNames.sk-lip-sync'))).toBeTruthy();
    expect(screen.getAllByText(t('settings.category.audio')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t('settings.category.workflow')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t('settings.guides.templateSource')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t('settings.guides.workflowSource')).length).toBeGreaterThan(0);
  });

  it('creates localized default content for new guides in zh-CN', () => {
    setLocale('zh-CN');

    const onAddTemplate = vi.fn();
    const onAddWorkflowEntry = vi.fn();

    render(
      <SettingsGuidesSection
        templates={[]}
        workflowEntries={[]}
        onAddTemplate={onAddTemplate}
        onRemoveTemplate={vi.fn()}
        onRenameTemplate={vi.fn()}
        onSetTemplateContent={vi.fn()}
        onResetAllTemplates={vi.fn()}
        onResetTemplate={vi.fn()}
        onAddWorkflowEntry={onAddWorkflowEntry}
        onUpdateWorkflowEntry={vi.fn()}
        onRemoveWorkflowEntry={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('settings.addTemplate') }));
    fireEvent.click(screen.getByRole('button', { name: t('settings.addWorkflow') }));
    fireEvent.click(screen.getByRole('button', { name: t('settings.addSkill') }));

    expect(onAddTemplate).toHaveBeenCalledWith({
      id: expect.stringMatching(/^custom-/),
      name: t('settings.newTemplateName'),
      category: 'process',
      content: t('settings.newTemplateContent'),
    });
    expect(onAddWorkflowEntry).toHaveBeenCalledWith({
      name: t('settings.workflows.newWorkflowName'),
      category: 'workflow',
      content: t('settings.workflows.newWorkflowTemplate'),
    });
    expect(onAddWorkflowEntry).toHaveBeenCalledWith({
      name: t('settings.workflows.newSkillName'),
      category: 'skill',
      content: t('settings.workflows.newSkillTemplate'),
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
