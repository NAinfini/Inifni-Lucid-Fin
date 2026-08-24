import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Clock3,
  Film,
  FolderOpen,
  MoreHorizontal,
  Paperclip,
  Plus,
  Settings,
  Sparkles,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { TargetResult } from './api.js';
import { TargetApiError, targetResult } from './api.js';
import { targetCopy } from './copy.js';
import { useTargetEnvironment } from './environment.js';

type ProjectSummary = TargetResult<'project.list'>['items'][number];
type PendingGrant = TargetResult<'os.media.pick'>;

const DEFAULT_BUDGET = Object.freeze({
  costUsd: { state: 'unknown' as const, currency: 'USD' },
  maxGenerationCount: 40,
  maxInputTokens: 200_000,
  maxOutputTokens: 40_000,
});

function projectNameFromBrief(brief: string): string {
  const words = brief
    .trim()
    .replace(/[.!?。！？]+$/u, '')
    .split(/\s+/u)
    .filter(Boolean);
  return words.slice(0, 4).join(' ') || 'Untitled Project';
}

function errorSummary(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The Project could not be loaded.';
}

function GlobalRail() {
  const { locale } = useTargetEnvironment();
  const unavailable = targetCopy(locale, 'unsupported');
  return (
    <nav className="target-global-rail" aria-label={targetCopy(locale, 'projects')}>
      <button
        className="target-rail-button is-active"
        type="button"
        aria-label={targetCopy(locale, 'projects')}
      >
        <FolderOpen size={19} />
      </button>
      <button
        className="target-rail-button"
        type="button"
        aria-label={targetCopy(locale, 'globalMedia')}
        aria-disabled="true"
        title={unavailable}
      >
        <Film size={19} />
      </button>
      <span className="target-rail-spacer" />
      <button
        className="target-rail-button"
        type="button"
        aria-label={targetCopy(locale, 'settings')}
        aria-disabled="true"
        title={unavailable}
      >
        <Settings size={19} />
      </button>
    </nav>
  );
}

