import React, { useMemo } from 'react';
import { Minus, Square, X } from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { DesktopApiV1 } from '@lucid-fin/contracts';
import { createRequestId as createRendererRequestId } from './api.js';
import type { Locale } from './copy.js';
import { DesktopEnvironmentProvider } from './environment.js';
import { GlobalMediaPage } from './GlobalMediaPage.js';
import { ProjectHome } from './ProjectHome.js';
import { ProjectShell } from './ProjectShell.js';
import { isWorkspace } from './shared-selection.js';
import './app.css';

export interface AppProps {
  readonly api: DesktopApiV1;
  readonly createRequestId?: () => string;
  readonly locale?: Locale;
}

const logoUrl = new URL('../../../asset/Logo.png', import.meta.url).href;

function WindowTitlebar({ api, locale }: Pick<AppProps, 'api' | 'locale'>) {
  const chinese = locale === 'zh-CN';
  return (
    <header className="lucid-titlebar" aria-label={chinese ? 'Lucid Fin 窗口' : 'Lucid Fin window'}>
      <div className="lucid-titlebar-drag">
        <img className="lucid-titlebar-logo" src={logoUrl} alt="" />
        <strong>Lucid Fin</strong>
        <span className="lucid-titlebar-mode">
          {chinese ? 'AI 影片制作' : 'AI film production'}
        </span>
      </div>
      <div className="lucid-window-controls" aria-label={chinese ? '窗口控制' : 'Window controls'}>
        <button
          type="button"
          aria-label={chinese ? '最小化窗口' : 'Minimize window'}
          title={chinese ? '最小化' : 'Minimize'}
          onClick={() => api.windowControls.minimize()}
        >
          <Minus size={16} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          aria-label={chinese ? '最大化或还原窗口' : 'Maximize or restore window'}
          title={chinese ? '最大化或还原' : 'Maximize or restore'}
          onClick={() => api.windowControls.toggleMaximize()}
        >
          <Square size={13} strokeWidth={1.5} />
        </button>
        <button
          className="lucid-window-close"
          type="button"
          aria-label={chinese ? '关闭窗口' : 'Close window'}
          title={chinese ? '关闭' : 'Close'}
          onClick={() => api.windowControls.close()}
        >
          <X size={17} strokeWidth={1.6} />
        </button>
      </div>
    </header>
  );
}

function ProjectRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId, workspace } = useParams();
  if (projectId === undefined) return <Navigate to="/projects" replace />;
  if (!isWorkspace(workspace)) {
    return <Navigate to={`/projects/${projectId}/overview${location.search}`} replace />;
  }
  return (
    <ProjectShell
      key={projectId}
      projectId={projectId}
      workspace={workspace}
      onWorkspaceChange={(next) =>
        navigate({ pathname: `/projects/${projectId}/${next}`, search: location.search })
      }
      onBack={() => navigate('/projects')}
    />
  );
}

export function App({
  api,
  createRequestId = createRendererRequestId,
  locale = 'en-US',
}: AppProps) {
  const environment = useMemo(
    () => ({ api, createRequestId, locale }),
    [api, createRequestId, locale],
  );
  return (
    <DesktopEnvironmentProvider value={environment}>
      <div className="lucid-app" lang={locale}>
        <a className="lucid-skip-link" href="#lucid-main">
          {locale === 'zh-CN' ? '跳到主要内容' : 'Skip to main content'}
        </a>
        <WindowTitlebar api={api} locale={locale} />
        <main id="lucid-main" className="lucid-main">
          <Routes>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="/projects" element={<ProjectHome />} />
            <Route path="/media" element={<GlobalMediaPage />} />
            <Route path="/projects/:projectId" element={<ProjectRoute />} />
            <Route path="/projects/:projectId/:workspace" element={<ProjectRoute />} />
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Routes>
        </main>
      </div>
    </DesktopEnvironmentProvider>
  );
}
