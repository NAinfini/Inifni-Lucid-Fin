// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { App } from './App.js';
import { createDesktopApiFixture } from './test-fixture.js';

describe('desktop accessibility and i18n', () => {
  it('renders the Project shell in Chinese and passes the stable jsdom axe rules', async () => {
    const fixture = createDesktopApiFixture();
    const { container } = render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <App api={fixture.api} createRequestId={() => 'request.ui.a11y'} locale="zh-CN" />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: /概览/ })).toBeTruthy();
    const results = await axe(container, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
