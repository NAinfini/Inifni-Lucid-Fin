import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceDirectory = new URL('.', import.meta.url).pathname.replace(/^\/(.:\/)/, '$1');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('target contract dependency boundary', () => {
  it('has zod as its only runtime dependency', () => {
    const packageJson = JSON.parse(
      readFileSync(join(sourceDirectory, '..', 'package.json'), 'utf8'),
    ) as { dependencies?: { [name: string]: string } };

    expect(Object.keys(packageJson.dependencies ?? {})).toEqual(['zod']);
  });

  it('does not import legacy Lucid packages or define generic patch contracts', () => {
    const sources = sourceFiles(sourceDirectory)
      .map((name) => readFileSync(name, 'utf8'))
      .join('\n');

    expect(sources).not.toMatch(/from ['"]@lucid-fin\//);
    expect(sources).not.toMatch(/\bRecord\s*</);
    expect(sources).not.toMatch(/\bpatch\b/i);
    expect(sources).not.toMatch(/\bfallback\b/i);

    const externalImports = [...sources.matchAll(/from ['"]([^'"]+)['"]/g)]
      .map((match) => match[1])
      .filter((specifier) => !specifier.startsWith('.'));
    expect([...new Set(externalImports)]).toEqual(['zod']);
  });
});
