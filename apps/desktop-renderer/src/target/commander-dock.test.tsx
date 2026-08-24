// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TargetApp } from './TargetApp.js';
import { createTargetApiFixture } from './test-fixture.js';

describe('target Commander Dock', () => {
  it('owns the single inline Run surface and queues a follow-up without a second activity view', async () => {
    const fixture = createTargetApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <TargetApp
          api={fixture.api}
          createRequestId={() => 'request.ui.commander'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Generate four candidates')).toBeTruthy();
    expect(screen.getByText(/generating four opening-direction candidates/i)).toBeTruthy();
    expect(screen.queryByText(/agent activity/i)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/describe the next change/i), {
      target: { value: 'Keep candidate two quieter.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

    await waitFor(() => expect(fixture.calls.runSendFollowup).toHaveBeenCalledTimes(1));
    expect(fixture.calls.runSendFollowup.mock.calls[0]?.[0].input.text).toBe(
      'Keep candidate two quieter.',
    );
  });

  it('enters Focus with the same conversation and restores the workspace on exit', async () => {
    const fixture = createTargetApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/canvas']}>
        <TargetApp api={fixture.api} createRequestId={() => 'request.ui.focus'} locale="en-US" />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Focus$/ }));
    expect(screen.getByRole('button', { name: /exit focus/i })).toBeTruthy();
    expect(screen.getByText(/generating four opening-direction candidates/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /exit focus/i }));
    expect(await screen.findByText(/spatial workspace/i)).toBeTruthy();
  });
});
