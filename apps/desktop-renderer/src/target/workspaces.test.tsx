// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TargetApp } from './TargetApp.js';
import { createTargetApiFixture } from './test-fixture.js';

describe('target Project workspaces', () => {
  it('queries each authoritative projection and shares one selected object with Commander', async () => {
    const fixture = createTargetApiFixture();
    render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <TargetApp
          api={fixture.api}
          createRequestId={() => 'request.ui.workspace'}
          locale="en-US"
        />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Production2$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /select shot 04/i }));
    expect(await screen.findByRole('button', { name: /remove shot 04/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Canvas1$/ }));
    await screen.findByText(/spatial workspace/i);
    fireEvent.click(screen.getByRole('button', { name: /^Media1$/ }));
    await screen.findByText('Harbor reference');
    fireEvent.click(screen.getByRole('button', { name: /^Delivery0$/ }));
    await screen.findByText(/delivery is assembled/i);

    expect(fixture.calls.productionQuery).toHaveBeenCalled();
    expect(fixture.calls.canvasGet).toHaveBeenCalled();
    expect(fixture.calls.mediaProjectList).toHaveBeenCalled();
    expect(fixture.calls.deliveryQuery).toHaveBeenCalled();
  });
});
