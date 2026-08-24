// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TargetApp } from './TargetApp.js';
import { createTargetApiFixture, targetProjectFixture } from './test-fixture.js';

describe('target Project shell', () => {
  it('opens from a compact Projects list and keeps the frozen workspace order', async () => {
    const fixture = createTargetApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <TargetApp api={fixture.api} createRequestId={() => 'request.ui.1'} locale="en-US" />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /open blue hour/i }));

    const navigation = await screen.findByRole('navigation', { name: /project workspace/i });
    expect(
      within(navigation)
        .getAllByRole('button')
        .map((button) => button.textContent?.trim()),
    ).toEqual(['Overview1', 'Canvas1', 'Media1', 'Production2', 'Delivery0']);
    expect(screen.getByRole('complementary', { name: /commander/i })).toBeTruthy();
  });

  it('creates the Project, first Chat, and first Run from one brief', async () => {
    const fixture = createTargetApiFixture();
    fixture.calls.projectList.mockImplementationOnce(async (request) => ({
      wireVersion: 1,
      kind: 'success',
      requestId: request.requestId,
      method: 'project.list',
      result: { items: [], nextCursor: null },
    }));
    render(
      <MemoryRouter initialEntries={['/projects']}>
        <TargetApp api={fixture.api} createRequestId={() => 'request.ui.create'} locale="en-US" />
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByPlaceholderText(/describe the film/i), {
      target: { value: 'A patient harbor film at blue hour.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create project & start/i }));

    await waitFor(() => expect(fixture.calls.messageSend).toHaveBeenCalledTimes(1));
    expect(fixture.calls.projectCreate.mock.calls[0]?.[0].input.name).toBe('A patient harbor film');
    expect(fixture.calls.chatCreate.mock.calls[0]?.[0].input.projectId).toBe(
      targetProjectFixture.id,
    );
    expect(fixture.calls.messageSend.mock.calls[0]?.[0].input.blocks).toEqual([
      { type: 'text', text: 'A patient harbor film at blue hour.' },
    ]);
    expect(await screen.findByText('Blue Hour')).toBeTruthy();
  });
});
