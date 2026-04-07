// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React, { useState } from 'react';
import type { Locale } from '../../i18n.js';
import { setLocale } from '../../i18n.js';
import type { PromptTemplate } from '../../store/slices/promptTemplates.js';
import type { Theme } from '../../store/slices/ui.js';
import {
  SettingsSidebarNav,
  type SettingsTab,
} from './SettingsSidebarNav.js';
import { SettingsAppearanceSection } from './SettingsAppearanceSection.js';
import { SettingsPromptTemplatesSection } from './SettingsPromptTemplatesSection.js';

describe('settings extracted sections', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    setLocale('en-US');
  });

  it('renders sidebar tabs and reports the requested tab change', () => {
    const onTabChange = vi.fn();

    render(<SettingsSidebarNav activeTab="providers" onTabChange={onTabChange} />);

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
    fireEvent.click(screen.getByRole('button', { name: '中文' }));

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
      const [templateDrafts, setTemplateDrafts] = useState<Record<string, string>>({
        'meta-prompt': 'Draft content',
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
          onTemplateDraftChange={(id, value) => {
            setTemplateDrafts((previous) => ({ ...previous, [id]: value }));
            onTemplateDraftChange(id, value);
          }}
          templateDrafts={templateDrafts}
          templates={templates}
        />
      );
    }

    render(<PromptTemplatesHarness />);

    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }));
    fireEvent.change(screen.getByDisplayValue('Draft content'), {
      target: { value: 'Updated content' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(screen.getByText('Meta-Prompt (AI Instructor)').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Restore default' }));

    expect(onResetAll).toHaveBeenCalledTimes(1);
    expect(onTemplateDraftChange).toHaveBeenCalledWith('meta-prompt', 'Updated content');
    expect(onResetTemplate).toHaveBeenCalledWith('meta-prompt');
    expect(onSaveTemplate).toHaveBeenCalledWith('meta-prompt', 'Updated content');
  });

  it('localizes prompt template titles and category badges', () => {
    setLocale('zh-CN');

    const templates: PromptTemplate[] = [
      {
        category: 'audio',
        customContent: null,
        defaultContent: 'Default audio content',
        id: 'audio-prompting',
        name: 'Audio Prompting',
      },
      {
        category: 'workflow',
        customContent: null,
        defaultContent: 'Default workflow content',
        id: 'storyboard-export',
        name: 'Storyboard Export',
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

    expect(screen.getByText('\u97f3\u9891\u63d0\u793a\u8bcd')).toBeTruthy();
    expect(screen.getByText('\u5206\u955c\u677f\u5bfc\u51fa')).toBeTruthy();
    expect(screen.getByText('\u97f3\u9891')).toBeTruthy();
    expect(screen.getByText('\u5de5\u4f5c\u6d41')).toBeTruthy();
  });
});
