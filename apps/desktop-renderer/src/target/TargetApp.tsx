import React, { useMemo } from 'react';
import { Clapperboard } from 'lucide-react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import type { TargetDesktopApiV1 } from '@lucid-fin/target-contracts';
import { createTargetRequestId } from './api.js';
import type { TargetLocale } from './copy.js';
import { TargetEnvironmentProvider } from './environment.js';
import { ProjectHome } from './ProjectHome.js';
import { ProjectShell } from './ProjectShell.js';
import { TARGET_WORKSPACES, type TargetWorkspace } from './shared-selection.js';
import './target.css';

export interface TargetAppProps {
  readonly api: TargetDesktopApiV1;
  readonly createRequestId?: () => string;
  readonly locale?: TargetLocale;
}

function isWorkspace(value: string | undefined): value is TargetWorkspace {
  return value !== undefined && TARGET_WORKSPACES.some((workspace) => workspace === value);
}

function ProjectRoute() {
  const navigate = useNavigate();
  const { projectId, workspace } = useParams();
  if (projectId === undefined) return <Navigate to="/projects" replace />;
  const resolvedWorkspace = isWorkspace(workspace) ? workspace : 'overview';
  return (
    <ProjectShell
      projectId={projectId}
      workspace={resolvedWorkspace}
      onWorkspaceChange={(next) => navigate(`/projects/${projectId}/${next}`)}
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
            <Route path="/projects/:projectId/:workspace" element={<ProjectRoute />} />
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Routes>
        </main>
      </div>
    </TargetEnvironmentProvider>
  );
}
