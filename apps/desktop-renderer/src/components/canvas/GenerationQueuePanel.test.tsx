// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GenerationQueuePanel } from './GenerationQueuePanel.js';
import { getAPI, type LucidAPI } from '../../utils/api.js';

vi.mock('../../utils/api.js', () => ({
  getAPI: vi.fn(),
}));

describe('GenerationQueuePanel', () => {
  it('renders active generation jobs from the job API', async () => {
    const list = vi.fn(async () => [
      {
        id: 'job-1',
        provider: 'mock-image',
        status: 'running',
        progress: 45,
        currentStep: 'Generating variant 1',
      },
    ]);
    const onProgress = vi.fn(() => () => {});
    const onComplete = vi.fn(() => () => {});

    vi.mocked(getAPI).mockReturnValue({
      job: {
        list,
        onProgress,
        onComplete,
      },
    } as unknown as LucidAPI);

    render(<GenerationQueuePanel />);

    expect(await screen.findByText('mock-image')).toBeTruthy();
    expect(screen.getByText('Generating variant 1')).toBeTruthy();
    expect(screen.getByText('running')).toBeTruthy();
  });
});
