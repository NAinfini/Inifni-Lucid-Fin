// @vitest-environment jsdom

import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingWizard } from './OnboardingWizard.js';
import { canvasReducer } from '../../store/slices/canvas/index.js';
import { settingsSlice } from '../../store/slices/settings.js';
import { uiSlice } from '../../store/slices/ui.js';
import { setLocale } from '../../i18n.js';
import { getAPI } from '../../utils/api.js';

vi.mock('../../utils/api.js', () => ({ getAPI: vi.fn(() => null) }));

function createStore() {
  return configureStore({
    reducer: {
      canvas: canvasReducer,
      settings: settingsSlice.reducer,
      ui: uiSlice.reducer,
    },
  });
}

function renderProviderStep() {
  const store = createStore();
  render(
    <Provider store={store}>
      <MemoryRouter>
        <OnboardingWizard />
      </MemoryRouter>
    </Provider>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Get Started' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));

  return store;
}

describe('OnboardingWizard provider setup', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    setLocale('en-US');
  });

  it('uses the configured provider registry for Commander, image, video, and audio setup', () => {
    renderProviderStep();

    expect((screen.getByLabelText('Commander AI') as HTMLSelectElement).value).toBe('openai');
    expect((screen.getByLabelText('Image generation') as HTMLSelectElement).value).toBe(
      'openai-image',
    );
    expect((screen.getByLabelText('Video generation') as HTMLSelectElement).value).toBe(
      'google-video',
    );
    expect((screen.getByLabelText('Audio generation') as HTMLSelectElement).value).toBe(
      'openai-tts',
    );
    expect(screen.queryByRole('option', { name: 'Stability AI' })?.getAttribute('value')).toBe(
      'stability-image',
    );
  });

  it('stores and tests the canonical provider credential, then updates the provider readiness state', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const test = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(getAPI).mockReturnValue({
      keychain: { set, test },
    } as unknown as ReturnType<typeof getAPI>);

    const store = renderProviderStep();
    const imageSelect = screen.getByLabelText('Image generation');
    const imageCard = imageSelect.closest('div.rounded-lg') as HTMLElement;

    fireEvent.change(within(imageCard).getByLabelText('Image generation OpenAI GPT Image'), {
      target: { value: 'sk-image' },
    });
    fireEvent.click(within(imageCard).getByRole('button', { name: 'Test' }));

    await waitFor(() => {
      expect(set).toHaveBeenCalledWith('openai-image', 'sk-image');
      expect(test).toHaveBeenCalledWith(
        'openai-image',
        expect.objectContaining({ id: 'openai-image' }),
        'image',
      );
      expect(
        store.getState().settings.image.providers.find((provider) => provider.id === 'openai-image')
          ?.hasKey,
      ).toBe(true);
    });

    expect(within(imageCard).getByRole('status').textContent).toContain('Connection successful');
  });

  it('does not report a failed provider test as ready', async () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const test = vi.fn().mockResolvedValue({ ok: false, error: 'Invalid API key' });
    vi.mocked(getAPI).mockReturnValue({
      keychain: { set, test },
    } as unknown as ReturnType<typeof getAPI>);

    const store = renderProviderStep();
    const imageSelect = screen.getByLabelText('Image generation');
    const imageCard = imageSelect.closest('div.rounded-lg') as HTMLElement;

    fireEvent.change(within(imageCard).getByLabelText('Image generation OpenAI GPT Image'), {
      target: { value: 'sk-invalid' },
    });
    fireEvent.click(within(imageCard).getByRole('button', { name: 'Test' }));

    await waitFor(() => {
      expect(
        store.getState().settings.image.providers.find((provider) => provider.id === 'openai-image')
          ?.hasKey,
      ).toBe(false);
    });

    expect(within(imageCard).getByRole('alert').textContent).toContain('Invalid API key');
  });
});
