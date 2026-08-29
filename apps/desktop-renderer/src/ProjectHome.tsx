import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Clock3, Film, MoreHorizontal, Paperclip, Plus, Sparkles, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { WireResult } from './api.js';
import { DesktopApiError, wireResult } from './api.js';
import { appCopy } from './copy.js';
import { useDesktopEnvironment } from './environment.js';
import { GlobalRail } from './GlobalRail.js';
import { isWorkspace, type Workspace } from './shared-selection.js';

type ProjectSummary = WireResult<'project.list'>['items'][number];
type PendingGrant = WireResult<'os.media.pick'>;
type ProjectView = 'active' | 'archived';

const DEFAULT_BUDGET = Object.freeze({
  costUsd: { state: 'unknown' as const, currency: 'USD' },
  maxGenerationCount: 40,
  maxInputTokens: 200_000,
  maxOutputTokens: 40_000,
});
const PROJECT_DESCRIPTION_MAX_LENGTH = 240;

function errorSummary(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'The Project request could not be completed.';
}

function projectSummary(project: WireResult<'project.update'>): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    lifecycle: project.lifecycle,
    revision: project.revision,
    contentHash: project.contentHash,
    updatedAt: project.updatedAt,
  };
}

function viewLabel(
  locale: ReturnType<typeof useDesktopEnvironment>['locale'],
  view: ProjectView,
): string {
  if (locale === 'zh-CN') return view === 'active' ? '进行中的项目' : '已归档项目';
  return view === 'active' ? 'Active projects' : 'Archived projects';
}

