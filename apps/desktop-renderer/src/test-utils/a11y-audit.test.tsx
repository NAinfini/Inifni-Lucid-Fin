// @vitest-environment jsdom
/**
 * Accessibility audit baseline tests.
 *
 * These tests render key UI surfaces and run axe-core to detect WCAG
 * violations.  They are intentionally lenient on color-contrast (which
 * requires computed styles that jsdom cannot provide) but strict on
 * structural / ARIA issues.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { axe } from 'vitest-axe';
import * as matchers from 'vitest-axe/matchers';

import { CanvasToolbar } from '../components/canvas/CanvasToolbar.js';
import { SettingsSidebarNav } from '../components/settings/SettingsSidebarNav.js';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../components/ui/Dialog.js';
import { EmptyState } from '../components/ui/EmptyState.js';
import { Button } from '../components/ui/Button.js';
import { settingsSlice } from '../store/slices/settings.js';
import { setLocale } from '../i18n.js';
import { AlertTriangle } from 'lucide-react';

expect.extend(matchers);

// ── axe config ─────────────────────────────────────────────────────────
// Disable color-contrast since jsdom has no computed styles, and
// disable region rule since isolated component renders lack landmarks.
const AXE_OPTIONS = {
  rules: {
    'color-contrast': { enabled: false },
    region: { enabled: false },
  },
};

// ── Store helpers ──────────────────────────────────────────────────────
function createMinimalStore() {
  return configureStore({
    reducer: { settings: settingsSlice.reducer },
  });
}

// ── Cleanup ────────────────────────────────────────────────────────────
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  setLocale('en-US');
});

// ── Tests ──────────────────────────────────────────────────────────────

describe('a11y audit: CanvasToolbar', () => {
  it('has no axe violations', async () => {
    const { container } = render(
      <CanvasToolbar
        minimapVisible={false}
        snapToGrid={false}
        searchOpen={false}
        onToggleSearch={vi.fn()}
        onToggleMinimap={vi.fn()}
        onToggleSnapToGrid={vi.fn()}
        onExportWorkflow={vi.fn()}
        onImportWorkflow={vi.fn()}
      />,
    );

    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('has no axe violations with active canvas controls', async () => {
    const { container } = render(
      <CanvasToolbar
        minimapVisible
        snapToGrid
        searchOpen={false}
        onToggleSearch={vi.fn()}
        onToggleMinimap={vi.fn()}
        onToggleSnapToGrid={vi.fn()}
        onExportWorkflow={vi.fn()}
        onImportWorkflow={vi.fn()}
      />,
    );

    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });
});

describe('a11y audit: SettingsSidebarNav', () => {
  it('has no axe violations', async () => {
    const store = createMinimalStore();
    const { container } = render(
      <Provider store={store}>
        <SettingsSidebarNav activeTab="providers" onTabChange={vi.fn()} />
      </Provider>,
    );

    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });

  it('marks the active tab with aria-current', () => {
    const store = createMinimalStore();
    render(
      <Provider store={store}>
        <SettingsSidebarNav activeTab="commander" onTabChange={vi.fn()} />
      </Provider>,
    );

    const buttons = document.querySelectorAll('button[aria-current="page"]');
    expect(buttons.length).toBe(1);
    expect(buttons[0]?.textContent).toContain('Commander');
  });
});

describe('a11y audit: Dialog', () => {
  it('has no axe violations when open with title and description', async () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Test Dialog Title</DialogTitle>
          <DialogDescription>This is a test dialog description.</DialogDescription>
          <Button>Confirm</Button>
        </DialogContent>
      </Dialog>,
    );

    // Dialog portals to body, so run axe on the document body
    const results = await axe(document.body, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });
});

describe('a11y audit: EmptyState', () => {
  it('has no axe violations', async () => {
    const { container } = render(
      <EmptyState
        icon={AlertTriangle}
        title="No items found"
        description="Try adding some items to get started."
        action={<Button size="sm">Add Item</Button>}
      />,
    );

    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });
});

describe('a11y audit: Button variants', () => {
  it('has no axe violations across all variants', async () => {
    const { container } = render(
      <div>
        <Button variant="default">Default</Button>
        <Button variant="destructive">Delete</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="link">Link</Button>
        <Button disabled>Disabled</Button>
        <Button size="icon" aria-label="Settings">
          <AlertTriangle />
        </Button>
      </div>,
    );

    const results = await axe(container, AXE_OPTIONS);
    expect(results).toHaveNoViolations();
  });
});
