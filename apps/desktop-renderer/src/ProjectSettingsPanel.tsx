import React, { useEffect, useRef, useState } from 'react';
import { Archive, X } from 'lucide-react';
import type { Project, ProjectSettings, DesktopCallV1 } from '@lucid-fin/contracts';
import type { WireResult } from './api.js';
import { appCopy } from './copy.js';
import { useDesktopEnvironment } from './environment.js';

function errorSummary(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The Project settings could not be saved.';
}

function canonicalCostInput(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) return null;
  const [integer = '0', fraction = ''] = trimmed.split('.');
  const normalizedInteger = integer.replace(/^0+(?=\d)/, '');
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction.length === 0
    ? normalizedInteger
    : `${normalizedInteger}.${normalizedFraction}`;
}

interface ProjectSettingsPanelProps {
  readonly open: boolean;
  readonly project: Project;
  readonly settings: ProjectSettings;
  readonly capabilities: WireResult<'project.capabilities.get'> | null;
  readonly capabilitiesError: string | null;
  readonly pluginPackages: WireResult<'plugin.query'> | null;
  readonly pluginPackagesError: string | null;
  readonly pluginPending: string | null;
  readonly archivePending: boolean;
  readonly onClose: () => void;
  readonly onRetryCapabilities: () => Promise<void>;
  readonly onRetryPluginPackages: () => Promise<void>;
  readonly onPluginApply: (input: DesktopCallV1<'plugin.apply'>['input']) => Promise<void>;
  readonly onRename: (name: string) => Promise<void>;
  readonly onSettingsChange: (settings: ProjectSettings) => Promise<void>;
  readonly onArchiveProject: () => Promise<void>;
}

