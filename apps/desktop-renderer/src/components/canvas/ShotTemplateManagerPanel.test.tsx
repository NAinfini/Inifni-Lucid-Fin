// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BUILT_IN_PRESET_LIBRARY, type ShotTemplate } from '@lucid-fin/contracts';
import { setLocale, t } from '../../i18n.js';
import { presetsSlice } from '../../store/slices/presets.js';
import { shotTemplatesSlice } from '../../store/slices/shotTemplates.js';
import { uiSlice } from '../../store/slices/ui.js';
import { ShotTemplateManagerPanel } from './ShotTemplateManagerPanel.js';

function createCustomTemplate(): ShotTemplate {
  return {
    id: 'custom-template-1',
    name: 'Custom Template',
    description: 'Custom description',
    builtIn: false,
    tracks: {
      camera: {
        category: 'camera',
        aiDecide: false,
        intensity: 70,
        entries: [
          {
            id: 'entry-1',
            category: 'camera',
            presetId: 'builtin-camera-push-in',
            params: {},
            order: 0,
            intensity: 70,
          },
        ],
      },
    },
  };
}

function renderPanel() {
  const store = configureStore({
    reducer: {
      presets: presetsSlice.reducer,
      shotTemplates: shotTemplatesSlice.reducer,
      ui: uiSlice.reducer,
    },
  });

  store.dispatch(presetsSlice.actions.setPresets(BUILT_IN_PRESET_LIBRARY));
  store.dispatch(shotTemplatesSlice.actions.addCustomTemplate(createCustomTemplate()));
  store.dispatch(uiSlice.actions.setActivePanel('shotTemplates'));

  render(
    <Provider store={store}>
      <ShotTemplateManagerPanel />
    </Provider>,
  );

  return store;
}

describe('ShotTemplateManagerPanel', () => {
  beforeEach(() => {
    setLocale('en-US');
  });

  afterEach(() => {
    cleanup();
  });

  it('shows built-in and custom templates and reveals track configuration for the selected template', () => {
    renderPanel();

    expect(screen.getByText('Dramatic Reveal')).toBeTruthy();
    expect(screen.getByText('Custom Template')).toBeTruthy();
    expect(screen.getAllByText(t('shotTemplates.builtIn')).length).toBeGreaterThan(0);
    expect(screen.getByText(t('shotTemplates.custom'))).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /dramatic reveal/i }));

    expect(screen.getByText(t('presetCategory.camera'))).toBeTruthy();
    expect(screen.getByText('Push In')).toBeTruthy();
  });

  it('adds, edits, and deletes custom templates without rendering a close button', () => {
    const store = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /custom template/i }));

    const nameInput = screen.getByLabelText(t('presetManager.fields.name'));
    const descriptionInput = screen.getByLabelText(t('presetManager.fields.description'));

    fireEvent.change(nameInput, { target: { value: 'Renamed Template' } });
    fireEvent.change(descriptionInput, { target: { value: 'Updated description' } });

    expect(store.getState().shotTemplates.custom[0]?.name).toBe('Renamed Template');
    expect(store.getState().shotTemplates.custom[0]?.description).toBe('Updated description');

    fireEvent.click(screen.getByRole('button', { name: t('shotTemplates.addTemplate') }));
    expect(store.getState().shotTemplates.custom).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: t('shotTemplates.deleteTemplate') }));
    expect(store.getState().shotTemplates.custom).toHaveLength(1);
    expect(screen.queryByRole('button', { name: t('commander.close') })).toBeNull();
    expect(store.getState().ui.activePanel).toBe('shotTemplates');
  });
});
