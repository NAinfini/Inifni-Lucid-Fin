import React, { useMemo } from 'react';
import { Clapperboard } from 'lucide-react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { TargetDesktopApiV1 } from '@lucid-fin/target-contracts';
import { createTargetRequestId } from './api.js';
import type { TargetLocale } from './copy.js';
import { TargetEnvironmentProvider } from './environment.js';
import { GlobalMediaPage } from './GlobalMediaPage.js';
import { ProjectHome } from './ProjectHome.js';
import { ProjectShell } from './ProjectShell.js';
import { isTargetWorkspace } from './shared-selection.js';
import './target.css';

export interface TargetAppProps {
  readonly api: TargetDesktopApiV1;
  readonly createRequestId?: () => string;
  readonly locale?: TargetLocale;
}

function ProjectRoute() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId, workspace } = useParams();
  if (projectId === undefined) return <Navigate to="/projects" replace />;
  if (!isTargetWorkspace(workspace)) {
    return (
      <Navigate
        to={`/projects/${projectId}/overview${location.search}`}
        replace
      />
    );
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

export function TargetApp({
  api,
  createRequestId = createTargetRequestId,
  locale = 'en-US',
}: TargetAppProps) {
  const environment = useMemo(
    () => ({ api, createRequestId, locale }),
    [api, createRequestId, locale],
  );
  return (
    <TargetEnvironmentProvider value={environment}>
      <div className="target-app" lang={locale}>
        <a className="target-skip-link" href="#target-main">
          {locale === 'zh-CN' ? '跳到主要内容' : 'Skip to main content'}
        </a>
        <header className="target-titlebar" aria-label="Lucid Fin">
          <span className="target-mark" aria-hidden="true">
            <Clapperboard size={16} strokeWidth={1.7} />
          </span>
          <strong>Lucid Fin</strong>
          <span className="target-titlebar-mode">
            {locale === 'zh-CN' ? 'AI 视频制作' : 'AI video production'}
          </span>
        </header>
        <main id="target-main" className="target-main">
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
    </TargetEnvironmentProvider>
  );
}
