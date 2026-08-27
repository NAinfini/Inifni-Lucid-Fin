import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import type { TargetDesktopApiV1 } from '@lucid-fin/target-contracts';
import type { TargetLocale } from './target/copy.js';
import { TargetApp } from './target/TargetApp.js';

declare global {
  interface Window {
    lucidTarget?: TargetDesktopApiV1;
  }
}

export const TARGET_RC_BRIDGE_UNAVAILABLE_MESSAGE =
  'Target RC cannot start because the target preload bridge is unavailable.';

export class TargetRcBridgeUnavailableError extends Error {
  constructor() {
    super(TARGET_RC_BRIDGE_UNAVAILABLE_MESSAGE);
    this.name = 'TargetRcBridgeUnavailableError';
  }
}

export function targetRcDesktopApi(target: Window = window): TargetDesktopApiV1 {
  if (target.lucidTarget === undefined) throw new TargetRcBridgeUnavailableError();
  return target.lucidTarget;
}

export function targetRcLocale(language: string = navigator.language): TargetLocale {
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
}

export function startTargetRcRenderer(root: Element, api: TargetDesktopApiV1): void {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <HashRouter>
        <TargetApp api={api} locale={targetRcLocale()} />
      </HashRouter>
    </React.StrictMode>,
  );
}

const root = document.getElementById('root');
if (root === null) throw new Error('Target RC renderer requires #root.');
startTargetRcRenderer(root, targetRcDesktopApi());
