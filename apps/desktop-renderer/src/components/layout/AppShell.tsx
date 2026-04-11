import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { StatusBar } from './StatusBar.js';
import type { RootState } from '../../store/index.js';
import { t } from '../../i18n.js';

export function AppShell({ children }: { children: React.ReactNode }) {
  const theme = useSelector((state: RootState) => state.ui.theme);
  const appLogoSrc = `${import.meta.env.BASE_URL}favicon.png`;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.classList.toggle('high-contrast', theme === 'high-contrast');
  }, [theme]);

  return (
    <div className="flex h-screen flex-col">
      {/* Skip link — visible on focus for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[200] focus:left-2 focus:top-2 focus:rounded focus:bg-primary focus:px-3 focus:py-1.5 focus:text-xs focus:font-semibold focus:text-primary-foreground"
      >
        {t('layout.skipToContent')}
      </a>
      {/* Custom title bar — drag region, 40px matches titleBarOverlay height in electron.ts */}
      <div
        className="flex h-10 w-full shrink-0 items-center gap-2 border-b border-border/40 bg-background px-3 select-none"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <img src={appLogoSrc} alt="Lucid Fin logo" className="h-4 w-4 shrink-0 object-contain" />
        <span className="text-xs font-semibold tracking-wide text-foreground/80">Lucid Fin</span>
      </div>
      <main
        id="main-content"
        className="flex-1 overflow-hidden"
        role="main"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {children}
      </main>
      <StatusBar />
    </div>
  );
}
