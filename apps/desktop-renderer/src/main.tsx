import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import type { DesktopApiV1 } from '@lucid-fin/contracts';
import type { Locale } from './copy.js';
import { App } from './App.js';

declare global {
  interface Window {
    lucidFin?: DesktopApiV1;
  }
}

export const DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE =
  'Lucid Fin cannot start because the preload bridge is unavailable.';

export class DesktopBridgeUnavailableError extends Error {
  constructor() {
    super(DESKTOP_BRIDGE_UNAVAILABLE_MESSAGE);
    this.name = 'DesktopBridgeUnavailableError';
  }
}

export function desktopApi(target: Window = window): DesktopApiV1 {
  if (target.lucidFin === undefined) throw new DesktopBridgeUnavailableError();
  return target.lucidFin;
}

export function desktopLocale(language: string = navigator.language): Locale {
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

export function startRenderer(root: Element, api: DesktopApiV1): void {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <HashRouter>
        <App api={api} locale={desktopLocale()} />
      </HashRouter>
    </React.StrictMode>,
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Lucid Fin renderer requires #root.');
startRenderer(root, desktopApi());