export function ProjectHome() {
  const { api, createRequestId, locale } = useDesktopEnvironment();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<readonly ProjectSummary[]>([]);
  const [projectNextCursor, setProjectNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [projectPagePending, setProjectPagePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoverableProject, setRecoverableProject] = useState<ProjectSummary | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const [grants, setGrants] = useState<readonly PendingGrant[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [view, setView] = useState<ProjectView>('active');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [mutatingProjectId, setMutatingProjectId] = useState<string | null>(null);
  const projectListRequestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++projectListRequestRef.current;
    setLoading(true);
    setError(null);
    try {
      const page = await wireResult(
        api.project.list({
          requestId: createRequestId(),
          input: { cursor: null, limit: 200 },
        }),
      );
      if (request !== projectListRequestRef.current) return;
      setProjects(page.items);
      setProjectNextCursor(page.nextCursor);
      setComposerOpen(page.items.every((project) => project.lifecycle !== 'active'));
      setRecoverableProject(null);
    } catch (cause) {
      if (request === projectListRequestRef.current) setError(errorSummary(cause));
    } finally {
      if (request === projectListRequestRef.current) setLoading(false);
    }
  }, [api, createRequestId]);

  useEffect(() => {
    void load();
  }, [load]);

  const attach = async () => {
    setError(null);
    try {
      const grant = await wireResult(
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
  const projectName = brief.trim() || 'Untitled Project';
  const visibleProjects = useMemo(
    () => projects.filter((project) => project.lifecycle === view),
    [projects, view],
  );

  const loadMoreProjects = async () => {
    const cursor = projectNextCursor;
    if (cursor === null || projectPagePending) return;
    const request = projectListRequestRef.current;
    setProjectPagePending(true);
    try {
      const page = await wireResult(
        api.project.list({
          requestId: createRequestId(),
          input: { cursor, limit: 200 },
        }),
      );
      if (request !== projectListRequestRef.current) return;
      setProjects((current) => {
        const byId = new Map(current.map((project) => [project.id, project] as const));
        for (const project of page.items) byId.set(project.id, project);
        return [...byId.values()];
      });
      setProjectNextCursor((current) => (current === cursor ? page.nextCursor : current));
    } catch (cause) {
      if (request === projectListRequestRef.current) setError(errorSummary(cause));
    } finally {
      if (request === projectListRequestRef.current) setProjectPagePending(false);
    }
  };

  const openProject = (project: ProjectSummary) => {
    let workspace: Workspace = 'overview';
    try {
      const storedWorkspace = localStorage.getItem(`lucid-fin:last-workspace:${project.id}`);
      if (isWorkspace(storedWorkspace)) workspace = storedWorkspace;
    } catch {
      // Route restoration is best effort when browser storage is unavailable.
    }
    navigate(`/projects/${project.id}/${workspace}`);
  };

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    setRecoverableProject(null);
    let createdProject: ProjectSummary | null = null;
    try {
      const created = await wireResult(
        api.project.create({
          requestId: createRequestId(),
          input: {
            name: projectName,
            permissionMode: 'reversible',
            budget: DEFAULT_BUDGET,
            formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
          },
        }),
      );
      createdProject = projectSummary(created.project);
      projectListRequestRef.current += 1;
      setLoading(false);
      setProjectPagePending(false);
      const chat = await wireResult(
        api.chat.create({
          requestId: createRequestId(),
          input: { projectId: created.project.id, title: projectName },
        }),
      );

      const attachments: Array<{
        projectMediaRefId: string;
        globalAssetId: string;
        blobHash: string;
        role: 'attachment';
      }> = [];
      for (const grant of grants) {
        const imported = await wireResult(
          api.media.globalImport({
            requestId: createRequestId(),
            input: {
              capabilityToken: grant.capabilityToken,
              displayName: null,
              tags: ['reference'],
            },
          }),
        );
        const currentProject = await wireResult(
          api.project.get({
            requestId: createRequestId(),
            input: { projectId: created.project.id },
          }),
        );
        const attached = await wireResult(
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

      const firstMessage = await wireResult(
        api.message.send({
          requestId: createRequestId(),
          input: {
            chatId: chat.id,
            blocks: [
              {
                type: 'text',
                text: brief.trim() || `Use the attached references to begin ${projectName}.`,
              },
            ],
            attachments,
            selectedContext: [],
            exportDestinationGrant: null,
            supersedesMessageId: null,
          },
        }),
      );
      navigate(
        `/projects/${created.project.id}/overview?chat=${chat.id}&run=${firstMessage.acceptedRun.id}`,
      );
    } catch (cause) {
      if (createdProject !== null) {
        const recovered = createdProject;
        setProjects((current) => [
          recovered,
          ...current.filter((project) => project.id !== recovered.id),
        ]);
        setComposerOpen(false);
        setBrief('');
        setGrants([]);
        setRecoverableProject(recovered);
      }
      const summary = errorSummary(cause);
      setError(
        cause instanceof DesktopApiError && cause.confirmation !== null
          ? `${summary} Confirmation ${cause.confirmation.id} is required.`
          : summary,
      );
    } finally {
      setSubmitting(false);
    }
  };

  const updateProject = async (
    project: ProjectSummary,
    change: {
      readonly name: string | null;
      readonly lifecycle: ProjectSummary['lifecycle'] | null;
    },
  ) => {
    if (mutatingProjectId !== null) return;
    setMutatingProjectId(project.id);
    setError(null);
    try {
      const updated = await wireResult(
        api.project.update({
          requestId: createRequestId(),
          input: {
            projectId: project.id,
            expectedRevision: project.revision,
            name: change.name,
            lifecycle: change.lifecycle,
          },
        }),
      );
      setProjects((current) =>
        current.map((candidate) =>
          candidate.id === updated.id ? projectSummary(updated) : candidate,
        ),
      );
      setEditingProjectId(null);
      setPendingDeleteId(null);
    } catch (cause) {
      setError(errorSummary(cause));
    } finally {
      setMutatingProjectId(null);
    }
  };

  const renameProject = (event: React.FormEvent, project: ProjectSummary) => {
    event.preventDefault();
    const name = renameDraft.trim();
    if (name.length === 0) return;
    void updateProject(project, { name, lifecycle: null });
  };

  return (
    <div className="lucid-home-shell">
      <GlobalRail active="projects" />
      <section className="lucid-home-content" aria-labelledby="projects-heading">
        <header className="lucid-home-header">
          <div>
            <h1 id="projects-heading">{appCopy(locale, 'projects')}</h1>
            <p>
              {locale === 'zh-CN'
                ? '继续最近的制作，或从一个想法开始。'
                : 'Continue a production or begin with one idea.'}
            </p>
          </div>
          {!composerOpen && (
            <button
              className="lucid-primary-button"
              type="button"
              onClick={() => setComposerOpen(true)}
            >
              <Plus size={15} />
              {appCopy(locale, 'newProject')}
            </button>
          )}
        </header>

        {error !== null && (
          <div className="lucid-state lucid-state-error" role="alert">
            <strong>
              {locale === 'zh-CN' ? '无法完成请求' : 'Could not complete the request'}
            </strong>
            <span>{error}</span>
            {recoverableProject !== null && (
              <p>
                {locale === 'zh-CN'
                  ? `“${recoverableProject.name}”已创建。打开它以继续完成设置。`
                  : `“${recoverableProject.name}” was created. Open it to continue setup.`}
              </p>
            )}
            {recoverableProject !== null && (
              <button type="button" onClick={() => openProject(recoverableProject)}>
                {locale === 'zh-CN' ? '打开已创建的项目' : 'Open created Project'}
              </button>
            )}
            <button type="button" onClick={() => void load()}>
              {appCopy(locale, 'retry')}
            </button>
          </div>
        )}

        {composerOpen && (
          <form
            className="lucid-new-project"
            onSubmit={createProject}
            aria-label={appCopy(locale, 'newProject')}
          >
            <div className="lucid-new-project-copy">
              <Sparkles size={18} />
              <div>
                <h2>{appCopy(locale, 'newProject')}</h2>
                <p>{appCopy(locale, 'noProjects')}</p>
              </div>
              <button
                className="lucid-new-project-close"
                type="button"
                onClick={() => setComposerOpen(false)}
                aria-label={locale === 'zh-CN' ? '关闭新建项目' : 'Close new Project'}
              >
                <X size={15} />
              </button>
            </div>
            <textarea
              value={brief}
              onChange={(event) => setBrief(event.currentTarget.value)}
              placeholder={appCopy(locale, 'describeFilm')}
              aria-label={locale === 'zh-CN' ? '项目描述' : 'Project description'}
              maxLength={PROJECT_DESCRIPTION_MAX_LENGTH}
              rows={4}
              autoFocus
            />
            <div
              className="lucid-defaults lucid-new-project-defaults"
              aria-label={locale === 'zh-CN' ? '发送前默认值' : 'Defaults before send'}
            >
              <span>16:9 · 24 fps</span>
              <span>{locale === 'zh-CN' ? '可逆权限' : 'Reversible permission'}</span>
              <span>
                {locale === 'zh-CN'
                  ? `${DEFAULT_BUDGET.maxGenerationCount} 次生成 · ${DEFAULT_BUDGET.maxInputTokens / 1_000}k/${DEFAULT_BUDGET.maxOutputTokens / 1_000}k Token · 无美元上限`
                  : `${DEFAULT_BUDGET.maxGenerationCount} generations · ${DEFAULT_BUDGET.maxInputTokens / 1_000}k/${DEFAULT_BUDGET.maxOutputTokens / 1_000}k tokens · no USD ceiling`}
              </span>
            </div>
            {grants.length > 0 && (
              <ul className="lucid-attachment-list" aria-label={appCopy(locale, 'attachReference')}>
                {grants.map((grant) => (
                  <li key={grant.capabilityToken}>
                    <span>{grant.displayLabel}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setGrants((current) =>
                          current.filter(
                            (candidate) => candidate.capabilityToken !== grant.capabilityToken,
                          ),
                        )
                      }
                      aria-label={`${locale === 'zh-CN' ? '移除' : 'Remove'} ${grant.displayLabel}`}
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="lucid-new-project-actions">
              <button
                className="lucid-secondary-button"
                type="button"
                onClick={() => void attach()}
              >
                <Paperclip size={14} />
                {appCopy(locale, 'attachReference')}
              </button>
              <button
                className="lucid-primary-button"
                type="submit"
                disabled={!canSubmit || submitting}
              >
                {submitting ? appCopy(locale, 'loading') : appCopy(locale, 'createAndStart')}
              </button>
            </div>
          </form>
        )}

        <div
          className="lucid-project-view-tabs"
          role="tablist"
          aria-label={appCopy(locale, 'projects')}
        >
          {(['active', 'archived'] as const).map((candidate) => (
            <button
              className={candidate === view ? 'is-active' : undefined}
              type="button"
              role="tab"
              key={candidate}
              aria-selected={candidate === view}
              aria-controls="lucid-project-list"
              onClick={() => setView(candidate)}
            >
              {viewLabel(locale, candidate)}
            </button>
          ))}
        </div>

        <section
          className="lucid-project-list"
          id="lucid-project-list"
          role="tabpanel"
          aria-label={viewLabel(locale, view)}
        >
          <div className="lucid-list-heading">
            <span>{viewLabel(locale, view)}</span>
            <span>{locale === 'zh-CN' ? '最近活动' : 'Last activity'}</span>
          </div>
          {loading ? (
            <div className="lucid-state" role="status">
              {appCopy(locale, 'loading')}
            </div>
          ) : visibleProjects.length === 0 ? (
            <div className="lucid-project-empty">
              <Film size={20} />
              <p>
                {locale === 'zh-CN'
                  ? view === 'active'
                    ? '还没有进行中的项目。'
                    : '还没有已归档项目。'
                  : view === 'active'
                    ? 'No active Projects yet.'
                    : 'No archived Projects yet.'}
              </p>
            </div>
          ) : (
            visibleProjects.map((project) => (
              <article className="lucid-project-row" key={project.id}>
                <button
                  className="lucid-project-open"
                  type="button"
                  aria-label={`${locale === 'zh-CN' ? '打开' : 'Open'} ${project.name}`}
                  onClick={() => openProject(project)}
                >
                  <span className="lucid-project-thumb" aria-hidden="true">
                    <Film size={18} />
                  </span>
                  <span className="lucid-project-summary">
                    <strong>{project.name}</strong>
                    <span>
                      {locale === 'zh-CN'
                        ? '返回上次项目工作区'
                        : 'Return to the last Project workspace'}
                    </span>
                  </span>
                  <span className="lucid-project-time">
                    <Clock3 size={13} />
                    {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
                      new Date(project.updatedAt),
                    )}
                  </span>
                </button>
                <details
                  className="lucid-row-menu"
                  onBlur={(event) => {
                    const next = event.relatedTarget;
                    if (!(next instanceof Node) || !event.currentTarget.contains(next)) {
                      event.currentTarget.open = false;
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return;
                    event.preventDefault();
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector('summary')?.focus();
                  }}
                >
                  <summary
                    aria-label={`${project.name} ${locale === 'zh-CN' ? '更多操作' : 'more actions'}`}
                  >
                    <MoreHorizontal size={16} />
                  </summary>
                  <div>
                    {editingProjectId === project.id ? (
                      <form
                        className="lucid-project-rename"
                        onSubmit={(event) => renameProject(event, project)}
                      >
                        <label>
                          <span>{locale === 'zh-CN' ? '项目名称' : 'Project name'}</span>
                          <input
                            aria-label={`${locale === 'zh-CN' ? '重命名' : 'Rename'} ${project.name}`}
                            value={renameDraft}
                            onChange={(event) => setRenameDraft(event.currentTarget.value)}
                            autoFocus
                          />
                        </label>
                        <div>
                          <button
                            type="submit"
                            disabled={renameDraft.trim().length === 0 || mutatingProjectId !== null}
                          >
                            {locale === 'zh-CN' ? '保存名称' : 'Save name'}
                          </button>
                          <button type="button" onClick={() => setEditingProjectId(null)}>
                            {locale === 'zh-CN' ? '取消' : 'Cancel'}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={mutatingProjectId !== null}
                          onClick={() => {
                            setRenameDraft(project.name);
                            setEditingProjectId(project.id);
                          }}
                        >
                          {locale === 'zh-CN' ? '重命名' : 'Rename'}
                        </button>
                        <button
                          type="button"
                          disabled={mutatingProjectId !== null}
                          onClick={() =>
                            void updateProject(project, {
                              name: null,
                              lifecycle: project.lifecycle === 'active' ? 'archived' : 'active',
                            })
                          }
                        >
                          <Archive size={13} />
                          {project.lifecycle === 'active'
                            ? locale === 'zh-CN'
                              ? '归档'
                              : 'Archive'
                            : locale === 'zh-CN'
                              ? '恢复'
                              : 'Restore'}
                        </button>
                        <button
                          className="lucid-row-menu-danger"
                          type="button"
                          disabled={mutatingProjectId !== null}
                          onClick={(event) => {
                            event.currentTarget.closest('details')?.removeAttribute('open');
                            setPendingDeleteId(project.id);
                          }}
                        >
                          {locale === 'zh-CN' ? '删除项目' : 'Delete project'}
                        </button>
                      </>
                    )}
                  </div>
                </details>
                {pendingDeleteId === project.id && (
                  <section
                    className="lucid-project-delete-confirmation"
                    role="alertdialog"
                    aria-label={`${locale === 'zh-CN' ? '删除' : 'Delete'} ${project.name}`}
                  >
                    <p>
                      {locale === 'zh-CN'
                        ? `确认将“${project.name}”标记为已删除？这不会物理擦除已存储的数据。`
                        : `Mark “${project.name}” as deleted? This does not physically erase stored data.`}
                    </p>
                    <div>
                      <button
                        className="lucid-secondary-button"
                        type="button"
                        disabled={mutatingProjectId !== null}
                        onClick={() => setPendingDeleteId(null)}
                      >
                        {locale === 'zh-CN' ? '取消' : 'Cancel'}
                      </button>
                      <button
                        className="lucid-danger-button"
                        type="button"
                        disabled={mutatingProjectId !== null}
                        onClick={() =>
                          void updateProject(project, { name: null, lifecycle: 'deleted' })
                        }
                      >
                        {mutatingProjectId === project.id
                          ? appCopy(locale, 'loading')
                          : locale === 'zh-CN'
                            ? '确认软删除'
                            : 'Confirm soft delete'}
                      </button>
                    </div>
                  </section>
                )}
              </article>
            ))
          )}
          {projectNextCursor !== null && (
            <button
              className="lucid-conversation-pager"
              type="button"
              disabled={projectPagePending}
              onClick={() => void loadMoreProjects()}
            >
              {projectPagePending
                ? appCopy(locale, 'loading')
                : locale === 'zh-CN'
                  ? '载入更多项目'
                  : 'Load more Projects'}
            </button>
          )}
        </section>
      </section>
    </div>
  );
}
