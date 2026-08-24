import { describe, expect, it } from 'vitest';

const targetSources = import.meta.glob('./**/*.{ts,tsx}', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

describe('target renderer dependency boundary', () => {
  it('does not import legacy IPC, Canvas components, or the legacy Redux store', () => {
    const violations: string[] = [];
    for (const [file, source] of Object.entries(targetSources)) {
      if (file.includes('.test.')) continue;
      if (/from ['"][^'"]*(?:store|utils\/api|components\/canvas|commander\/state)/.test(source)) {
        violations.push(file);
      }
      if (/\blucidAPI\b/.test(source)) violations.push(file);
    }
    expect(violations).toEqual([]);
  });
});
