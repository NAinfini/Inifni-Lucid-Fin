import React, { useState, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Key,
  Eye,
  EyeOff,
  Trash2,
  Check,
  Copy,
  FileText,
  RotateCcw,
  Save,
  ArrowLeft,
  Moon,
  Sun,
  ChevronDown,
  ChevronUp,
  Cpu,
  Image,
  Video,
  Volume2,
  Globe,
  ExternalLink,
  Zap,
  AlertCircle,
  Plus,
  Download,
  Loader2,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { getAPI } from '../utils/api.js';
import { t, setLocale, getLocale, onLocaleChange, type Locale } from '../i18n.js';
import type { RootState } from '../store/index.js';
import { setTheme } from '../store/slices/ui.js';
import { Progress } from '../components/ui/Progress.js';
import {
  setActiveProvider,
  setProviderBaseUrl,
  setProviderModel,
  setProviderHasKey,
  setProviderName,
  addCustomProvider,
  removeCustomProvider,
  type APIGroup,
  type ProviderConfig,
} from '../store/slices/settings.js';
import {
  setCustomContent,
  resetContent,
  resetAllContent,
} from '../store/slices/promptTemplates.js';
import { cn } from '../lib/utils.js';

const GROUP_META: Record<APIGroup, { labelKey: string; icon: React.ComponentType<{ className?: string }> }> = {
  llm: { labelKey: 'settings.group.llm', icon: Cpu },
  image: { labelKey: 'settings.group.image', icon: Image },
  video: { labelKey: 'settings.group.video', icon: Video },
  audio: { labelKey: 'settings.group.audio', icon: Volume2 },
};

const PROVIDER_KEY_URLS: Record<string, string> = {
  openai: 'https://platform.openai.com/api-keys',
  'openai-image': 'https://platform.openai.com/api-keys',
  'openai-tts': 'https://platform.openai.com/api-keys',
  claude: 'https://console.anthropic.com/settings/keys',
  gemini: 'https://aistudio.google.com/apikey',
  'google-imagen3': 'https://aistudio.google.com/apikey',
  'google-veo-2': 'https://aistudio.google.com/apikey',
  deepseek: 'https://platform.deepseek.com/api_keys',
  grok: 'https://console.x.ai/team/api-keys',
  flux: 'https://api.bfl.ml/auth/login',
  'recraft-v4': 'https://www.recraft.ai/account',
  'stability-image': 'https://platform.stability.ai/account/keys',
  'runway-gen4': 'https://docs.dev.runwayml.com/',
  'luma-ray2': 'https://lumalabs.ai/dream-machine/api',
  'minimax-video01': 'https://platform.minimaxi.com/api-key',
  'pika-v2': 'https://pika.art/api',
  elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
  'fish-audio-v1': 'https://fish.audio/dashboard',
  'cartesia-sonic': 'https://play.cartesia.ai/keys',
  'playht-3': 'https://play.ht/studio/api-access',
};

function ProviderCard({
  group,
  provider,
  isActive,
  onSetActive,
}: {
  group: APIGroup;
  provider: ProviderConfig;
  isActive: boolean;
  onSetActive: () => void;
}) {
  const dispatch = useDispatch();
  const [expanded, setExpanded] = useState(false);
  const [keyValue, setKeyValue] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [keyLoaded, setKeyLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const keyUrl = PROVIDER_KEY_URLS[provider.id];

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
    if (!keyValue.trim()) return;
    setSaving(true);
    try {
      await getAPI()?.keychain.set(provider.id, keyValue.trim());
      if (!mountedRef.current) return;
      dispatch(setProviderHasKey({ group, provider: provider.id, hasKey: true }));
      setKeyValue(keyValue.trim());
      setKeyLoaded(true);
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
      const result = await getAPI()?.keychain.test(provider.id, provider.baseUrl, provider.model);
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
        isActive ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onSetActive}
          aria-label={t('settings.providerCard.active')}
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
            isActive ? 'border-primary bg-primary' : 'border-muted-foreground',
          )}
        >
          {isActive && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
        </button>

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
            {isActive && (
              <span className="text-[10px] rounded-full bg-primary/20 text-primary px-1.5 py-0.5 font-medium">{t('settings.providerCard.active')}</span>
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
            <span className="text-xs text-muted-foreground">{t('settings.providerCard.noKey')}</span>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="p-1 rounded hover:bg-muted text-muted-foreground"
            aria-label={expanded ? t('settings.providerCard.collapse') : t('settings.providerCard.expand')}
          >
            {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded config */}
      {expanded && (
        <div className="border-t border-border/60 px-4 py-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-muted-foreground mb-1">{t('settings.providerCard.baseUrl')}</label>
              <input
                type="url"
                value={provider.baseUrl}
                onChange={(e) =>
                  dispatch(setProviderBaseUrl({ group, provider: provider.id, url: e.target.value }))
                }
                className="w-full px-2 py-1 text-xs rounded bg-secondary border border-border focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {provider.model !== undefined && (
              <div>
                <label className="block text-[10px] text-muted-foreground mb-1">{t('settings.providerCard.model')}</label>
                <input
                  type="text"
                  value={provider.model}
                  onChange={(e) =>
                    dispatch(setProviderModel({ group, provider: provider.id, model: e.target.value }))
                  }
                  className="w-full px-2 py-1 text-xs rounded bg-secondary border border-border focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-[10px] text-muted-foreground mb-1">{t('settings.providerCard.apiKey')}</label>
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
                    onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveKey(); }}
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
                  disabled={!keyValue.trim() || saving}
                  className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50"
                >
                  {saving ? t('settings.providerCard.saving') : t('settings.providerCard.save')}
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
                {testing ? t('settings.providerCard.testing') : t('settings.providerCard.testConnection')}
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

function ProviderGroupSection({ group }: { group: APIGroup }) {
  const dispatch = useDispatch();
  const groupState = useSelector((state: RootState) => state.settings[group]);
  const { labelKey, icon: Icon } = GROUP_META[group];
  const [addingCustom, setAddingCustom] = useState(false);
  const [customName, setCustomName] = useState('');

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
    return () => { mounted = false; };
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
      <div className="space-y-2">
        {groupState.providers.map((provider) => (
          <ProviderCard
            key={provider.id}
            group={group}
            provider={provider}
            isActive={groupState.activeProvider === provider.id}
            onSetActive={() => dispatch(setActiveProvider({ group, provider: provider.id }))}
          />
        ))}
        {addingCustom ? (
          <div className="rounded-xl border border-primary/40 bg-primary/5 px-4 py-3 flex items-center gap-2">
            <input
              type="text"
              placeholder={t('settings.customProvider.namePlaceholder')}
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddCustom(); }}
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
              onClick={() => { setAddingCustom(false); setCustomName(''); }}
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

    void api.app.version().then((appVersion) => {
      if (isMounted) setVersion(appVersion);
    }).catch(() => {
      if (isMounted) setVersion('dev');
    });

    void api.updater.status().then(applyStatus).catch((error: unknown) => {
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
              <div className="text-sm font-medium text-emerald-400">{t('settings.update.ready')}</div>
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
  const templates = useSelector((state: RootState) => state.promptTemplates.templates);

  useEffect(() => {
    return onLocaleChange(() => setLocaleState(getLocale()));
  }, []);

  // Prompt template accordion state
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);
  const [templateDrafts, setTemplateDrafts] = useState<Record<string, string>>({});

  return (
    <div className="h-full overflow-y-auto">
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="max-w-2xl mx-auto flex items-center gap-3 px-4 py-3">
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
      <div className="max-w-2xl mx-auto px-4 pt-6 pb-12">

        {/* Appearance */}
        <section className="mb-8">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">{t('settings.appearance.title')}</h2>
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
                {t('settings.appearance.theme')}
              </div>
              <div className="flex rounded-lg border border-border overflow-hidden text-sm">
                <button
                  type="button"
                  onClick={() => dispatch(setTheme('light'))}
                  className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${
                    theme === 'light'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" />
                  {t('settings.appearance.light')}
                </button>
                <button
                  type="button"
                  onClick={() => dispatch(setTheme('dark'))}
                  className={`px-3 py-1.5 flex items-center gap-1.5 transition-colors ${
                    theme === 'dark'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" />
                  {t('settings.appearance.dark')}
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-border pt-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Globe className="w-4 h-4" />
                {t('settings.appearance.language')}
              </div>
              <div className="flex rounded-lg border border-border overflow-hidden text-sm">
                <button
                  type="button"
                  onClick={() => { setLocale('zh-CN'); window.location.reload(); }}
                  className={`px-3 py-1.5 transition-colors ${
                    locale === 'zh-CN'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {t('settings.appearance.chinese')}
                </button>
                <button
                  type="button"
                  onClick={() => { setLocale('en-US'); window.location.reload(); }}
                  className={`px-3 py-1.5 transition-colors ${
                    locale === 'en-US'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {t('settings.appearance.english')}
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Provider groups */}
        <ProviderGroupSection group="llm" />
        <ProviderGroupSection group="image" />
        <ProviderGroupSection group="video" />
        <ProviderGroupSection group="audio" />

        {/* Prompt Templates */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="w-3.5 h-3.5" />
              {t('settings.promptTemplates')}
            </h2>
            {templates.some((tpl) => tpl.customContent !== null) && (
              <button
                onClick={() => {
                  dispatch(resetAllContent());
                  setExpandedTemplateId(null);
                  setTemplateDrafts({});
                }}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-muted text-muted-foreground"
              >
                <RotateCcw className="w-3 h-3" />
                {t('settings.resetAll')}
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            {templates.map((tpl) => {
              const isExpanded = expandedTemplateId === tpl.id;
              const isModified = tpl.customContent !== null;
              const draft = templateDrafts[tpl.id] ?? (tpl.customContent ?? tpl.defaultContent);

              return (
                <div
                  key={tpl.id}
                  className={cn(
                    'rounded-lg border transition-colors',
                    isExpanded ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
                  )}
                >
                  {/* Header row — click to toggle */}
                  <button
                    type="button"
                    onClick={() => {
                      if (isExpanded) {
                        setExpandedTemplateId(null);
                      } else {
                        setExpandedTemplateId(tpl.id);
                        // initialize draft from current content
                        setTemplateDrafts((prev) => ({
                          ...prev,
                          [tpl.id]: tpl.customContent ?? tpl.defaultContent,
                        }));
                      }
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left"
                  >
                    <span className="flex-1 text-sm font-medium">{tpl.name}</span>
                    {isModified && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 shrink-0">
                        {t('settings.customized')}
                      </span>
                    )}
                    <span className={cn(
                      'text-[10px] px-1.5 py-0.5 rounded shrink-0',
                      tpl.category === 'system' ? 'bg-violet-500/10 text-violet-400' :
                      tpl.category === 'core' ? 'bg-blue-500/10 text-blue-400' :
                      tpl.category === 'visual' ? 'bg-emerald-500/10 text-emerald-400' :
                      tpl.category === 'process' ? 'bg-amber-500/10 text-amber-400' :
                      'bg-muted text-muted-foreground',
                    )}>
                      {t(`settings.category.${tpl.category}`)}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    )}
                  </button>

                  {/* Expanded editor */}
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-2 border-t border-border/50 pt-2">
                      <textarea
                        value={draft}
                        onChange={(e) =>
                          setTemplateDrafts((prev) => ({ ...prev, [tpl.id]: e.target.value }))
                        }
                        rows={14}
                        className="w-full px-3 py-2 text-xs rounded bg-background border border-border resize-y font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <div className="flex items-center gap-2 justify-end">
                        {isModified && (
                          <button
                            onClick={() => {
                              dispatch(resetContent(tpl.id));
                              setTemplateDrafts((prev) => ({
                                ...prev,
                                [tpl.id]: tpl.defaultContent,
                              }));
                            }}
                            className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-muted text-muted-foreground"
                          >
                            <RotateCcw className="w-3 h-3" />
                            {t('settings.restoreDefault')}
                          </button>
                        )}
                        <button
                          onClick={() => setExpandedTemplateId(null)}
                          className="px-2 py-1 text-xs rounded hover:bg-muted text-muted-foreground"
                        >
                          {t('action.cancel')}
                        </button>
                        <button
                          onClick={() => {
                            dispatch(setCustomContent({ id: tpl.id, content: draft }));
                            setExpandedTemplateId(null);
                          }}
                          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-primary text-primary-foreground"
                        >
                          <Save className="w-3 h-3" />
                          {t('action.save')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* About & Updates */}
        <UpdateSection />
      </div>
    </div>
  );
}
