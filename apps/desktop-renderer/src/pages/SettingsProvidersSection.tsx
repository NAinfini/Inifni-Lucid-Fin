import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Cpu,
  ExternalLink,
  Eye,
  EyeOff,
  Image,
  Plus,
  Trash2,
  Video,
  Volume2,
  Zap,
} from 'lucide-react';
import type { LLMProviderProtocol } from '@lucid-fin/contracts';
import { getAPI } from '../utils/api.js';
import { t } from '../i18n.js';
import type { RootState } from '../store/index.js';
import {
  addCustomProvider,
  getProviderDefaults,
  getProviderMetadata,
  removeCustomProvider,
  resetProviderToDefaults,
  setProviderBaseUrl,
  setProviderHasKey,
  setProviderModel,
  setProviderName,
  setProviderProtocol,
  type APIGroup,
  type ProviderConfig,
  type ProviderMetadata,
} from '../store/slices/settings.js';
import { translateOrFallback } from '../components/settings/SettingsSidebarNav.js';
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

interface SettingsProvidersSectionProps {
  onProviderSubTabChange: (group: APIGroup) => void;
  providerSubTab: APIGroup;
}

export function SettingsProvidersSection({
  onProviderSubTabChange,
  providerSubTab,
}: SettingsProvidersSectionProps) {
  return (
    <>
      <div className="mb-3 flex gap-1 rounded-md border border-border/60 bg-muted/30 p-0.5">
        {(Object.keys(GROUP_META) as APIGroup[]).map((group) => {
          const meta = GROUP_META[group];
          const Icon = meta.icon;

          return (
            <button
              key={group}
              type="button"
              onClick={() => onProviderSubTabChange(group)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors',
                providerSubTab === group
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {translateOrFallback(meta.labelKey, group.toUpperCase())}
            </button>
          );
        })}
      </div>
      <ProviderGroupSection group={providerSubTab} />
    </>
  );
}

function ProviderCard({
  group,
  metadata,
  provider,
}: {
  group: APIGroup;
  metadata?: ProviderMetadata;
  provider: ProviderConfig;
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
  const keyUrl = metadata?.keyUrl;
  const docsUrl = metadata?.docsUrl;
  const showHubGuidance = metadata?.kind === 'hub';
  const providerDefaults = getProviderDefaults(group, provider.id);
  const isBuiltinProvider = !provider.isCustom && providerDefaults !== undefined;
  const isCustomized = Boolean(
    providerDefaults
    && (
      provider.baseUrl !== providerDefaults.baseUrl
      || provider.model !== providerDefaults.model
      || provider.protocol !== providerDefaults.protocol
      || provider.authStyle !== providerDefaults.authStyle
    ),
  );
  const displayName = provider.isCustom
    ? provider.name
    : translateOrFallback(`providerNames.${provider.id}`, provider.name);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

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
        setTimeout(() => {
          if (mountedRef.current) setSaved(false);
        }, 2000);
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

  async function handleCopyKey() {
    if (!keyValue) return;
    await navigator.clipboard.writeText(keyValue);
  }

  async function handleTestConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await getAPI()?.keychain.test(
        provider.id,
        {
          authStyle: provider.authStyle,
          baseUrl: provider.baseUrl,
          id: provider.id,
          model: provider.model,
          name: provider.name,
          protocol: provider.protocol,
        },
        group,
      );
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
        'rounded-md border transition-colors',
        expanded ? 'border-primary/40 bg-primary/5' : 'border-border/60 bg-card',
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {provider.isCustom ? (
              <input
                type="text"
                value={provider.name}
                onChange={(e) =>
                  dispatch(setProviderName({ group, provider: provider.id, name: e.target.value }))
                }
                className="border-b border-transparent bg-transparent text-xs font-medium hover:border-border focus:border-primary focus:outline-none"
              />
            ) : (
              <span className="text-xs font-medium">{displayName}</span>
            )}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">{provider.baseUrl}</div>
        </div>

        <div className="flex items-center gap-2">
          {isCustomized ? (
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              {t('settings.providerCard.customized')}
            </span>
          ) : null}
          {provider.hasKey ? (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <Check className="h-3 w-3" /> {t('settings.providerCard.keySet')}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">{t('settings.providerCard.noKey')}</span>
          )}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            aria-label={
              expanded ? t('settings.providerCard.collapse') : t('settings.providerCard.expand')
            }
          >
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-2.5 border-t border-border/40 px-3 py-2.5">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] text-muted-foreground">
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
                className="w-full rounded border border-border bg-secondary px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {provider.model !== undefined && (
              <div>
                <label className="mb-1 block text-[10px] text-muted-foreground">
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
                  className="w-full rounded border border-border bg-secondary px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {showHubGuidance && (
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>
                      {metadata?.modelExample
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
                        <ExternalLink className="h-3 w-3" />
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
              <label className="mb-1 block text-[10px] text-muted-foreground">
                {t('settings.providerCard.protocol')}
              </label>
              <select
                value={provider.protocol ?? 'openai-compatible'}
                onChange={(e) =>
                  dispatch(
                    setProviderProtocol({
                      group,
                      provider: provider.id,
                      protocol: e.target.value as LLMProviderProtocol,
                    }),
                  )
                }
                className="w-full rounded border border-border bg-secondary px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
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
                <option value="gemini">{t('settings.providerCard.protocolOptions.gemini')}</option>
                <option value="cohere">{t('settings.providerCard.protocolOptions.cohere')}</option>
              </select>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {t('settings.providerCard.authLabel')}{' '}
                {t(`settings.providerCard.authStyles.${provider.authStyle ?? 'bearer'}`)}
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-[10px] text-muted-foreground">
              {t('settings.providerCard.apiKey')}
            </label>
            <div className="space-y-2">
              {provider.hasKey && (
                <div className="flex items-center gap-1 text-xs text-green-400">
                  <Check className="h-3 w-3" /> {t('settings.providerCard.configuredInKeychain')}
                </div>
              )}
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center overflow-hidden rounded border border-border bg-secondary">
                  <input
                    type={keyVisible ? 'text' : 'password'}
                    placeholder={t('settings.providerCard.keyPlaceholder')}
                    value={keyValue}
                    onChange={(e) => setKeyValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleSaveKey();
                    }}
                    className="flex-1 bg-transparent px-2 py-1 text-xs focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setKeyVisible((value) => !value)}
                    className="px-2 py-1 text-muted-foreground hover:text-foreground"
                  >
                    {keyVisible ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                </div>
                {provider.hasKey && (
                  <button
                    type="button"
                    onClick={() => void handleCopyKey()}
                    disabled={!keyValue}
                    aria-label="Copy Key"
                    className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleSaveKey()}
                  disabled={saving}
                  className={cn(
                    'rounded px-2 py-1 text-xs transition-colors disabled:opacity-50',
                    saved ? 'bg-emerald-500 text-white' : 'bg-primary text-primary-foreground',
                  )}
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

          <div className="flex flex-wrap items-center gap-2">
            {isBuiltinProvider && isCustomized ? (
              <button
                type="button"
                onClick={() =>
                  dispatch(resetProviderToDefaults({ group, provider: provider.id }))
                }
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
              >
                {t('settings.providerCard.resetToDefaults')}
              </button>
            ) : null}
            {provider.isCustom && (
              <button
                type="button"
                onClick={() => dispatch(removeCustomProvider({ group, provider: provider.id }))}
                className="inline-flex items-center gap-1 rounded border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-3 w-3" />
                {t('settings.providerCard.removeProvider')}
              </button>
            )}
            {keyUrl && (
              <button
                type="button"
                onClick={() => getAPI()?.openExternal(keyUrl)}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                {t('settings.providerCard.getApiKey')}
              </button>
            )}
            {provider.hasKey && (
              <button
                type="button"
                onClick={() => void handleTestConnection()}
                disabled={testing}
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
              >
                <Zap className="h-3 w-3" />
                {testing
                  ? t('settings.providerCard.testing')
                  : t('settings.providerCard.testConnection')}
              </button>
            )}
            {testResult === 'ok' && (
              <span className="flex items-center gap-1 text-xs text-green-400">
                <Check className="h-3 w-3" /> {t('settings.providerCard.connected')}
              </span>
            )}
            {testResult === 'fail' && (
              <span className="flex items-center gap-1 text-xs text-destructive">
                <AlertCircle className="h-3 w-3" /> {t('settings.providerCard.connectionFailed')}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ProviderSubsection({
  group,
  providers,
  title,
}: {
  group: APIGroup;
  providers: Array<{ metadata?: ProviderMetadata; provider: ProviderConfig }>;
  title: string;
}) {
  if (providers.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <div className="px-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">
        {title}
      </div>
      {providers.map(({ metadata, provider }) => (
        <ProviderCard key={provider.id} group={group} metadata={metadata} provider={provider} />
      ))}
    </div>
  );
}

function ProviderGroupSection({ group }: { group: APIGroup }) {
  const dispatch = useDispatch();
  const groupState = useSelector((state: RootState) => state.settings[group]);
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
  const providerIdsKey = useMemo(
    () => groupState.providers.map((provider) => provider.id).join('|'),
    [groupState.providers],
  );

  useEffect(() => {
    let mounted = true;
    const api = getAPI();
    if (!api) return;
    const providerIds = providerIdsKey ? providerIdsKey.split('|') : [];

    for (const id of providerIds) {
      void api.keychain.isConfigured(id).then((configured) => {
        if (mounted) dispatch(setProviderHasKey({ group, provider: id, hasKey: configured }));
      });
    }

    return () => {
      mounted = false;
    };
  }, [dispatch, group, providerIdsKey]);

  function handleAddCustom() {
    if (!customName.trim()) return;
    const id = `custom-${group}-${Date.now()}`;
    dispatch(addCustomProvider({ group, id, name: customName.trim() }));
    setCustomName('');
    setAddingCustom(false);
  }

  return (
    <section className="mb-6">
      <div className="space-y-3">
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
          <div className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2.5">
            <input
              type="text"
              placeholder={t('settings.customProvider.namePlaceholder')}
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddCustom();
              }}
              autoFocus
              className="flex-1 rounded-md border border-border/60 bg-secondary px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={handleAddCustom}
              disabled={!customName.trim()}
              className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
            >
              {t('action.add')}
            </button>
            <button
              type="button"
              onClick={() => {
                setAddingCustom(false);
                setCustomName('');
              }}
              className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              {t('action.cancel')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddingCustom(true)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border/60 px-3 py-2.5 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground"
          >
            <Plus className="h-4 w-4" />
            {t('settings.customProvider.add')}
          </button>
        )}
      </div>
    </section>
  );
}
