import React, { useCallback, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { ArrowLeft, Key } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { t, setLocale, getLocale, onLocaleChange, type Locale } from '../i18n.js';
import type { RootState } from '../store/index.js';
import { setTheme, type Theme } from '../store/slices/ui.js';
import { SettingsAppearanceSection } from '../components/settings/SettingsAppearanceSection.js';
import { SettingsGuidesSection } from '../components/settings/SettingsGuidesSection.js';
import { SettingsProcessPromptsSection } from '../components/settings/SettingsProcessPromptsSection.js';
import {
  SettingsSidebarNav,
  translateOrFallback,
  type SettingsTab,
} from '../components/settings/SettingsSidebarNav.js';
import type { APIGroup } from '../store/slices/settings.js';
import { recordFeatureUsed } from '../store/slices/settings.js';
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
import { SettingsStorageSection } from './SettingsStorageSection.js';
import { SettingsCommanderSection } from './SettingsCommanderSection.js';
import { SettingsUsageSection } from './SettingsUsageSection.js';
import {
  addEntry as addWorkflowEntry,
  removeEntry as removeWorkflowEntry,
  updateEntry as updateWorkflowEntry,
} from '../store/slices/workflowDefinitions.js';

export function Settings() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const theme = useSelector((state: RootState) => state.ui.theme);
  const templates = useSelector((state: RootState) => state.promptTemplates.templates);
  const workflowEntries = useSelector((state: RootState) => state.workflowDefinitions.entries);
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  const [activeTab, setActiveTab] = useState<SettingsTab>('commander');
  const [providerSubTab, setProviderSubTab] = useState<APIGroup>('llm');

  useEffect(() => {
    return onLocaleChange(() => setLocaleState(getLocale()));
  }, []);

  const handleTabChange = useCallback((tab: SettingsTab) => {
    setActiveTab(tab);
    dispatch(recordFeatureUsed({ feature: `settings.${tab}` }));
  }, [dispatch]);

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

  const activeTabTitle =
    activeTab === 'appearance'
      ? t('settings.appearance.title')
      : activeTab === 'guides'
        ? t('settings.guides.title')
        : activeTab === 'processGuides'
          ? t('settings.processGuides.title')
          : activeTab === 'storage'
            ? translateOrFallback('settings.storage.title', 'Storage & Data')
          : activeTab === 'commander'
            ? translateOrFallback('settings.commander.title', 'Commander AI')
            : activeTab === 'usage'
              ? translateOrFallback('settings.usage.title', 'Usage Statistics')
              : activeTab === 'about'
                ? t('settings.update.title')
                : translateOrFallback('settings.nav.providers', 'Providers');

  const activeTabDescription =
    activeTab === 'guides'
      ? translateOrFallback(
          'settings.guides.subtitle',
          'Prompt templates and workflow guides that Commander can read on demand.',
        )
      : activeTab === 'processGuides'
        ? translateOrFallback(
            'settings.processGuides.subtitle',
            'Edit the process-specific guidance that Commander injects on demand.',
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

                  {activeTab === 'guides' && (
                    <SettingsGuidesSection
                      templates={templates}
                      workflowEntries={workflowEntries}
                      onAddTemplate={(template) => dispatch(addCustomTemplate(template))}
                      onRemoveTemplate={(id) => dispatch(removeCustomTemplate(id))}
                      onRenameTemplate={(payload) => dispatch(renameTemplate(payload))}
                      onSetTemplateContent={(payload) => dispatch(setCustomContent(payload))}
                      onResetAllTemplates={() => dispatch(resetAllContent())}
                      onResetTemplate={(id) => dispatch(resetContent(id))}
                      onAddWorkflowEntry={(entry) => dispatch(addWorkflowEntry(entry))}
                      onUpdateWorkflowEntry={(payload) => dispatch(updateWorkflowEntry(payload))}
                      onRemoveWorkflowEntry={(id) => dispatch(removeWorkflowEntry(id))}
                    />
                  )}

                  {activeTab === 'processGuides' && <SettingsProcessPromptsSection />}

                  {activeTab === 'commander' && <SettingsCommanderSection />}

                  {activeTab === 'storage' && <SettingsStorageSection />}

                  {activeTab === 'usage' && <SettingsUsageSection />}

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
