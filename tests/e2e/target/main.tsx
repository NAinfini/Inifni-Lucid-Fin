import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { TargetApp } from '../../../apps/desktop-renderer/src/target/TargetApp.js';
import { createTargetApiFixture } from '../../../apps/desktop-renderer/src/target/test-fixture.js';

// Native Electron/preload/IPC acceptance remains a separate Gate B boundary.
const fixture = createTargetApiFixture({ includeDelivery: true });
Reflect.set(window, '__targetE2eFixture', fixture);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <HashRouter>
    <TargetApp api={fixture.api} createRequestId={() => crypto.randomUUID()} locale="en-US" />
  </HashRouter>,
);
