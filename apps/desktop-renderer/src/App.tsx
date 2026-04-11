import React, { Suspense } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { AppShell } from './components/layout/AppShell.js';
import { CommandPalette } from './components/CommandPalette.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { ToastViewport } from './components/ui/ToastViewport.js';
import { OnboardingWizard } from './components/onboarding/OnboardingWizard.js';
import { useUndoRedo } from './hooks/use-undo-redo.js';
import { useAutoProject } from './hooks/use-auto-project.js';
import { lazyPage } from './utils/performance.js';
import type { RootState } from './store/index.js';

const CanvasPage = lazyPage(async () => {
  const module = await import('./pages/CanvasPage.js');
  return { default: module.CanvasPage };
});
const Settings = lazyPage(async () => {
  const module = await import('./pages/Settings.js');
  return { default: module.Settings };
});
const TaskCenter = lazyPage(async () => {
  const module = await import('./pages/TaskCenter.js');
  return { default: module.TaskCenter };
});
const AudioStudio = lazyPage(async () => {
  const module = await import('./pages/AudioStudio.js');
  return { default: module.AudioStudio };
});
const ExportEngine = lazyPage(async () => {
  const module = await import('./pages/ExportEngine.js');
  return { default: module.ExportEngine };
});
const SeriesManager = lazyPage(async () => {
  const module = await import('./pages/SeriesManager.js');
  return { default: module.SeriesManager };
});

export function App() {
  useUndoRedo();
  useAutoProject();
  const onboardingComplete = useSelector((s: RootState) => s.ui.onboardingComplete);

  return (
    <ErrorBoundary>
      <HashRouter>
        <CommandPalette />
        <ToastViewport />
        <AppShell>
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading...
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<CanvasPage />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/tasks" element={<TaskCenter />} />
              <Route path="/audio" element={<AudioStudio />} />
              <Route path="/export" element={<ExportEngine />} />
              <Route path="/series" element={<SeriesManager />} />
            </Routes>
          </Suspense>
        </AppShell>
        {!onboardingComplete && <OnboardingWizard />}
      </HashRouter>
    </ErrorBoundary>
  );
}
