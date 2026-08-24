// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';
import { TargetApp } from './TargetApp.js';
import { createTargetApiFixture } from './test-fixture.js';

describe('target accessibility and i18n', () => {
  it('renders the Project shell in Chinese and passes the stable jsdom axe rules', async () => {
    const fixture = createTargetApiFixture();
    const { container } = render(
      <MemoryRouter initialEntries={['/projects/project.blue-hour/overview']}>
        <TargetApp api={fixture.api} createRequestId={() => 'request.ui.a11y'} locale="zh-CN" />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('button', { name: /概览/ })).toBeTruthy();
    const results = await axe(container, {
      rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
    });
    expect(results.violations).toEqual([]);
  });
});
