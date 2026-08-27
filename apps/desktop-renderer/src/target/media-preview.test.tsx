// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TargetEnvironmentProvider } from './environment.js';
import { TargetMediaPreview, useSynchronizedPlayback } from './MediaPreview.js';
import { createTargetApiFixture, targetMediaFixture } from './test-fixture.js';

afterEach(cleanup);

function SynchronizedMediaHarness() {
  const sync = useSynchronizedPlayback();
  return (
    <>
      <video
        aria-label="Candidate one"
        ref={(element) => sync.register('one', element)}
        onPlay={(event) => sync.play('one', event.currentTarget)}
        onPause={(event) => sync.pause('one', event.currentTarget)}
        onSeeking={(event) => sync.seek('one', event.currentTarget)}
      />
      <video
        aria-label="Candidate two"
        ref={(element) => sync.register('two', element)}
        onPlay={(event) => sync.play('two', event.currentTarget)}
        onPause={(event) => sync.pause('two', event.currentTarget)}
        onSeeking={(event) => sync.seek('two', event.currentTarget)}
      />
      {sync.error !== null && <p role="alert">{sync.error}</p>}
    </>
  );
}

describe('Target media preview playback', () => {
  it('reuses a grant for semantically equivalent inline sources and refreshes changed sources', async () => {
    const fixture = createTargetApiFixture();
    const createRequestId = () => 'request.ui.preview.identity';
    const preview = (refId: string) => (
      <TargetEnvironmentProvider value={{ api: fixture.api, createRequestId, locale: 'en-US' }}>
        <TargetMediaPreview
          projectId="project.blue-hour"
          source={{
            kind: 'project_media_ref',
            ref: { ...targetMediaFixture, id: refId },
          }}
          label="Reference preview"
        />
      </TargetEnvironmentProvider>
    );
    const view = render(preview(targetMediaFixture.id));

    await waitFor(() => expect(fixture.calls.mediaPreviewIssue).toHaveBeenCalledTimes(1));
    view.rerender(preview(targetMediaFixture.id));
    expect(fixture.calls.mediaPreviewIssue).toHaveBeenCalledTimes(1);

    view.rerender(preview('project-media.changed'));
    await waitFor(() => expect(fixture.calls.mediaPreviewIssue).toHaveBeenCalledTimes(2));
  });

  it('synchronizes compare playback time and surfaces peer playback rejection', async () => {
    render(<SynchronizedMediaHarness />);
    const first = screen.getByLabelText('Candidate one') as HTMLVideoElement;
    const second = screen.getByLabelText('Candidate two') as HTMLVideoElement;
    const play = vi.fn().mockRejectedValue(new Error('autoplay denied'));
    Object.defineProperty(second, 'paused', { configurable: true, get: () => true });
    Object.defineProperty(second, 'play', { configurable: true, value: play });
    first.currentTime = 4.25;

    fireEvent.play(first);

    expect(second.currentTime).toBe(4.25);
    expect(play).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain(
        'Synchronized playback could not start',
      ),
    );
  });

  it('propagates explicit seek and pause actions to peers', () => {
    render(<SynchronizedMediaHarness />);
    const first = screen.getByLabelText('Candidate one') as HTMLVideoElement;
    const second = screen.getByLabelText('Candidate two') as HTMLVideoElement;
    const pause = vi.fn();
    Object.defineProperty(second, 'paused', { configurable: true, get: () => false });
    Object.defineProperty(second, 'pause', { configurable: true, value: pause });

    first.currentTime = 8.5;
    fireEvent.seeking(first);
    fireEvent.pause(first);

    expect(second.currentTime).toBe(8.5);
    expect(pause).toHaveBeenCalledTimes(1);
  });
});
