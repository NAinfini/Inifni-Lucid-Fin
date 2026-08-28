import React, { useMemo } from 'react';
import { Clapperboard } from 'lucide-react';
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
        <header className="lucid-titlebar" aria-label="Lucid Fin">
          <span className="lucid-mark" aria-hidden="true">
            <Clapperboard size={16} strokeWidth={1.7} />
          </span>
          <strong>Lucid Fin</strong>
          <span className="lucid-titlebar-mode">
            {locale === 'zh-CN' ? 'AI 视频制作' : 'AI video production'}
          </span>
        </header>
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
