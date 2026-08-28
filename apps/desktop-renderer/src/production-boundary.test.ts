import { describe, expect, it } from 'vitest';

const rendererSources = import.meta.glob('./**/*.{ts,tsx}', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

describe('renderer dependency boundary', () => {
  it('does not import retired IPC, Canvas components, or Redux state', () => {
    const violations: string[] = [];
    for (const [file, source] of Object.entries(rendererSources)) {
      if (file.includes('.test.')) continue;
      if (/from ['"][^'"]*(?:store|utils\/api|components\/canvas|commander\/state)/.test(source)) {
        violations.push(file);
      }
      if (/\blucidAPI\b/.test(source)) violations.push(file);
    }
    expect(violations).toEqual([]);
  });
});
