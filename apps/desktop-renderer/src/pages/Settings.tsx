import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Key,
  Eye,
  EyeOff,
  Trash2,
  Check,
  Copy,
  RotateCcw,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Cpu,
  Image,
  Video,
  Volume2,
  ExternalLink,
  Zap,
  AlertCircle,
  Plus,
  Download,
  Loader2,
  Workflow,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getAPI } from '../utils/api.js';
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
import { Progress } from '../components/ui/Progress.js';
import {
  setProviderBaseUrl,
  setProviderModel,
  setProviderProtocol,
  setProviderHasKey,
  setProviderName,
  addCustomProvider,
  removeCustomProvider,
  getProviderMetadata,
  type APIGroup,
  type ProviderMetadata,
  type ProviderConfig,
} from '../store/slices/settings.js';
import {
  setCustomContent,
  resetContent,
  resetAllContent,
} from '../store/slices/promptTemplates.js';
import { cn } from '../lib/utils.js';

const GROUP_META: Record<
  APIGroup,
  { labelKey: string; icon: React.ComponentType<{ className?: string }> }
> = {
  llm: { labelKey: 'settings.group.llm', icon: Cpu },
  image: { labelKey: 'settings.group.image', icon: Image },
  video: { labelKey: 'settings.group.video', icon: Video },
  audio: { labelKey: 'settings.group.audio', icon: Volume2 },
};

function WorkflowsPlaceholderSection() {
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-dashed border-border bg-card/60 p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-primary/20 bg-primary/10 p-2 text-primary">
            <Workflow className="h-5 w-5" />
          </div>
          <div className="space-y-2">
            <div className="text-base font-semibold">
              {translateOrFallback('settings.workflows.title', 'Workflows & Skills')}
            </div>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              {translateOrFallback(
                'settings.workflows.description',
                'Workflow and skill management will land here in the next step.',
              )}
            </p>
          </div>
        </div>
      </div>
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="text-sm font-medium">
          {translateOrFallback('settings.workflows.placeholderTitle', 'Planned surface')}
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          {translateOrFallback(
            'settings.workflows.placeholderDescription',
            'Built-in workflows and skills will appear alongside editable custom entries here, while existing settings behavior stays unchanged until that work lands.',
          )}
        </p>
      </div>
    </section>
  );
}

