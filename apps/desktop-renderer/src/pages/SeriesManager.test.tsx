// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { SeriesManager } from './SeriesManager.js';
import { t } from '../i18n.js';
import { seriesSlice } from '../store/slices/series.js';

function createStore() {
  return configureStore({
    reducer: {
      series: seriesSlice.reducer,
    },
  });
}

describe('SeriesManager', () => {
  afterEach(cleanup);

  it('renders series manager page', () => {
    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <SeriesManager />
        </MemoryRouter>
      </Provider>,
    );
    expect(screen.getByText(t('series.title'))).toBeTruthy();
  });

  it('shows empty state', () => {
    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <SeriesManager />
        </MemoryRouter>
      </Provider>,
    );
    expect(screen.getByText(t('series.empty'))).toBeTruthy();
  });

  it('shows create button', () => {
    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <SeriesManager />
        </MemoryRouter>
      </Provider>,
    );
    expect(screen.getByText(t('series.newSeries'))).toBeTruthy();
  });
});
