// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { AudioStudio } from './AudioStudio.js';

vi.mock('../utils/api.js', () => ({ getAPI: () => null }));

function createStore() {
  return configureStore({
    reducer: {
      audio: (s = { tracks: [] }) => s,
      settings: (s = {}) => s,
    },
  });
}

describe('AudioStudio', () => {
  afterEach(cleanup);

  it('renders with voice tab active', () => {
    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <AudioStudio />
        </MemoryRouter>
      </Provider>,
    );
    expect(screen.getByText(/音频工作室|Audio Studio/)).toBeTruthy();
  });

  it('renders provider select', () => {
    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <AudioStudio />
        </MemoryRouter>
      </Provider>,
    );
    expect(screen.getByText('ElevenLabs')).toBeTruthy();
  });

  it('renders generate button', () => {
    render(
      <Provider store={createStore()}>
        <MemoryRouter>
          <AudioStudio />
        </MemoryRouter>
      </Provider>,
    );
    expect(screen.getAllByText(/生成|Generate/).length).toBeGreaterThanOrEqual(1);
  });
});
