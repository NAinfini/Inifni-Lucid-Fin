// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import type { Locale } from '../../i18n.js';
import { setLocale, t } from '../../i18n.js';
import type { PromptTemplate } from '../../store/slices/promptTemplates.js';
import type { Theme } from '../../store/slices/ui.js';
import { settingsSlice } from '../../store/slices/settings.js';
import { SettingsSidebarNav, type SettingsTab } from './SettingsSidebarNav.js';
import { SettingsAppearanceSection } from './SettingsAppearanceSection.js';
import { SettingsPromptTemplatesSection } from './SettingsPromptTemplatesSection.js';

function createMinimalStore() {
  return configureStore({
    reducer: { settings: settingsSlice.reducer },
  });
}

describe('settings extracted sections', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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

  it('renders prompt template controls and delegates reset and save actions', () => {
    setLocale('en-US');
    const onExpandedTemplateIdChange = vi.fn();
    const onResetAll = vi.fn();
    const onResetTemplate = vi.fn();
    const onSaveTemplate = vi.fn();
    const onTemplateDraftChange = vi.fn();

    const templates: PromptTemplate[] = [
      {
        category: 'system',
        customContent: 'Custom content',
        defaultContent: 'Default content',
        id: 'meta-prompt',
        name: 'Meta Prompt',
      },
    ];

    function PromptTemplatesHarness() {
      const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>('meta-prompt');
      const [templateDrafts, setTemplateDrafts] = useState<
        Record<string, { content: string; name: string }>
      >({
        'meta-prompt': {
          content: 'Draft content',
          name: 'Custom Meta Prompt',
        },
      });

      return (
        <SettingsPromptTemplatesSection
          expandedTemplateId={expandedTemplateId}
          onExpandedTemplateIdChange={(id) => {
            setExpandedTemplateId(id);
            onExpandedTemplateIdChange(id);
          }}
          onResetAll={onResetAll}
          onResetTemplate={onResetTemplate}
          onSaveTemplate={onSaveTemplate}
          onTemplateDraftChange={(id, draft) => {
            setTemplateDrafts((previous) => ({ ...previous, [id]: draft }));
            onTemplateDraftChange(id, draft);
          }}
          templateDrafts={templateDrafts}
          templates={templates}
        />
      );
    }

    render(<PromptTemplatesHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    fireEvent.change(screen.getByDisplayValue('Custom Meta Prompt'), {
      target: { value: 'Director Notes' },
    });
    fireEvent.change(screen.getByDisplayValue('Draft content'), {
      target: { value: 'Updated content' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByText('Meta Prompt').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Restore default' }));

    expect(onResetAll).toHaveBeenCalledTimes(1);
    expect(onTemplateDraftChange).toHaveBeenCalledWith('meta-prompt', {
      content: 'Updated content',
      name: 'Director Notes',
    });
    expect(onResetTemplate).toHaveBeenCalledWith('meta-prompt');
    expect(onSaveTemplate).toHaveBeenCalledWith('meta-prompt', {
      content: 'Updated content',
      name: 'Director Notes',
    });
  });

  it('localizes built-in prompt templates but preserves renamed titles', () => {
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

    render(
      <SettingsPromptTemplatesSection
        expandedTemplateId={null}
        onExpandedTemplateIdChange={vi.fn()}
        onResetAll={vi.fn()}
        onResetTemplate={vi.fn()}
        onSaveTemplate={vi.fn()}
        onTemplateDraftChange={vi.fn()}
        templateDrafts={{}}
        templates={templates}
      />,
    );

    expect(screen.getByText('My Audio Template')).toBeTruthy();
    expect(screen.getByText(t('promptTemplateNames.storyboard-export'))).toBeTruthy();
    expect(screen.getByText(t('promptTemplateNames.emotion-voice-prompting'))).toBeTruthy();
    expect(screen.getAllByText(t('settings.category.audio')).length).toBeGreaterThan(0);
    expect(screen.getByText(t('settings.category.workflow'))).toBeTruthy();
  });

  it('creates localized default content for new prompt templates in zh-CN', () => {
    setLocale('zh-CN');

    const onAddTemplate = vi.fn();

    render(
      <SettingsPromptTemplatesSection
        expandedTemplateId={null}
        onExpandedTemplateIdChange={vi.fn()}
        onResetAll={vi.fn()}
        onResetTemplate={vi.fn()}
        onSaveTemplate={vi.fn()}
        onTemplateDraftChange={vi.fn()}
        onAddTemplate={onAddTemplate}
        templateDrafts={{}}
        templates={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: t('settings.addTemplate') }));

    expect(onAddTemplate).toHaveBeenCalledWith({
      id: expect.stringMatching(/^custom-/),
      name: '新模板',
      category: 'process',
      content: '# 新模板\n\n在此编写你的提示词模板...',
    });
  });
});
