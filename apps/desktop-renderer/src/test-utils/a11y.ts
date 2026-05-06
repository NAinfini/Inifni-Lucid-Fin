/**
 * Accessibility testing helpers built on axe-core via vitest-axe.
 *
 * Usage:
 *   import { checkA11y } from '../test-utils/a11y.js';
 *   it('has no a11y violations', async () => { await checkA11y(<MyComponent />); });
 */
import type { ReactElement } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { axe, type AxeMatchers } from 'vitest-axe';
import * as matchers from 'vitest-axe/matchers';
import { expect } from 'vitest';
import type { AxeResults, RunOptions } from 'axe-core';

// Extend Vitest's expect with vitest-axe matchers
expect.extend(matchers);

// Re-export the matcher type so test files can augment their local expect
export type { AxeMatchers };

export interface CheckA11yOptions {
  /** @testing-library/react render options (wrapper, etc.) */
  renderOptions?: RenderOptions;
  /** axe-core run options — override rules, set impact thresholds, etc. */
  axeOptions?: RunOptions;
}

/**
 * Render a React element and run axe-core against the resulting DOM.
 *
 * By default, all rules are enabled. Violations are reported with their
 * severity (impact), the violated rule ID, a human-readable description,
 * and the affected DOM nodes.
 *
 * @returns The raw AxeResults for further inspection if needed.
 */
export async function checkA11y(
  ui: ReactElement,
  options: CheckA11yOptions = {},
): Promise<AxeResults> {
  const { container } = render(ui, options.renderOptions);
  const results = await axe(container, options.axeOptions);

  // Use the vitest-axe matcher for clean failure output
  expect(results).toHaveNoViolations();

  return results;
}

/**
 * Same as `checkA11y` but returns violations without asserting, so callers
 * can inspect severity or selectively ignore known issues.
 */
export async function getA11yViolations(
  ui: ReactElement,
  options: CheckA11yOptions = {},
): Promise<AxeResults['violations']> {
  const { container } = render(ui, options.renderOptions);
  const results = await axe(container, options.axeOptions);
  return results.violations;
}

/**
 * Format violations into a human-readable summary string for logging or
 * baseline reports.
 */
export function formatViolations(violations: AxeResults['violations']): string {
  if (violations.length === 0) return 'No accessibility violations found.';

  return violations
    .map((v) => {
      const nodes = v.nodes.map((n) => `    - ${n.html}`).join('\n');
      return `[${v.impact?.toUpperCase() ?? 'UNKNOWN'}] ${v.id}: ${v.description}\n  Help: ${v.helpUrl}\n  Affected nodes:\n${nodes}`;
    })
    .join('\n\n');
}