export function ProjectHome() {
  const { api, createRequestId, locale } = useTargetEnvironment();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const [projectName, setProjectName] = useState('');
  const [grants, setGrants] = useState<readonly PendingGrant[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await targetResult(
        api.project.list({
          requestId: createRequestId(),
          input: { cursor: null, limit: 200 },
        }),
      );
      setProjects(page.items.filter((project) => project.lifecycle === 'active'));
      setComposerOpen(page.items.length === 0);
    } catch (cause) {
      setError(errorSummary(cause));
    } finally {
      setLoading(false);
    }
  }, [api, createRequestId]);

  useEffect(() => {
    void load();
  }, [load]);

  const attach = async () => {
    setError(null);
    try {
      const grant = await targetResult(
        api.os.mediaPick({
          requestId: createRequestId(),
          input: { kinds: ['image', 'video', 'audio', 'document'], multiple: false },
        }),
      );
      setGrants((current) => [...current, grant]);
    } catch (cause) {
      setError(errorSummary(cause));
    }
  };

  const canSubmit = brief.trim().length > 0 || grants.length > 0;
  const visibleName = useMemo(
    () => projectName.trim() || projectNameFromBrief(brief),
    [brief, projectName],
  );

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await targetResult(
        api.project.create({
          requestId: createRequestId(),
          input: {
            name: visibleName,
            permissionMode: 'reversible',
            budget: DEFAULT_BUDGET,
            formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
          },
        }),
      );
      const chat = await targetResult(
        api.chat.create({
          requestId: createRequestId(),
          input: { projectId: created.project.id, title: visibleName },
        }),
      );

      const attachments: Array<{
        projectMediaRefId: string;
        globalAssetId: string;
        blobHash: string;
        role: 'attachment';
      }> = [];
      for (const grant of grants) {
        const imported = await targetResult(
          api.media.globalImport({
            requestId: createRequestId(),
            input: {
              capabilityToken: grant.capabilityToken,
              displayName: null,
              tags: ['reference'],
            },
          }),
        );
        const currentProject = await targetResult(
          api.project.get({
            requestId: createRequestId(),
            input: { projectId: created.project.id },
          }),
        );
        const attached = await targetResult(
          api.media.projectAttach({
            requestId: createRequestId(),
            input: {
              projectId: created.project.id,
              expectedProjectRevision: currentProject.revision,
              globalAssetId: imported.asset.id,
              expectedExistingRef: null,
              label: grant.displayLabel,
              collections: [],
              roles: ['reference'],
              notes: '',
            },
          }),
        );
        attachments.push({
          projectMediaRefId: attached.object.id,
          globalAssetId: imported.asset.id,
          blobHash: imported.asset.blobHash,
          role: 'attachment',
        });
      }

      const firstMessage = await targetResult(
        api.message.send({
          requestId: createRequestId(),
          input: {
            chatId: chat.id,
            blocks: [
              {
                type: 'text',
                text: brief.trim() || `Use the attached references to begin ${visibleName}.`,
              },
            ],
            attachments,
            selectedContext: [],
            supersedesMessageId: null,
          },
        }),
      );
      navigate(
        `/projects/${created.project.id}/overview?chat=${chat.id}&run=${firstMessage.acceptedRun.id}`,
      );
    } catch (cause) {
      const summary = errorSummary(cause);
      setError(
        cause instanceof TargetApiError && cause.confirmation !== null
          ? `${summary} Confirmation ${cause.confirmation.id} is required.`
          : summary,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const openProject = (project: ProjectSummary) => {
    let workspace = 'overview';
    try {
      workspace =
        localStorage.getItem(`lucid-fin:target:last-workspace:${project.id}`) ?? workspace;
    } catch {
      // Route restoration is best effort when browser storage is unavailable.
    }
    navigate(`/projects/${project.id}/${workspace}`);
  };

  return (
    <div className="target-home-shell">
      <GlobalRail />
      <section className="target-home-content" aria-labelledby="projects-heading">
        <header className="target-home-header">
          <div>
            <h1 id="projects-heading">{targetCopy(locale, 'projects')}</h1>
            <p>
              {locale === 'zh-CN'
                ? '继续最近的制作，或从一个想法开始。'
                : 'Continue a production or begin with one idea.'}
            </p>
          </div>
          <button
            className="target-primary-button"
            type="button"
            onClick={() => setComposerOpen(true)}
          >
            <Plus size={15} />
            {targetCopy(locale, 'newProject')}
          </button>
        </header>

        {error !== null && (
          <div className="target-state target-state-error" role="alert">
            <strong>
              {locale === 'zh-CN' ? '无法完成请求' : 'Could not complete the request'}
            </strong>
            <span>{error}</span>
            <button type="button" onClick={() => void load()}>
              {targetCopy(locale, 'retry')}
            </button>
          </div>
        )}

        {composerOpen && (
          <form
            className="target-new-project"
            onSubmit={createProject}
            aria-label={targetCopy(locale, 'newProject')}
          >
            <div className="target-new-project-copy">
              <Sparkles size={18} />
              <div>
                <h2>{targetCopy(locale, 'newProject')}</h2>
                <p>{targetCopy(locale, 'noProjects')}</p>
              </div>
            </div>
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.currentTarget.value)}
              placeholder={targetCopy(locale, 'describeFilm')}
              rows={4}
              autoFocus
            />
            <div className="target-new-project-options">
              <label>
                <span>{locale === 'zh-CN' ? '项目名称（可选）' : 'Project name (optional)'}</span>
                <input
                  type="text"
                  value={projectName}
                  onChange={(event) => setProjectName(event.currentTarget.value)}
                  placeholder={visibleName}
                />
              </label>
              <div
                className="target-defaults"
                aria-label={locale === 'zh-CN' ? '发送前默认值' : 'Defaults before send'}
              >
                <span>16:9 · 24 fps</span>
                <span>{locale === 'zh-CN' ? '可逆权限' : 'Reversible permission'}</span>
                <span>{locale === 'zh-CN' ? '预算未设置' : 'Budget unavailable'}</span>
              </div>
            </div>
            {grants.length > 0 && (
              <ul
                className="target-attachment-list"
                aria-label={targetCopy(locale, 'attachReference')}
              >
                {grants.map((grant) => (
                  <li key={grant.capabilityToken}>{grant.displayLabel}</li>
                ))}
              </ul>
            )}
            <div className="target-new-project-actions">
              <button
                className="target-secondary-button"
                type="button"
                onClick={() => void attach()}
              >
                <Paperclip size={14} />
                {targetCopy(locale, 'attachReference')}
              </button>
              <button
                className="target-primary-button"
                type="submit"
                disabled={!canSubmit || submitting}
              >
                {submitting ? targetCopy(locale, 'loading') : targetCopy(locale, 'createAndStart')}
              </button>
            </div>
          </form>
        )}

        <section
          className="target-project-list"
          aria-label={locale === 'zh-CN' ? '现有项目' : 'Existing Projects'}
        >
          <div className="target-list-heading">
            <span>{locale === 'zh-CN' ? '现有项目' : 'Existing Projects'}</span>
            <span>{locale === 'zh-CN' ? '最近活动' : 'Last activity'}</span>
          </div>
          {loading ? (
            <div className="target-state" role="status">
              {targetCopy(locale, 'loading')}
            </div>
          ) : projects.length === 0 ? (
            <div className="target-project-empty">
              <Film size={20} />
              <p>{targetCopy(locale, 'noProjects')}</p>
            </div>
          ) : (
            projects.map((project) => (
              <article className="target-project-row" key={project.id}>
                <button
                  className="target-project-open"
                  type="button"
                  aria-label={`${locale === 'zh-CN' ? '打开' : 'Open'} ${project.name}`}
                  onClick={() => openProject(project)}
                >
                  <span className="target-project-thumb" aria-hidden="true">
                    <Film size={18} />
                  </span>
                  <span className="target-project-summary">
                    <strong>{project.name}</strong>
                    <span>
                      {locale === 'zh-CN'
                        ? '返回上次项目工作区'
                        : 'Return to the last Project workspace'}
                    </span>
                  </span>
                  <span className="target-project-time">
                    <Clock3 size={13} />
                    {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                      new Date(project.updatedAt),
                    )}
                  </span>
                </button>
                <details className="target-row-menu">
                  <summary
                    aria-label={`${project.name} ${locale === 'zh-CN' ? '更多操作' : 'more actions'}`}
                  >
                    <MoreHorizontal size={16} />
                  </summary>
                  <div>
                    <button
                      type="button"
                      aria-disabled="true"
                      title={targetCopy(locale, 'unsupported')}
                    >
                      <Archive size={13} /> {locale === 'zh-CN' ? '归档' : 'Archive'}
                    </button>
                    <button
                      type="button"
                      aria-disabled="true"
                      title={targetCopy(locale, 'unsupported')}
                    >
                      {locale === 'zh-CN' ? '导出元数据' : 'Export metadata'}
                    </button>
                  </div>
                </details>
              </article>
            ))
          )}
        </section>
      </section>
    </div>
  );
}
