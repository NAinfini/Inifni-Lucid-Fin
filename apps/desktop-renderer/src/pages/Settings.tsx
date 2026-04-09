import React, { useCallback, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ArrowLeft, Key } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { t, setLocale, getLocale, onLocaleChange, type Locale } from '../i18n.js';
import type { RootState } from '../store/index.js';
import { setTheme, type Theme } from '../store/slices/ui.js';
import { SettingsAppearanceSection } from '../components/settings/SettingsAppearanceSection.js';
import { SettingsPromptTemplatesSection } from '../components/settings/SettingsPromptTemplatesSection.js';
import {
  SettingsSidebarNav,
  translateOrFallback,
  type SettingsTab,
} from '../components/settings/SettingsSidebarNav.js';
import type { APIGroup } from '../store/slices/settings.js';
import {
  addCustomTemplate,
  removeCustomTemplate,
  renameTemplate,
  resetAllContent,
  resetContent,
  setCustomContent,
} from '../store/slices/promptTemplates.js';
import { SettingsProvidersSection } from './SettingsProvidersSection.js';
import { SettingsUpdateSection } from './SettingsUpdateSection.js';
import { SettingsWorkflowsSection } from './SettingsWorkflowsSection.js';

type TemplateDraft = {
  content: string;
  name: string;
};

export function Settings() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const theme = useSelector((state: RootState) => state.ui.theme);
  const templates = useSelector((state: RootState) => state.promptTemplates.templates);
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers');
  const [providerSubTab, setProviderSubTab] = useState<APIGroup>('llm');
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, TemplateDraft>>({});

  useEffect(() => {
    return onLocaleChange(() => setLocaleState(getLocale()));
  }, []);

  const handleTabChange = useCallback((tab: SettingsTab) => {
    setActiveTab(tab);
  }, []);

  const handleThemeChange = useCallback(
    (nextTheme: Theme) => {
      dispatch(setTheme(nextTheme));
    },
    [dispatch],
  );

  const handleLocaleChange = useCallback((nextLocale: Locale) => {
    setLocale(nextLocale);
    window.location.reload();
  }, []);

  const handleExpandedTemplateIdChange = useCallback((id: string | null) => {
    setExpandedTemplateId(id);
  }, []);

  const handleTemplateDraftChange = useCallback((id: string, draft: TemplateDraft) => {
    setTemplateDrafts((previous) => ({ ...previous, [id]: draft }));
  }, []);

  const handleResetAllTemplates = useCallback(() => {
    dispatch(resetAllContent());
    setExpandedTemplateId(null);
    setTemplateDrafts({});
  }, [dispatch]);

  const handleResetTemplate = useCallback(
    (id: string) => {
      dispatch(resetContent(id));
    },
    [dispatch],
  );

  const handleSaveTemplate = useCallback(
    (id: string, draft: TemplateDraft) => {
      dispatch(renameTemplate({ id, name: draft.name }));
      dispatch(setCustomContent({ id, content: draft.content }));
    },
    [dispatch],
  );

  const activeTabTitle =
    activeTab === 'appearance'
      ? t('settings.appearance.title')
      : activeTab === 'promptTemplates'
        ? t('settings.promptTemplates')
        : activeTab === 'workflows'
          ? translateOrFallback('settings.workflows.title', 'Workflows & Skills')
          : activeTab === 'about'
            ? t('settings.update.title')
            : translateOrFallback('settings.nav.providers', 'Providers');

  const activeTabDescription =
    activeTab === 'workflows'
      ? translateOrFallback(
          'settings.workflows.subtitle',
          'Dedicated space for workflow and skill controls.',
        )
      : undefined;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('settings.backToCanvas')}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <h1 className="flex items-center gap-1.5 text-sm font-bold">
            <Key className="h-4 w-4" />
            {t('settings.title')}
          </h1>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 px-3 py-4 md:flex-row">
          <SettingsSidebarNav activeTab={activeTab} onTabChange={handleTabChange} />

          <section className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border/60 bg-card">
            <div className="flex h-full flex-col">
              <div className="border-b border-border/60 px-4 py-3">
                <div className="text-sm font-semibold">{activeTabTitle}</div>
                {activeTabDescription && (
                  <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground">
                    {activeTabDescription}
                  </p>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div className="mx-auto w-full max-w-4xl">
                  {activeTab === 'appearance' && (
                    <SettingsAppearanceSection
                      locale={locale}
                      onLocaleChange={handleLocaleChange}
                      onThemeChange={handleThemeChange}
                      theme={theme}
                    />
                  )}

                  {activeTab === 'providers' && (
                    <SettingsProvidersSection
                      providerSubTab={providerSubTab}
                      onProviderSubTabChange={setProviderSubTab}
                    />
                  )}

                  {activeTab === 'promptTemplates' && (
                    <SettingsPromptTemplatesSection
                      expandedTemplateId={expandedTemplateId}
                      onExpandedTemplateIdChange={handleExpandedTemplateIdChange}
                      onResetAll={handleResetAllTemplates}
                      onResetTemplate={handleResetTemplate}
                      onSaveTemplate={handleSaveTemplate}
                      onTemplateDraftChange={handleTemplateDraftChange}
                      onAddTemplate={(template) => dispatch(addCustomTemplate(template))}
                      onRemoveTemplate={(id) => dispatch(removeCustomTemplate(id))}
                      templateDrafts={templateDrafts}
                      templates={templates.filter((template) => template.category !== 'skill')}
                    />
                  )}

                  {activeTab === 'workflows' && <SettingsWorkflowsSection />}

                  {activeTab === 'about' && <SettingsUpdateSection />}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