function ProviderCard({
  group,
  provider,
  metadata,
}: {
  group: APIGroup;
  provider: ProviderConfig;
  metadata?: ProviderMetadata;
}) {
  const dispatch = useDispatch();
  const [expanded, setExpanded] = useState(false);
  const [keyValue, setKeyValue] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [keyLoaded, setKeyLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );
  const keyUrl = metadata?.keyUrl;
  const docsUrl = metadata?.docsUrl;
  const showHubGuidance = metadata?.kind === 'hub';

  useEffect(() => {
    if (!expanded || !provider.hasKey || keyLoaded) return;
    const api = getAPI();
    if (!api?.keychain.get) return;

    let cancelled = false;
    void api.keychain.get(provider.id).then((storedKey) => {
      if (cancelled || !mountedRef.current) return;
      setKeyValue(storedKey ?? '');
      setKeyLoaded(true);
    });

    return () => {
      cancelled = true;
    };
  }, [expanded, keyLoaded, provider.hasKey, provider.id]);

  async function handleSaveKey() {
    setSaving(true);
    try {
      const trimmed = keyValue.trim();
      if (trimmed) {
        await getAPI()?.keychain.set(provider.id, trimmed);
        if (!mountedRef.current) return;
        dispatch(setProviderHasKey({ group, provider: provider.id, hasKey: true }));
        setKeyValue(trimmed);
        setKeyLoaded(true);
        setSaved(true);
        setTimeout(() => { if (mountedRef.current) setSaved(false); }, 2000);
      } else {
        await getAPI()?.keychain.delete(provider.id);
        if (!mountedRef.current) return;
        dispatch(setProviderHasKey({ group, provider: provider.id, hasKey: false }));
        setKeyValue('');
        setKeyLoaded(false);
        setKeyVisible(false);
        setTestResult(null);
      }
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }

  async function handleDeleteKey() {
    await getAPI()?.keychain.delete(provider.id);
    if (!mountedRef.current) return;
    dispatch(setProviderHasKey({ group, provider: provider.id, hasKey: false }));
    setKeyValue('');
    setKeyLoaded(false);
    setKeyVisible(false);
    setTestResult(null);
  }

  async function handleCopyKey() {
    if (!keyValue) return;
    await navigator.clipboard.writeText(keyValue);
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await getAPI()?.keychain.test(provider.id, {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
        model: provider.model,
        protocol: provider.protocol,
        authStyle: provider.authStyle,
      }, group);
      if (!mountedRef.current) return;
      setTestResult(result?.ok ? 'ok' : 'fail');
    } catch {
      if (!mountedRef.current) return;
      setTestResult('fail');
    } finally {
      if (mountedRef.current) setTesting(false);
    }
  }

  return (
    <div
      className={cn(
        'rounded-xl border transition-colors',
        expanded ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {provider.isCustom ? (
              <input
                type="text"
                value={provider.name}
                onChange={(e) =>
                  dispatch(setProviderName({ group, provider: provider.id, name: e.target.value }))
                }
                className="text-sm font-medium bg-transparent border-b border-transparent hover:border-border focus:border-primary focus:outline-none"
              />
            ) : (
              <span className="text-sm font-medium">{provider.name}</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">{provider.baseUrl}</div>
        </div>

        <div className="flex items-center gap-2">
          {provider.hasKey ? (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <Check className="w-3 h-3" /> {t('settings.providerCard.keySet')}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {t('settings.providerCard.noKey')}
            </span>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="p-1 rounded hover:bg-muted text-muted-foreground"
            aria-label={
              expanded ? t('settings.providerCard.collapse') : t('settings.providerCard.expand')
            }
          >
            {expanded ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded config */}
      {expanded && (
        <div className="border-t border-border/60 px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-muted-foreground mb-1">
                {t('settings.providerCard.baseUrl')}
              </label>
              <input
                type="url"
                value={provider.baseUrl}
                onChange={(e) =>
                  dispatch(
                    setProviderBaseUrl({ group, provider: provider.id, url: e.target.value }),
                  )
                }
                className="w-full px-2 py-1 text-xs rounded bg-secondary border border-border focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {provider.model !== undefined && (
              <div>
                <label className="block text-[10px] text-muted-foreground mb-1">
                  {t('settings.providerCard.model')}
                </label>
                <input
                  type="text"
                  value={provider.model}
                  onChange={(e) =>
                    dispatch(
                      setProviderModel({ group, provider: provider.id, model: e.target.value }),
                    )
                  }
                  className="w-full px-2 py-1 text-xs rounded bg-secondary border border-border focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {showHubGuidance && (
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>
                      {metadata.modelExample
                        ? `${translateOrFallback('settings.providerCard.modelExample', 'Example:')} ${metadata.modelExample}`
                        : translateOrFallback(
                            'settings.providerCard.modelExampleEmpty',
                            'No official model example yet',
                          )}
                    </span>
                    {docsUrl && (
                      <button
                        type="button"
                        onClick={() => getAPI()?.openExternal(docsUrl)}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        <ExternalLink className="w-3 h-3" />
                        {translateOrFallback('settings.providerCard.viewModels', 'View Models')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {group === 'llm' && provider.isCustom && (
            <div>
              <label className="block text-[10px] text-muted-foreground mb-1">
                {t('settings.providerCard.protocol')}
              </label>
              <select
                value={provider.protocol ?? 'openai-compatible'}
                onChange={(e) =>
                  dispatch(
                    setProviderProtocol({
                      group,
                      provider: provider.id,
                      protocol: e.target
                        .value as import('@lucid-fin/contracts').LLMProviderProtocol,
                    }),
                  )
                }
                className="w-full px-2 py-1 text-xs rounded bg-secondary border border-border focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="openai-compatible">
                  {t('settings.providerCard.protocolOptions.openaiCompatible')}
                </option>
                <option value="openai-responses">
                  {t('settings.providerCard.protocolOptions.openaiResponses')}
                </option>
                <option value="anthropic">
                  {t('settings.providerCard.protocolOptions.anthropic')}
                </option>
                <option value="gemini">
                  {t('settings.providerCard.protocolOptions.gemini')}
                </option>
                <option value="cohere">
                  {t('settings.providerCard.protocolOptions.cohere')}
                </option>
              </select>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {t('settings.providerCard.authLabel')}{' '}
                {t(`settings.providerCard.authStyles.${provider.authStyle ?? 'bearer'}`)}
              </div>
            </div>
          )}

          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">
              {t('settings.providerCard.apiKey')}
            </label>
            <div className="space-y-2">
              {provider.hasKey && (
                <div className="flex items-center gap-1 text-xs text-green-400">
                  <Check className="w-3 h-3" /> {t('settings.providerCard.configuredInKeychain')}
                </div>
              )}
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center rounded border border-border bg-secondary overflow-hidden">
                  <input
                    type={keyVisible ? 'text' : 'password'}
                    placeholder={t('settings.providerCard.keyPlaceholder')}
                    value={keyValue}
                    onChange={(e) => setKeyValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleSaveKey();
                    }}
                    className="flex-1 px-2 py-1 text-xs bg-transparent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setKeyVisible((v) => !v)}
                    className="px-2 py-1 text-muted-foreground hover:text-foreground"
                  >
                    {keyVisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                </div>
                {provider.hasKey && (
                  <button
                    type="button"
                    onClick={() => void handleCopyKey()}
                    disabled={!keyValue}
                    aria-label="Copy Key"
                    className="px-2 py-1 text-xs rounded border border-border hover:bg-muted disabled:opacity-50"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleSaveKey()}
                  disabled={saving}
                  className={cn('px-2 py-1 text-xs rounded disabled:opacity-50 transition-colors', saved ? 'bg-emerald-500 text-white' : 'bg-primary text-primary-foreground')}
                >
                  {saving
                    ? t('settings.providerCard.saving')
                    : saved
                      ? t('settings.providerCard.saved')
                      : t('settings.providerCard.save')}
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {provider.isCustom && (
              <button
                type="button"
                onClick={() => dispatch(removeCustomProvider({ group, provider: provider.id }))}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-destructive/40 hover:bg-destructive/10 text-destructive"
              >
                <Trash2 className="w-3 h-3" />
                {t('settings.providerCard.removeProvider')}
              </button>
            )}
            {keyUrl && (
              <button
                type="button"
                onClick={() => getAPI()?.openExternal(keyUrl)}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="w-3 h-3" />
                {t('settings.providerCard.getApiKey')}
              </button>
            )}
            {provider.hasKey && (
              <button
                type="button"
                onClick={() => void handleTestConnection()}
                disabled={testing}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-border hover:bg-muted disabled:opacity-50"
              >
                <Zap className="w-3 h-3" />
                {testing
                  ? t('settings.providerCard.testing')
                  : t('settings.providerCard.testConnection')}
              </button>
            )}
            {testResult === 'ok' && (
              <span className="flex items-center gap-1 text-xs text-green-400">
                <Check className="w-3 h-3" /> {t('settings.providerCard.connected')}
              </span>
            )}
            {testResult === 'fail' && (
              <span className="flex items-center gap-1 text-xs text-destructive">
                <AlertCircle className="w-3 h-3" /> {t('settings.providerCard.connectionFailed')}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderSubsection({
  title,
  group,
  providers,
}: {
  title: string;
  group: APIGroup;
  providers: Array<{ provider: ProviderConfig; metadata?: ProviderMetadata }>;
}) {
  if (providers.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
        {title}
      </div>
      {providers.map(({ provider, metadata }) => (
        <ProviderCard
          key={provider.id}
          group={group}
          provider={provider}
          metadata={metadata}
        />
      ))}
    </div>
  );
}

function ProviderGroupSection({ group }: { group: APIGroup }) {
  const dispatch = useDispatch();
  const groupState = useSelector((state: RootState) => state.settings[group]);
  const { labelKey, icon: Icon } = GROUP_META[group];
  const [addingCustom, setAddingCustom] = useState(false);
  const [customName, setCustomName] = useState('');
  const builtinProviders = groupState.providers
    .map((provider) => ({ provider, metadata: getProviderMetadata(group, provider.id) }))
    .filter((entry) => entry.metadata);
  const officialProviders = builtinProviders.filter((entry) => entry.metadata?.kind === 'official');
  const hubProviders = builtinProviders.filter((entry) => entry.metadata?.kind === 'hub');
  const customProviders = groupState.providers
    .filter((provider) => !getProviderMetadata(group, provider.id))
    .map((provider) => ({ provider }));

  // Hydrate hasKey status on mount only
  const providerIds = groupState.providers.map((p) => p.id);
  useEffect(() => {
    let mounted = true;
    const api = getAPI();
    if (!api) return;
    for (const id of providerIds) {
      void api.keychain.isConfigured(id).then((configured) => {
        if (mounted) dispatch(setProviderHasKey({ group, provider: id, hasKey: configured }));
      });
    }
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleAddCustom() {
    if (!customName.trim()) return;
    const id = `custom-${group}-${Date.now()}`;
    dispatch(addCustomProvider({ group, id, name: customName.trim() }));
    setCustomName('');
    setAddingCustom(false);
  }

  return (
    <section className="mb-8">
      <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-2">
        <Icon className="w-3.5 h-3.5" />
        {t(labelKey)}
      </h2>
      <div className="space-y-4">
        <ProviderSubsection
          title={translateOrFallback('settings.providerSections.official', 'Official Providers')}
          group={group}
          providers={officialProviders}
        />
        <ProviderSubsection
          title={translateOrFallback('settings.providerSections.hub', 'API Hubs')}
          group={group}
          providers={hubProviders}
        />
        <ProviderSubsection
          title={translateOrFallback('settings.providerSections.custom', 'Custom Providers')}
          group={group}
          providers={customProviders}
        />
        {addingCustom ? (
          <div className="rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 flex items-center gap-2">
            <input
              type="text"
              placeholder={t('settings.customProvider.namePlaceholder')}
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddCustom();
              }}
              autoFocus
              className="flex-1 px-2 py-1 text-sm rounded bg-secondary border border-border focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={handleAddCustom}
              disabled={!customName.trim()}
              className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50"
            >
              {t('action.add')}
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingCustom(false);
                setCustomName('');
              }}
              className="px-2 py-1 text-xs rounded hover:bg-muted text-muted-foreground"
            >
              {t('action.cancel')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingCustom(true)}
            className="w-full rounded-xl border border-dashed border-border hover:border-primary/40 hover:bg-primary/5 px-4 py-3 flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t('settings.customProvider.add')}
          </button>
        )}
      </div>
    </section>
  );
}

interface UpdateInfo {
  version: string;
  releaseNotes?: string;
  releaseDate?: string;
}

interface UpdaterStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';
  progress?: number;
  info?: UpdateInfo;
  error?: string;
}

type UpdateState =
  | { phase: 'idle'; availableVersion?: string }
  | { phase: 'checking'; availableVersion?: string }
  | { phase: 'available'; availableVersion: string }
  | { phase: 'downloading'; progress: number; availableVersion?: string }
  | { phase: 'ready'; availableVersion: string }
  | { phase: 'error'; message: string; availableVersion?: string }
  | { phase: 'upToDate'; availableVersion?: string };

function clampProgress(value?: number): number {
  return Math.max(0, Math.min(100, Math.round(value ?? 0)));
}

function UpdateSection() {
  const [version, setVersion] = useState('');
  const [state, setState] = useState<UpdateState>({ phase: 'idle' });
  const checkRequestedRef = useRef(false);

  useEffect(() => {
    const api = getAPI();
    if (!api) return;

    let isMounted = true;

    const applyStatus = (status: UpdaterStatus) => {
      if (!isMounted) return;

      setState((current) => {
        const availableVersion = status.info?.version ?? current.availableVersion;

        switch (status.state) {
          case 'checking':
            return { phase: 'checking', availableVersion };
          case 'available':
            checkRequestedRef.current = false;
            return {
              phase: 'available',
              availableVersion: status.info?.version ?? availableVersion ?? '',
            };
          case 'downloading':
            checkRequestedRef.current = false;
            return {
              phase: 'downloading',
              progress: clampProgress(status.progress),
              availableVersion,
            };
          case 'downloaded':
            checkRequestedRef.current = false;
            return {
              phase: 'ready',
              availableVersion: status.info?.version ?? availableVersion ?? '',
            };
          case 'error':
            checkRequestedRef.current = false;
            return {
              phase: 'error',
              message: status.error ?? t('settings.update.error'),
              availableVersion,
            };
          case 'idle':
          default: {
            const completedCheck = checkRequestedRef.current || current.phase === 'checking';
            checkRequestedRef.current = false;
            return completedCheck
              ? { phase: 'upToDate', availableVersion }
              : { phase: 'idle', availableVersion };
          }
        }
      });
    };

    void api.app
      .version()
      .then((appVersion) => {
        if (isMounted) setVersion(appVersion);
      })
      .catch(() => {
        if (isMounted) setVersion('dev');
      });

    void api.updater
      .status()
      .then(applyStatus)
      .catch((error: unknown) => {
        if (!isMounted) return;
        setState({
          phase: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      });

    const unsubscribe = api.updater.onProgress((status) => applyStatus(status as UpdaterStatus));

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  async function handleCheck(): Promise<void> {
    const api = getAPI();
    if (!api) return;
    checkRequestedRef.current = true;
    setState((current) => ({ phase: 'checking', availableVersion: current.availableVersion }));
    try {
      await api.updater.check();
    } catch (error) {
      checkRequestedRef.current = false;
      setState((current) => ({
        phase: 'error',
        availableVersion: current.availableVersion,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function handleDownload(): Promise<void> {
    const api = getAPI();
    if (!api) return;
    setState((current) => ({
      phase: 'downloading',
      progress: current.phase === 'downloading' ? current.progress : 0,
      availableVersion: current.availableVersion,
    }));
    try {
      await api.updater.download();
    } catch (error) {
      setState((current) => ({
        phase: 'error',
        availableVersion: current.availableVersion,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async function handleInstall(): Promise<void> {
    const api = getAPI();
    if (!api) return;
    await api.updater.install();
  }

  return (
    <section className="mb-8">
      <h2 className="text-sm font-medium text-muted-foreground mb-3">
        {t('settings.update.title')}
      </h2>
      <div
        className={cn(
          'rounded-xl border p-4 space-y-4 transition-colors',
          state.phase === 'error'
            ? 'border-destructive/40 bg-destructive/5'
            : state.phase === 'available' ||
                state.phase === 'downloading' ||
                state.phase === 'ready'
              ? 'border-primary/40 bg-primary/5'
              : 'border-border bg-card',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-medium">Lucid Fin</div>
            <div className="text-xs text-muted-foreground">
              {t('settings.update.version')} {version || '...'}
            </div>
          </div>
        </div>

        {state.phase === 'idle' && (
          <button
            type="button"
            onClick={() => void handleCheck()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          >
            {t('settings.update.checkForUpdates')}
          </button>
        )}

        {state.phase === 'checking' && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('settings.update.checking')}
          </div>
        )}

        {state.phase === 'upToDate' && (
          <div className="flex items-center gap-2 text-xs text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            {t('settings.update.upToDate')}
          </div>
        )}

        {state.phase === 'available' && (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">{t('settings.update.available')}</div>
              <div className="text-xs text-muted-foreground">
                {t('settings.update.version')} {state.availableVersion}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleDownload()}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
            >
              <Download className="h-3.5 w-3.5" />
              {t('settings.update.download')}
            </button>
          </div>
        )}

        {state.phase === 'downloading' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>{t('settings.update.downloading')}</span>
              <span className="tabular-nums">{state.progress}%</span>
            </div>
            <Progress value={state.progress} />
          </div>
        )}

        {state.phase === 'ready' && (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-emerald-400">
                {t('settings.update.ready')}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('settings.update.version')} {state.availableVersion}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void handleInstall()}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white"
            >
              {t('settings.update.install')}
            </button>
          </div>
        )}

        {state.phase === 'error' && (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertCircle className="h-3.5 w-3.5" />
                {t('settings.update.error')}
              </div>
              <div className="text-xs text-muted-foreground break-words">{state.message}</div>
            </div>
            <button
              type="button"
              onClick={() => void handleCheck()}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-muted"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t('settings.update.retry')}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

export function Settings() {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const theme = useSelector((state: RootState) => state.ui.theme);
  const [locale, setLocaleState] = useState<Locale>(getLocale());
  const [activeTab, setActiveTab] = useState<SettingsTab>('providers');
  const templates = useSelector((state: RootState) => state.promptTemplates.templates);

  useEffect(() => {
    return onLocaleChange(() => setLocaleState(getLocale()));
  }, []);

  // Prompt template accordion state
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, string>>({});

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

  const handleTemplateDraftChange = useCallback((id: string, value: string) => {
    setTemplateDrafts((previous) => ({ ...previous, [id]: value }));
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
    (id: string, content: string) => {
      dispatch(setCustomContent({ id, content }));
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
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-center justify-center w-7 h-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label={t('settings.backToCanvas')}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Key className="w-5 h-5" />
            {t('settings.title')}
          </h1>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="mx-auto flex h-full max-w-6xl flex-col gap-6 px-4 py-6 md:flex-row">
          <SettingsSidebarNav activeTab={activeTab} onTabChange={handleTabChange} />

          <section className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex h-full flex-col">
              <div className="border-b border-border px-5 py-4">
                <div className="text-lg font-semibold">{activeTabTitle}</div>
                {activeTabDescription && (
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    {activeTabDescription}
                  </p>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
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
                    <>
                      <ProviderGroupSection group="llm" />
                      <ProviderGroupSection group="image" />
                      <ProviderGroupSection group="video" />
                      <ProviderGroupSection group="audio" />
                    </>
                  )}

                  {activeTab === 'promptTemplates' && (
                    <SettingsPromptTemplatesSection
                      expandedTemplateId={expandedTemplateId}
                      onExpandedTemplateIdChange={handleExpandedTemplateIdChange}
                      onResetAll={handleResetAllTemplates}
                      onResetTemplate={handleResetTemplate}
                      onSaveTemplate={handleSaveTemplate}
                      onTemplateDraftChange={handleTemplateDraftChange}
                      templateDrafts={templateDrafts}
                      templates={templates}
                    />
                  )}
                  {/* Header row — click to toggle */}

                  {activeTab === 'workflows' && <WorkflowsPlaceholderSection />}

                  {activeTab === 'about' && <UpdateSection />}
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
