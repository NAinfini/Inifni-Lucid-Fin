import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { StatusBar } from './StatusBar.js';
import type { RootState } from '../../store/index.js';

export function AppShell({ children }: { children: React.ReactNode }) {
  const theme = useSelector((state: RootState) => state.ui.theme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  return (
    <div className="flex h-screen flex-col">
      {/* Custom title bar — drag region, 40px matches titleBarOverlay height in electron.ts */}
      <div
        className="flex h-10 w-full shrink-0 items-center gap-2 border-b border-border/40 bg-background px-3 select-none"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* App icon */}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="16" height="16" rx="3" fill="hsl(var(--primary))"/>
          <path d="M4 8L7 11L12 5" stroke="hsl(var(--primary-foreground))" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
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