export function ProjectSettingsPanel({
  open,
  project,
  settings,
  capabilities,
  capabilitiesError,
  pluginPackages,
  pluginPackagesError,
  pluginPending,
  archivePending,
  onClose,
  onRetryCapabilities,
  onRetryPluginPackages,
  onPluginApply,
  onRename,
  onSettingsChange,
  onArchiveProject,
}: ProjectSettingsPanelProps) {
  const { locale } = useDesktopEnvironment();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [name, setName] = useState(project.name);
  const [permission, setPermission] = useState(settings.permission);
  const [generationLimit, setGenerationLimit] = useState(settings.budget.maxGenerationCount);
  const [inputTokenLimit, setInputTokenLimit] = useState(settings.budget.maxInputTokens);
  const [outputTokenLimit, setOutputTokenLimit] = useState(settings.budget.maxOutputTokens);
  const [costLimit, setCostLimit] = useState(
    settings.budget.costUsd.state === 'unknown' ? '' : settings.budget.costUsd.value,
  );
  const [defaultProviderProfileId, setDefaultProviderProfileId] = useState(
    settings.defaultProviderProfileId ?? '',
  );
  const [enabledSkills, setEnabledSkills] = useState(settings.enabledSkills);
  const [skillQuery, setSkillQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setName(project.name), [project.name]);
  useEffect(() => {
    setPermission(settings.permission);
    setGenerationLimit(settings.budget.maxGenerationCount);
    setInputTokenLimit(settings.budget.maxInputTokens);
    setOutputTokenLimit(settings.budget.maxOutputTokens);
    setCostLimit(settings.budget.costUsd.state === 'unknown' ? '' : settings.budget.costUsd.value);
    setDefaultProviderProfileId(settings.defaultProviderProfileId ?? '');
    setEnabledSkills(settings.enabledSkills);
  }, [settings]);
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  const query = skillQuery.trim().toLocaleLowerCase(locale);
  const visibleSkills =
    capabilities?.skills.filter(
      (skill) =>
        query.length === 0 ||
        skill.name.toLocaleLowerCase(locale).includes(query) ||
        skill.id.toLocaleLowerCase(locale).includes(query) ||
        skill.description.toLocaleLowerCase(locale).includes(query),
    ) ?? [];
  const canonicalCost = costLimit.trim().length === 0 ? null : canonicalCostInput(costLimit);
  const invalidCost = costLimit.trim().length > 0 && canonicalCost === null;

  const toggleSkill = (
    skill: NonNullable<typeof capabilities>['skills'][number],
    enabled: boolean,
  ) => {
    setEnabledSkills((current) =>
      (enabled
        ? [...current.filter(({ id }) => id !== skill.id), { id: skill.id, version: skill.version }]
        : current.filter(({ id }) => id !== skill.id)
      ).sort((left, right) => left.id.localeCompare(right.id)),
    );
  };

  const applyPlugin = async (
    entry: WireResult<'plugin.query'>['packages'][number],
    action: 'install' | 'remove',
  ) => {
    setError(null);
    try {
      const identity = {
        packageId: entry.manifest.packageId,
        version: entry.manifest.version,
        manifestHash: entry.manifest.manifestHash,
      };
      if (action === 'remove') {
        if (entry.installation === null) {
          throw new Error(
            locale === 'zh-CN'
              ? '插件包安装状态已经变化；请刷新后重试。'
              : 'The Plugin installation changed. Refresh and try again.',
          );
        }
        await onPluginApply({
          action,
          ...identity,
          expectedInstallationRevision: entry.installation.revision,
        });
      } else {
        await onPluginApply({
          action,
          ...identity,
          expectedInstallationRevision: entry.installation?.revision ?? null,
        });
      }
    } catch (cause) {
      setError(errorSummary(cause));
    }
  };

  const save = async () => {
    if (invalidCost) {
      setError(
        locale === 'zh-CN'
          ? '费用上限必须是非负十进制数。'
          : 'The cost ceiling must be a non-negative decimal.',
      );
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (name.trim() !== project.name) await onRename(name.trim());
      const costUsd =
        canonicalCost === null
          ? { state: 'unknown' as const, currency: settings.budget.costUsd.currency }
          : settings.budget.costUsd.state !== 'unknown' &&
              settings.budget.costUsd.value === canonicalCost
            ? settings.budget.costUsd
            : {
                state: 'known' as const,
                value: canonicalCost,
                currency: settings.budget.costUsd.currency,
              };
      await onSettingsChange({
        ...settings,
        defaultProviderProfileId:
          defaultProviderProfileId.length === 0 ? null : defaultProviderProfileId,
        permission,
        budget: {
          costUsd,
          maxGenerationCount: generationLimit,
          maxInputTokens: inputTokenLimit,
          maxOutputTokens: outputTokenLimit,
        },
        enabledSkills,
      });
    } catch (cause) {
      setError(errorSummary(cause));
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    setError(null);
    try {
      await onArchiveProject();
    } catch (cause) {
      setError(errorSummary(cause));
    }
  };

  return (
    <div className="lucid-settings-backdrop">
      <section
        ref={dialogRef}
        className="lucid-project-settings-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lucid-project-settings-title"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key !== 'Tab') return;
          const focusable = Array.from(
            dialogRef.current?.querySelectorAll<HTMLElement>(
              'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
            ) ?? [],
          );
          const first = focusable.at(0);
          const last = focusable.at(-1);
          if (first === undefined || last === undefined) {
            event.preventDefault();
            return;
          }
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header>
          <div>
            <span>{locale === 'zh-CN' ? '受信任项目边界' : 'Trusted Project boundary'}</span>
            <h2 id="lucid-project-settings-title">
              {locale === 'zh-CN' ? '项目设置' : 'Project settings'}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label={locale === 'zh-CN' ? '关闭项目设置' : 'Close Project settings'}
          >
            <X size={16} />
          </button>
        </header>

        <div className="lucid-project-settings-body">
          <div className="lucid-settings-basics">
            <label>
              <span>{locale === 'zh-CN' ? '项目名称' : 'Project name'}</span>
              <input value={name} onChange={(event) => setName(event.currentTarget.value)} />
            </label>
            <label>
              <span>{appCopy(locale, 'permission')}</span>
              <select
                value={permission}
                onChange={(event) =>
                  setPermission(event.currentTarget.value as ProjectSettings['permission'])
                }
              >
                <option value="read_only">{locale === 'zh-CN' ? '只读' : 'Read only'}</option>
                <option value="reversible">{locale === 'zh-CN' ? '可逆变更' : 'Reversible'}</option>
                <option value="full">{locale === 'zh-CN' ? '完整权限' : 'Full'}</option>
              </select>
            </label>
            <div className="lucid-settings-format-fact">
              <span>{locale === 'zh-CN' ? '格式' : 'Format'}</span>
              <strong>
                {settings.formatPolicy.aspectRatio} · {settings.formatPolicy.frameRate} fps
              </strong>
            </div>
          </div>

          <section className="lucid-settings-section lucid-settings-budget">
            <header>
              <strong>{locale === 'zh-CN' ? '资源预算' : 'Resource budget'}</strong>
              <span>
                {locale === 'zh-CN'
                  ? '这些上限适用于下一次根 Run；留空费用表示不设美元上限。'
                  : 'These ceilings apply to the next root Run; leave cost blank for no USD ceiling.'}
              </span>
            </header>
            <div className="lucid-settings-budget-grid">
              <label>
                <span>{locale === 'zh-CN' ? '费用上限（USD）' : 'Cost ceiling (USD)'}</span>
                <input
                  inputMode="decimal"
                  value={costLimit}
                  aria-invalid={invalidCost || undefined}
                  placeholder={locale === 'zh-CN' ? '无上限' : 'No ceiling'}
                  onChange={(event) => setCostLimit(event.currentTarget.value)}
                />
                {invalidCost && (
                  <small role="alert">
                    {locale === 'zh-CN' ? '请输入非负十进制数。' : 'Enter a non-negative decimal.'}
                  </small>
                )}
              </label>
              <label>
                <span>{locale === 'zh-CN' ? '最多生成次数' : 'Generation limit'}</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={generationLimit}
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber;
                    if (Number.isFinite(value)) setGenerationLimit(Math.max(0, Math.trunc(value)));
                  }}
                />
              </label>
              <label>
                <span>{locale === 'zh-CN' ? '输入 Token 上限' : 'Input token limit'}</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={inputTokenLimit}
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber;
                    if (Number.isFinite(value)) setInputTokenLimit(Math.max(0, Math.trunc(value)));
                  }}
                />
              </label>
              <label>
                <span>{locale === 'zh-CN' ? '输出 Token 上限' : 'Output token limit'}</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={outputTokenLimit}
                  onChange={(event) => {
                    const value = event.currentTarget.valueAsNumber;
                    if (Number.isFinite(value)) setOutputTokenLimit(Math.max(0, Math.trunc(value)));
                  }}
                />
              </label>
            </div>
          </section>

          {capabilitiesError !== null ? (
            <div className="lucid-settings-catalog-error" role="alert">
              <span>{capabilitiesError}</span>
              <button type="button" onClick={() => void onRetryCapabilities()}>
                {appCopy(locale, 'retry')}
              </button>
            </div>
          ) : capabilities === null ? (
            <div className="lucid-settings-catalog-loading" role="status">
              <span className="lucid-spinner" />
              {appCopy(locale, 'loading')}
            </div>
          ) : (
            <>
              <section className="lucid-settings-section">
                <header>
                  <strong>{locale === 'zh-CN' ? '默认 Provider' : 'Default Provider'}</strong>
                  <span>
                    {locale === 'zh-CN'
                      ? '只可选择已配置且就绪的 Provider。'
                      : 'Only configured, ready Providers can be selected.'}
                  </span>
                </header>
                <label>
                  <span>{appCopy(locale, 'model')}</span>
                  <select
                    value={defaultProviderProfileId}
                    onChange={(event) => setDefaultProviderProfileId(event.currentTarget.value)}
                  >
                    <option value="">{locale === 'zh-CN' ? '项目默认' : 'Project default'}</option>
                    {capabilities.providers.map((provider) => (
                      <option
                        key={provider.id}
                        value={provider.id}
                        disabled={provider.status !== 'ready'}
                      >
                        {provider.displayName} · {provider.model}
                        {provider.status === 'ready' ? '' : ` · ${provider.status}`}
                      </option>
                    ))}
                  </select>
                </label>
              </section>

              <section className="lucid-settings-section lucid-settings-skills">
                <header>
                  <strong>
                    Skills · {enabledSkills.length}/{capabilities.skills.length}
                  </strong>
                  <span>{appCopy(locale, 'skillHint')}</span>
                </header>
                <label>
                  <span>{locale === 'zh-CN' ? '搜索 Skills' : 'Search Skills'}</span>
                  <input
                    type="search"
                    value={skillQuery}
                    onChange={(event) => setSkillQuery(event.currentTarget.value)}
                    placeholder={
                      locale === 'zh-CN' ? '名称、ID 或说明' : 'Name, ID, or description'
                    }
                  />
                </label>
                <div className="lucid-settings-skill-list">
                  {visibleSkills.map((skill) => {
                    const enabled = enabledSkills.some(
                      ({ id, version }) => id === skill.id && version === skill.version,
                    );
                    const unavailable = skill.eligibility !== 'available';
                    return (
                      <label key={`${skill.id}:${skill.version}`}>
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={unavailable && !enabled}
                          onChange={(event) => toggleSkill(skill, event.currentTarget.checked)}
                        />
                        <span>
                          <strong>{skill.name}</strong>
                          <small>
                            {skill.id} · {skill.version} · {skill.provenance} · {skill.trust}
                            {skill.pluginPackage === null
                              ? ''
                              : ` · ${skill.pluginPackage.packageId}@${skill.pluginPackage.version}`}
                          </small>
                          <em>{skill.description}</em>
                          {unavailable && <b>{skill.quarantineReason ?? skill.eligibility}</b>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>

              <section className="lucid-settings-section lucid-settings-plugin-boundary">
                <header>
                  <strong>{locale === 'zh-CN' ? '插件包' : 'Plugin packages'}</strong>
                  <span>
                    {locale === 'zh-CN'
                      ? '只接受此 Build 注册的纯声明 Skill 包；插件不能增加工具、Provider、网络或代码权限，安装也不会自动启用 Skill。'
                      : 'Only declarative Skill bundles registered by this build are trusted. Plugins cannot add tools, Providers, network, or code authority, and installation never enables a Skill.'}
                  </span>
                </header>
                {pluginPackagesError !== null ? (
                  <div className="lucid-settings-catalog-error" role="alert">
                    <span>{pluginPackagesError}</span>
                    <button type="button" onClick={() => void onRetryPluginPackages()}>
                      {appCopy(locale, 'retry')}
                    </button>
                  </div>
                ) : pluginPackages === null ? (
                  <div className="lucid-settings-catalog-loading" role="status">
                    <span className="lucid-spinner" />
                    {appCopy(locale, 'loading')}
                  </div>
                ) : pluginPackages.packages.length === 0 ? (
                  <p className="lucid-settings-plugin-empty">
                    {locale === 'zh-CN'
                      ? '此 Build 没有注册受信任插件包。'
                      : 'This build has no registered trusted Plugin packages.'}
                  </p>
                ) : (
                  <div className="lucid-settings-plugin-list">
                    {pluginPackages.packages.map((entry) => {
                      const installed = entry.installation?.state === 'installed';
                      const pending = pluginPending === entry.manifest.packageId;
                      const latestAudit = entry.auditEvents.at(-1);
                      return (
                        <article key={`${entry.manifest.packageId}:${entry.manifest.version}`}>
                          <header>
                            <div>
                              <strong>{entry.manifest.name}</strong>
                              <span>
                                {entry.manifest.packageId} · {entry.manifest.version}
                              </span>
                            </div>
                            <em data-state={installed ? 'installed' : 'available'}>
                              {installed
                                ? locale === 'zh-CN'
                                  ? '已安装'
                                  : 'Installed'
                                : locale === 'zh-CN'
                                  ? '可安装'
                                  : 'Available'}
                            </em>
                          </header>
                          <p>{entry.manifest.description}</p>
                          <code title={entry.manifest.manifestHash}>
                            SHA-256 · {entry.manifest.manifestHash}
                          </code>
                          <ul>
                            {entry.manifest.skills.map((skill) => (
                              <li key={`${skill.skillId}:${skill.version}`}>
                                {skill.name} · {skill.version}
                              </li>
                            ))}
                          </ul>
                          {latestAudit !== undefined && (
                            <small>
                              {latestAudit.action === 'installed'
                                ? locale === 'zh-CN'
                                  ? '最近安装'
                                  : 'Last installed'
                                : locale === 'zh-CN'
                                  ? '最近移除'
                                  : 'Last removed'}{' '}
                              ·{' '}
                              {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                                new Date(latestAudit.occurredAt),
                              )}
                            </small>
                          )}
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() =>
                              void applyPlugin(entry, installed ? 'remove' : 'install')
                            }
                          >
                            {pending
                              ? appCopy(locale, 'loading')
                              : installed
                                ? locale === 'zh-CN'
                                  ? `移除 ${entry.manifest.name}`
                                  : `Remove ${entry.manifest.name}`
                                : locale === 'zh-CN'
                                  ? `安装 ${entry.manifest.name}`
                                  : `Install ${entry.manifest.name}`}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          )}

          {error !== null && (
            <p role="alert" className="lucid-inline-error">
              {error}
            </p>
          )}
          <button
            className="lucid-primary-button"
            type="button"
            onClick={() => void save()}
            disabled={saving || capabilities === null || name.trim().length === 0 || invalidCost}
          >
            {saving
              ? appCopy(locale, 'loading')
              : locale === 'zh-CN'
                ? '保存项目设置'
                : 'Save Project settings'}
          </button>
          <section className="lucid-settings-danger" aria-labelledby="lucid-archive-project-title">
            <div>
              <strong id="lucid-archive-project-title">
                {locale === 'zh-CN' ? '归档项目' : 'Archive Project'}
              </strong>
              <span>
                {locale === 'zh-CN'
                  ? '将此项目从活跃项目列表中移除。'
                  : 'Remove this Project from the active Projects list.'}
              </span>
            </div>
            <button
              className="lucid-secondary-button lucid-archive-project"
              type="button"
              disabled={archivePending || saving}
              onClick={() => void archive()}
            >
              <Archive size={14} />
              {archivePending
                ? locale === 'zh-CN'
                  ? '正在归档…'
                  : 'Archiving…'
                : locale === 'zh-CN'
                  ? '归档项目'
                  : 'Archive Project'}
            </button>
          </section>
        </div>
      </section>
    </div>
  );
}
