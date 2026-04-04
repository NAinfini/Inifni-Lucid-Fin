// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';

// Mock wavesurfer.js
const mockWs = {
  load: vi.fn(),
  play: vi.fn(),
  pause: vi.fn(),
  playPause: vi.fn(),
  seekTo: vi.fn(),
  destroy: vi.fn(),
  getDuration: vi.fn(() => 30),
  getCurrentTime: vi.fn(() => 0),
  on: vi.fn(),
};

vi.mock('wavesurfer.js', () => ({
  default: {
    create: vi.fn(() => mockWs),
  },
}));

import { WaveformPlayer } from './WaveformPlayer.js';

describe('WaveformPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('renders play button', () => {
    render(<WaveformPlayer audioUrl="test.mp3" />);
    expect(screen.getByLabelText('Play')).toBeDefined();
  });

  it('renders restart button', () => {
    render(<WaveformPlayer audioUrl="test.mp3" />);
    expect(screen.getByLabelText('Restart')).toBeDefined();
  });

  it('loads audio url on mount', () => {
    render(<WaveformPlayer audioUrl="test.mp3" />);
    expect(mockWs.load).toHaveBeenCalledWith('test.mp3');
  });

  it('destroys wavesurfer on unmount', () => {
    const { unmount } = render(<WaveformPlayer audioUrl="test.mp3" />);
    unmount();
    expect(mockWs.destroy).toHaveBeenCalled();
  });
});
