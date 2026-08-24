import React, { Suspense } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { AppShell } from './components/layout/AppShell.js';
import { CommandPalette } from './components/CommandPalette.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { ToastViewport } from './components/ui/ToastViewport.js';
import { OnboardingWizard } from './components/onboarding/OnboardingWizard.js';
import { useBootstrap } from './hooks/use-bootstrap.js';
import { useDailyActiveTracker } from './hooks/useDailyActiveTracker.js';
import { getLocale } from './i18n.runtime.js';
import { getTargetDesktopApi } from './target/api.js';
import { TargetApp } from './target/TargetApp.js';
import { lazyPage } from './utils/performance.js';
import type { RootState } from './store/index.js';
import { SkeletonPage } from './components/ui/Skeleton.js';

const CanvasPage = lazyPage(async () => {
  const module = await import('./pages/CanvasPage.js');
  return { default: module.CanvasPage };
});
const Settings = lazyPage(async () => {
  const module = await import('./pages/Settings.js');
  return { default: module.Settings };
});
function LegacyApp() {
  useBootstrap();
  useDailyActiveTracker();
  const onboardingComplete = useSelector((s: RootState) => s.ui.onboardingComplete);

  return (
    <>
      <CommandPalette />
      <ToastViewport />
      <AppShell>
        <Suspense fallback={<SkeletonPage />}>
          <Routes>
            <Route path="/" element={<CanvasPage />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Suspense>
      </AppShell>
      {!onboardingComplete && <OnboardingWizard />}
    </>
  );
}

export function App() {
  const targetApi = getTargetDesktopApi();

  return (
    <ErrorBoundary>
      <HashRouter>
        {targetApi === null ? <LegacyApp /> : <TargetApp api={targetApi} locale={getLocale()} />}
      </HashRouter>
    </ErrorBoundary>
  );
}
