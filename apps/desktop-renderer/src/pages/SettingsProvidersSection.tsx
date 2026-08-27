import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  RotateCcw,
  ScanEye,
  Trash2,
  Video,
  Volume2,
  Zap,
} from 'lucide-react';
import type {
  LLMProviderProtocol,
  OAuthProviderStatus,
  OAuthProviderTarget,
} from '@lucid-fin/contracts';
import { getAPI } from '../utils/api.js';
import { t } from '../i18n.js';
import type { RootState } from '../store/index.js';
import { addLog } from '../store/slices/logger.js';
import { useToast } from '../hooks/use-toast.js';
import {
  addCustomProvider,
  commitProvider,
  getProviderDefaults,
  getProviderMetadata,
  removeCustomProvider,
  resetProviderToDefaults,
  setProviderHasKey,
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
  vision: { labelKey: 'settings.group.vision', icon: ScanEye },
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

type OAuthAction = 'login' | 'cancelLogin' | 'logout';

function OAuthProviderCard({
  metadata,
  provider,
}: {
  metadata: ProviderMetadata;
  provider: ProviderConfig;
}) {
  const dispatch = useDispatch();
  const { error: showErrorToast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<OAuthProviderStatus | null>(null);
  const [action, setAction] = useState<OAuthAction | null>(null);
  const [draftModel, setDraftModel] = useState(provider.model);
  const [draftReasoningEffort, setDraftReasoningEffort] = useState(provider.reasoningEffort ?? '');
  const oauthProvider = metadata.oauthTarget!.provider;
  const oauthCapability = metadata.oauthTarget!.capability;
  const target = useMemo<OAuthProviderTarget>(
    () => ({ provider: oauthProvider, capability: oauthCapability }),
    [oauthCapability, oauthProvider],
  );

  const displayName = translateOrFallback(`providerNames.${provider.id}`, provider.name);
  const statusState = status?.state;
  const readyStatus = status?.state === 'ready' ? status : null;
  const modelCapabilities = readyStatus?.modelCapabilities;
  const showModel = modelCapabilities?.supportsModelOverride === true;
  const showReasoningEffort = modelCapabilities?.supportsReasoningEffort === true;
  const configDirty =
    draftModel !== provider.model || draftReasoningEffort !== (provider.reasoningEffort ?? '');
  const statusIssue =
    status?.state === 'unavailable'
      ? status.reason
      : status?.state === 'error'
        ? status.message
        : null;
  const canSignIn =
    statusState === 'signedOut' ||
    status?.state === 'unavailable' ||
    (status?.state === 'error' && status.retryable);
  const canSignOut = status?.state === 'ready' || status?.state === 'error';

  const statusLabel =
    statusState === 'signedOut'
      ? t('settings.providerCard.oauth.signedOut')
      : statusState === 'signingIn'
        ? t('settings.providerCard.oauth.signingIn')
        : statusState === 'ready'
          ? t('settings.providerCard.oauth.ready')
          : statusState === 'error'
            ? t('settings.providerCard.oauth.error')
            : statusState === 'unavailable'
              ? t('settings.providerCard.oauth.unavailable')
              : t('settings.providerCard.oauth.checking');

  const statusClassName =
    statusState === 'ready'
      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-400'
      : statusState === 'error' || statusState === 'unavailable'
        ? 'border-destructive/30 bg-destructive/10 text-destructive'
        : statusState === 'signingIn'
          ? 'border-amber-400/30 bg-amber-400/10 text-amber-400'
          : 'border-border bg-muted/40 text-muted-foreground';

  useEffect(() => {
    const api = getAPI();
    const providerOAuth = api?.providerOAuth;
    if (!api || !providerOAuth) {
      setStatus({
        target,
        state: 'unavailable',
        reason: t('settings.providerCard.oauth.unavailable'),
      });
      return;
    }

    let mounted = true;
    const applyStatus = (nextStatus: OAuthProviderStatus) => {
      if (!sameOAuthTarget(nextStatus.target, target) || !mounted) return;
      setStatus(nextStatus);
      dispatch(
        setProviderHasKey({
          group: target.capability,
          provider: provider.id,
          hasKey: nextStatus.state === 'ready',
        }),
      );
    };
    const refresh = () => {
      void providerOAuth
        .status({ target })
        .then(applyStatus)
        .catch(() => {
          applyStatus({
            target,
            state: 'error',
            code: 'process_exited',
            message: t('settings.providerCard.oauth.actionFailed'),
            retryable: true,
          });
        });
    };

    const unsubscribeChanged = providerOAuth.onChanged(applyStatus);
    const unsubscribeReady = api.onReady(refresh);

    return () => {
      mounted = false;
      unsubscribeChanged();
      unsubscribeReady();
    };
  }, [dispatch, provider.id, target]);

  useEffect(() => {
    setDraftModel(provider.model);
    setDraftReasoningEffort(provider.reasoningEffort ?? '');
  }, [provider.model, provider.reasoningEffort]);

  function saveModelConfiguration() {
    if (!modelCapabilities) return;
    const model = draftModel.trim();
    const reasoningEffort = draftReasoningEffort.trim();
    const selected = modelCapabilities.models.find(
      (entry) => entry.model === model || entry.id === model,
    );
    if (!model || !selected) {
      showErrorToast({
        title: t('settings.providerCard.configurationInvalid'),
        message: t('settings.providerCard.modelUnavailable'),
      });
      return;
    }
    if (
      reasoningEffort &&
      (!modelCapabilities.supportsReasoningEffort ||
        !selected.supportedReasoningEfforts.includes(reasoningEffort))
    ) {
      showErrorToast({
        title: t('settings.providerCard.configurationInvalid'),
        message: t('settings.providerCard.reasoningEffortUnsupported'),
      });
      return;
    }
    dispatch(
      commitProvider({
        group: target.capability,
        providerId: provider.id,
        config: {
          baseUrl: provider.baseUrl,
          model,
          protocol: provider.protocol,
          authStyle: provider.authStyle,
          supportsModelOverride: modelCapabilities.supportsModelOverride,
          supportsReasoningEffort: modelCapabilities.supportsReasoningEffort,
          reasoningEffortsByModel: Object.fromEntries(
            modelCapabilities.models.map((entry) => [entry.model, entry.supportedReasoningEfforts]),
          ),
          reasoningEffort: reasoningEffort || undefined,
        },
      }),
    );
    setDraftModel(model);
    setDraftReasoningEffort(reasoningEffort);
  }

  async function runAuthAction(nextAction: OAuthAction) {
    const providerOAuth = getAPI()?.providerOAuth;
    if (!providerOAuth || action) return;

    setAction(nextAction);
    try {
      setStatus(await providerOAuth[nextAction]({ target }));
    } catch {
      const title = t('settings.providerCard.oauth.actionFailed');
      dispatch(
        addLog({
          level: 'error',
          category: 'provider',
          message: title,
          detail: `${target.capability}:${provider.id}`,
        }),
      );
      showErrorToast({ title, message: title });
    } finally {
      setAction(null);
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
          <div className="text-xs font-medium">{displayName}</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {t('settings.providerCard.oauth.managedAuth')}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-medium',
              statusClassName,
            )}
          >
            {statusLabel}
          </span>
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
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded border border-border/60 bg-secondary/40 px-2 py-1.5">
              <div className="text-[10px] text-muted-foreground">
                {t('settings.providerCard.oauth.plan')}
              </div>
              <div className="mt-0.5 font-medium">
                {readyStatus
                  ? (readyStatus.planType ?? t('settings.providerCard.oauth.planUnknown'))
                  : '—'}
              </div>
            </div>
            <div className="rounded border border-border/60 bg-secondary/40 px-2 py-1.5">
              <div className="text-[10px] text-muted-foreground">
                {t('settings.providerCard.oauth.capability')}
              </div>
              <div className="mt-0.5 font-medium text-emerald-400">
                {translateOrFallback(GROUP_META[target.capability].labelKey, target.capability)}
              </div>
            </div>
          </div>

          {readyStatus && <OAuthUsagePanel status={readyStatus} />}

          {(showModel || showReasoningEffort) && (
            <div className="grid grid-cols-2 gap-2">
              {showModel && (
                <div>
                  <label className="mb-1 block text-[10px] text-muted-foreground">
                    {t('settings.providerCard.model')}
                  </label>
                  <input
                    type="text"
                    value={draftModel}
                    onChange={(event) => setDraftModel(event.target.value)}
                    className="w-full rounded border border-border bg-secondary px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              )}
              {showReasoningEffort && (
                <div>
                  <label className="mb-1 block text-[10px] text-muted-foreground">
                    {t('settings.providerCard.reasoningStrength')}
                  </label>
                  <input
                    type="text"
                    value={draftReasoningEffort}
                    onChange={(event) => setDraftReasoningEffort(event.target.value)}
                    className="w-full rounded border border-border bg-secondary px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              )}
            </div>
          )}

          {configDirty && modelCapabilities && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveModelConfiguration}
                className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
              >
                {t('settings.providerCard.save')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraftModel(provider.model);
                  setDraftReasoningEffort(provider.reasoningEffort ?? '');
                }}
                className="rounded border border-border px-2 py-1 text-xs hover:bg-muted"
              >
                {t('settings.providerCard.discard')}
              </button>
            </div>
          )}

          {statusIssue && (
            <div className="flex items-start gap-1.5 rounded border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>{statusIssue}</div>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {t('settings.providerCard.oauth.noFallback')}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            {canSignIn && (
              <button
                type="button"
                onClick={() => void runAuthAction('login')}
                disabled={action !== null}
                className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
              >
                {t('settings.providerCard.oauth.signIn')}
              </button>
            )}
            {statusState === 'signingIn' && (
              <button
                type="button"
                onClick={() => void runAuthAction('cancelLogin')}
                disabled={action !== null}
                className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
              >
                {t('settings.providerCard.oauth.cancelSignIn')}
              </button>
            )}
            {canSignOut && (
              <button
                type="button"
                onClick={() => void runAuthAction('logout')}
                disabled={action !== null}
                className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
              >
                {t('settings.providerCard.oauth.signOut')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function OAuthUsagePanel({ status }: { status: Extract<OAuthProviderStatus, { state: 'ready' }> }) {
  if (status.usage.state === 'unavailable') {
    return (
      <div className="rounded border border-border/60 bg-secondary/30 px-2 py-2 text-[11px] text-muted-foreground">
        <div>{status.usage.reason}</div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded border border-border/60 bg-secondary/30 px-2 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {t('settings.providerCard.oauth.usageLeft')}
      </div>
      {status.usage.windows.map((window) => (
        <div key={window.id} className="space-y-1">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span>{window.label}</span>
            <span className="font-medium">{Math.round(window.remainingPercent)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-emerald-400 transition-[width]"
              style={{ width: `${window.remainingPercent}%` }}
            />
          </div>
          {window.resetsAt && (
            <div className="text-[10px] text-muted-foreground">
              {t('settings.providerCard.oauth.resetsAt')}{' '}
              {new Date(window.resetsAt).toLocaleString()}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function sameOAuthTarget(left: OAuthProviderTarget, right: OAuthProviderTarget): boolean {
  return left.provider === right.provider && left.capability === right.capability;
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
  if (metadata?.credentialMode === 'oauth' && metadata.oauthTarget) {
    return <OAuthProviderCard metadata={metadata} provider={provider} />;
  }

  return <ApiKeyProviderCard group={group} metadata={metadata} provider={provider} />;
}

function ApiKeyProviderCard({
  group,
  metadata,
  provider,
}: {
  group: APIGroup;
  metadata?: ProviderMetadata;
  provider: ProviderConfig;
}) {
  const dispatch = useDispatch();
  const { error: showErrorToast } = useToast();
  const [expanded, setExpanded] = useState(false);

  // --- Draft state (local, not Redux) ---
  const [draftBaseUrl, setDraftBaseUrl] = useState(provider.baseUrl);
  const [draftModel, setDraftModel] = useState(provider.model);
  const [draftReasoningEffort, setDraftReasoningEffort] = useState(provider.reasoningEffort ?? '');
  const [draftProtocol, setDraftProtocol] = useState<LLMProviderProtocol | undefined>(
    provider.protocol,
  );
  const [draftName, setDraftName] = useState(provider.name);
  const [draftKey, setDraftKey] = useState('');
  const [loadedKey, setLoadedKey] = useState('');

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
  const isLLMConfiguration = group === 'llm' || group === 'vision';
  const showModel =
    !isLLMConfiguration || provider.isCustom || provider.supportsModelOverride !== false;
  const showReasoningEffort =
    isLLMConfiguration && (provider.isCustom || provider.supportsReasoningEffort !== false);

  // Dirty detection: compare draft against committed Redux state + loaded key
  const configDirty =
    draftBaseUrl !== provider.baseUrl ||
    draftModel !== provider.model ||
    draftReasoningEffort !== (provider.reasoningEffort ?? '') ||
    draftProtocol !== provider.protocol ||
    (provider.isCustom && draftName !== provider.name);
  const keyDirty = draftKey !== loadedKey;
  const isDirty = configDirty || keyDirty;

  // "Customized" badge: compare committed Redux state against registry defaults
  const isCustomized = Boolean(
    providerDefaults &&
    (provider.baseUrl !== providerDefaults.baseUrl ||
      provider.model !== providerDefaults.model ||
      provider.protocol !== providerDefaults.protocol ||
      provider.authStyle !== providerDefaults.authStyle),
  );

  const displayName = provider.isCustom
    ? expanded
      ? draftName
      : provider.name
    : translateOrFallback(`providerNames.${provider.id}`, provider.name);
  const KEY_LOAD_RETRY_DELAY_MS = 150;
  const MAX_KEY_LOAD_ATTEMPTS = 3;

  function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function getErrorDetail(error: unknown): string {
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
  }

  const logProviderFailure = useCallback(
    (message: string, error: unknown) => {
      dispatch(
        addLog({
          level: 'error',
          category: 'provider',
          message,
          detail: `${group}:${provider.id}\n${getErrorDetail(error)}`,
        }),
      );
    },
    [dispatch, group, provider.id],
  );

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Sync draft from Redux when committed state changes (e.g. after reset-to-defaults)
  useEffect(() => {
    setDraftBaseUrl(provider.baseUrl);
    setDraftModel(provider.model);
    setDraftReasoningEffort(provider.reasoningEffort ?? '');
    setDraftProtocol(provider.protocol);
    setDraftName(provider.name);
  }, [
    provider.baseUrl,
    provider.model,
    provider.name,
    provider.protocol,
    provider.reasoningEffort,
  ]);

  // Load API key from keychain when card expands
  useEffect(() => {
    if (!expanded || !provider.hasKey || keyLoaded) return;
    const api = getAPI();
    if (!api) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const loadKey = (attempt: number) => {
      void api.keychain
        .getMasked(provider.id)
        .then((storedKey) => {
          if (cancelled || !mountedRef.current) return;
          const value = storedKey ?? '';
          setDraftKey(value);
          setLoadedKey(value);
          setKeyLoaded(true);
        })
        .catch((error) => {
          if (cancelled || !mountedRef.current) return;
          if (attempt + 1 < MAX_KEY_LOAD_ATTEMPTS) {
            retryTimer = setTimeout(() => {
              loadKey(attempt + 1);
            }, KEY_LOAD_RETRY_DELAY_MS);
            return;
          }
          logProviderFailure(t('settings.providerCard.log.keyLoadFailed'), error);
        });
    };

    loadKey(0);

    return () => {
      cancelled = true;
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
      }
    };
  }, [expanded, keyLoaded, logProviderFailure, provider.hasKey, provider.id]);

  // --- Unified save: config + API key in one action ---
  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const api = getAPI();
      if (!api) throw new Error('API not available');
      const model = draftModel.trim();
      const reasoningEffort = draftReasoningEffort.trim();
      if (configDirty && showModel && !model) {
        throw new Error(t('settings.providerCard.modelUnavailable'));
      }
      if (reasoningEffort && !showReasoningEffort) {
        throw new Error(t('settings.providerCard.reasoningEffortUnsupported'));
      }
      const knownEfforts = provider.reasoningEffortsByModel?.[model];
      if (reasoningEffort && knownEfforts && !knownEfforts.includes(reasoningEffort)) {
        throw new Error(t('settings.providerCard.reasoningEffortUnsupported'));
      }

      // 1. Save API key to keychain if changed
      if (keyDirty) {
        const trimmedKey = draftKey.trim();
        if (trimmedKey) {
          await api.keychain.set(provider.id, trimmedKey);
          dispatch(setProviderHasKey({ group, provider: provider.id, hasKey: true }));
          setDraftKey(trimmedKey);
          setLoadedKey(trimmedKey);
          setKeyLoaded(true);
          setKeyVisible(false);
        } else {
          await api.keychain.delete(provider.id);
          dispatch(setProviderHasKey({ group, provider: provider.id, hasKey: false }));
          setDraftKey('');
          setLoadedKey('');
          setKeyLoaded(false);
          setKeyVisible(false);
          setTestResult(null);
        }
      }

      // 2. Commit config to Redux (triggers debounced persist)
      if (configDirty) {
        dispatch(
          commitProvider({
            group,
            providerId: provider.id,
            config: {
              baseUrl: draftBaseUrl,
              model: showModel ? model : provider.model,
              protocol: draftProtocol,
              supportsModelOverride: provider.supportsModelOverride,
              supportsReasoningEffort: provider.isCustom ? true : provider.supportsReasoningEffort,
              reasoningEffortsByModel: provider.reasoningEffortsByModel,
              reasoningEffort: reasoningEffort || undefined,
              name: provider.isCustom ? draftName : undefined,
            },
          }),
        );
      }

      setSaved(true);
      setTimeout(() => {
        if (mountedRef.current) setSaved(false);
      }, 2000);
    } catch (error) {
      const title = t('settings.providerCard.configurationFailed');
      logProviderFailure(title, error);
      showErrorToast({
        title,
        message: getErrorMessage(error),
      });
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    setDraftBaseUrl(provider.baseUrl);
    setDraftModel(provider.model);
    setDraftReasoningEffort(provider.reasoningEffort ?? '');
    setDraftProtocol(provider.protocol);
    setDraftName(provider.name);
    setDraftKey(loadedKey);
    setTestResult(null);
  }

  async function handleCopyKey() {
    if (draftKey) {
      await navigator.clipboard.writeText(draftKey);
    }
  }

  async function handleTestConnection() {
    if (testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const api = getAPI();
      if (!api) throw new Error('API not available');
      const result = await api.keychain.test(
        provider.id,
        {
          baseUrl: draftBaseUrl,
          id: provider.id,
          model: draftModel,
          supportsModelOverride: provider.supportsModelOverride,
          supportsReasoningEffort: provider.isCustom ? true : provider.supportsReasoningEffort,
          reasoningEffortsByModel: provider.reasoningEffortsByModel,
          reasoningEffort: draftReasoningEffort.trim() || undefined,
          name: provider.isCustom ? draftName : provider.name,
          protocol: draftProtocol,
        },
        group,
      );
      setTestResult(result.ok ? 'ok' : 'fail');
      if (!result.ok) {
        dispatch(
          addLog({
            level: 'warn',
            category: 'provider',
            message: t('settings.providerCard.log.connectionFailed'),
            detail: `${group}:${provider.id}`,
          }),
        );
      }
    } catch (error) {
      dispatch(
        addLog({
          level: 'error',
          category: 'provider',
          message: t('settings.providerCard.log.connectionFailed'),
          detail:
            error instanceof Error
              ? `${group}:${provider.id}\n${error.stack ?? error.message}`
              : `${group}:${provider.id}\n${String(error)}`,
        }),
      );
      setTestResult('fail');
    } finally {
      setTesting(false);
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
            {provider.isCustom && expanded ? (
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="border-b border-transparent bg-transparent text-xs font-medium hover:border-border focus:border-primary focus:outline-none"
              />
            ) : (
              <span className="text-xs font-medium">{displayName}</span>
            )}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {expanded ? draftBaseUrl : provider.baseUrl}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isDirty && expanded ? (
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-medium text-amber-400">
              {t('settings.providerCard.unsaved')}
            </span>
          ) : isCustomized ? (
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              {t('settings.providerCard.customized')}
            </span>
          ) : null}
          {provider.hasKey ? (
            <span className="flex items-center gap-1 text-xs text-green-400">
              <Check className="h-3 w-3" /> {t('settings.providerCard.keySet')}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">
              {t('settings.providerCard.noKey')}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              const willExpand = !expanded;
              setExpanded(willExpand);
              // Eagerly load key when expanding — don't wait for hasKey since
              // the isConfigured check may not have resolved yet
              if (willExpand && !keyLoaded) {
                const api = getAPI();
                if (api) {
                  void api.keychain
                    .getMasked(provider.id)
                    .then((storedKey) => {
                      if (!mountedRef.current) return;
                      const value = storedKey ?? '';
                      setDraftKey(value);
                      setLoadedKey(value);
                      setKeyLoaded(true);
                      if (storedKey && !provider.hasKey) {
                        dispatch(setProviderHasKey({ group, provider: provider.id, hasKey: true }));
                      }
                    })
                    .catch(() => {
                      /* keychain read failure — user can retry */
                    });
                }
              }
            }}
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
                value={draftBaseUrl}
                onChange={(e) => setDraftBaseUrl(e.target.value)}
                className="w-full rounded border border-border bg-secondary px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            {showModel && (
              <div>
                <label className="mb-1 block text-[10px] text-muted-foreground">
                  {t('settings.providerCard.model')}
                </label>
                <input
                  type="text"
                  value={draftModel}
                  onChange={(e) => setDraftModel(e.target.value)}
                  className="w-full rounded border border-border bg-secondary px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
                {showHubGuidance && (
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                    <span>
                      {metadata?.modelExample
                        ? `${translateOrFallback('settings.modelExample', 'Example:')} ${metadata.modelExample}`
                        : translateOrFallback(
                            'settings.modelExampleEmpty',
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
                        {translateOrFallback('settings.viewModels', 'View Models')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {showReasoningEffort && (
              <div>
                <label className="mb-1 block text-[10px] text-muted-foreground">
                  {t('settings.providerCard.reasoningStrength')}
                </label>
                <input
                  type="text"
                  value={draftReasoningEffort}
                  onChange={(event) => setDraftReasoningEffort(event.target.value)}
                  className="w-full rounded border border-border bg-secondary px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            )}
          </div>

          {(group === 'llm' || group === 'vision') && provider.isCustom && (
            <div>
              <label className="mb-1 block text-[10px] text-muted-foreground">
                {t('settings.providerCard.protocol')}
              </label>
              <select
                value={draftProtocol ?? 'openai-compatible'}
                onChange={(e) => {
                  const nextProtocol = e.target.value as LLMProviderProtocol;
                  setDraftProtocol(nextProtocol);
                }}
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
              {provider.hasKey && keyLoaded && !keyDirty && (
                <div className="flex items-center gap-1 text-xs text-green-400">
                  <Check className="h-3 w-3" /> {t('settings.providerCard.configuredInKeychain')}
                </div>
              )}
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center overflow-hidden rounded border border-border bg-secondary">
                  <input
                    type={keyVisible ? 'text' : 'password'}
                    placeholder={t('settings.providerCard.keyPlaceholder')}
                    value={draftKey}
                    onChange={(e) => setDraftKey(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleSave();
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
                    disabled={!draftKey && !provider.hasKey}
                    aria-label={t('settings.providerCard.copyKey')}
                    className="rounded border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Unified Save button */}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving || !isDirty}
              className={cn(
                'rounded px-2 py-1 text-xs transition-colors disabled:opacity-50',
                saved && !isDirty
                  ? 'bg-emerald-500 text-white'
                  : 'bg-primary text-primary-foreground',
              )}
            >
              {saving
                ? t('settings.providerCard.saving')
                : saved && !isDirty
                  ? t('settings.providerCard.saved')
                  : t('settings.providerCard.save')}
            </button>
            {isDirty && (
              <button
                type="button"
                onClick={handleDiscard}
                className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-xs hover:bg-muted"
              >
                <RotateCcw className="h-3 w-3" />
                {t('settings.providerCard.discard')}
              </button>
            )}
            {isBuiltinProvider && isCustomized ? (
              <button
                type="button"
                onClick={() => dispatch(resetProviderToDefaults({ group, provider: provider.id }))}
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
    () =>
      groupState.providers
        .filter((provider) => getProviderMetadata(group, provider.id)?.credentialMode !== 'oauth')
        .map((provider) => provider.id)
        .join('|'),
    [group, groupState.providers],
  );

  useEffect(() => {
    let mounted = true;
    const api = getAPI();
    if (!api) return;
    const providerIds = providerIdsKey ? providerIdsKey.split('|') : [];

    // Wait for IPC handlers to be registered before calling keychain. Managed
    // providers authenticate through their own renderer-safe IPC namespace.
    const unsub = api.onReady(() => {
      for (const id of providerIds) {
        void api.keychain
          .isConfigured(id)
          .then((configured) => {
            if (mounted) dispatch(setProviderHasKey({ group, provider: id, hasKey: configured }));
          })
          .catch((error: unknown) => {
            if (!mounted) return;
            dispatch(
              addLog({
                level: 'error',
                category: 'provider',
                message: `Failed to check keychain for provider ${id}`,
                detail: error instanceof Error ? (error.stack ?? error.message) : String(error),
              }),
            );
          });
      }
    });

    return () => {
      mounted = false;
      unsub();
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
        {group === 'vision' && (
          <div className="flex gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5">
            <ScanEye className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="space-y-0.5">
              <div className="text-xs font-medium">{t('settings.visionRouting.title')}</div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {t('settings.visionRouting.body')}
              </p>
            </div>
          </div>
        )}
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
