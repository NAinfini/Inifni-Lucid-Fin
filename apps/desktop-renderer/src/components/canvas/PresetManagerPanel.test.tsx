// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PresetDefinition } from '@lucid-fin/contracts';
import { setLocale, t } from '../../i18n.js';
import { getAPI } from '../../utils/api.js';
import { presetsSlice } from '../../store/slices/presets.js';
import { PresetManagerPanel } from './PresetManagerPanel.js';

vi.mock('../../utils/api.js', () => ({
  getAPI: vi.fn(),
}));

vi.mock('../ui/Dialog.js', () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <>{children}</> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

function createPreset(
  id: string,
  name: string,
  overrides: Partial<PresetDefinition> = {},
): PresetDefinition {
  return {
    id,
    name,
    category: 'look',
    description: `${name} description`,
    prompt: `${name} prompt`,
    builtIn: false,
    modified: false,
    params: [],
    defaults: { intensity: 50 },
    ...overrides,
  };
}

function renderWithStore(presets: PresetDefinition[], selectedId = presets[0]?.id ?? null) {
  const store = configureStore({
    reducer: {
      presets: presetsSlice.reducer,
    },
  });

  store.dispatch(
    presetsSlice.actions.restore({
      byId: Object.fromEntries(presets.map((preset) => [preset.id, preset])),
      allIds: presets.map((preset) => preset.id),
      loading: false,
      search: '',
      selectedCategory: 'all',
      managerSelectedPresetId: selectedId,
      hiddenIds: [],
    }),
  );

  render(
    <Provider store={store}>
      <PresetManagerPanel />
    </Provider>,
  );

  return store;
}

describe('PresetManagerPanel', () => {
  let confirmSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setLocale('en-US');
    vi.mocked(getAPI).mockReset();
    vi.mocked(getAPI).mockReturnValue(undefined);
    confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
  });

  afterEach(() => {
    cleanup();
    confirmSpy.mockRestore();
  });

  it('uses dialog confirmation instead of window.confirm for unsaved preset changes', async () => {
    renderWithStore([
      createPreset('preset-1', 'Preset One'),
      createPreset('preset-2', 'Preset Two'),
    ]);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Preset One')).toBeTruthy();
    });

    fireEvent.change(screen.getByDisplayValue('Preset One'), {
      target: { value: 'Preset One Updated' },
    });

    fireEvent.click(screen.getByText('Preset Two'));

    await waitFor(() => {
      expect(screen.getByText(t('presetManager.unsavedChanges'))).toBeTruthy();
    });

    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('uses dialog confirmation instead of window.confirm for preset deletion', async () => {
    renderWithStore([createPreset('preset-1', 'Preset One')]);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Preset One')).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle(t('action.delete')));

    await waitFor(() => {
      expect(
        screen.getByText(t('presetManager.deleteConfirm').replace('{name}', 'Preset One')),
      ).toBeTruthy();
    });

    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
