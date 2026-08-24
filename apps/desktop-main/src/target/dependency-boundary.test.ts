import { readdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TARGET_ROOT = fileURLToPath(new URL('.', import.meta.url));
const SOURCE_EXTENSIONS = new Set(['.ts', '.cts', '.mts']);
const ALLOWED_PACKAGES = [
  '@lucid-fin/target-contracts',
  '@lucid-fin/target-runtime',
  '@lucid-fin/target-storage',
] as const;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!SOURCE_EXTENSIONS.has(extname(entry.name)) || entry.name.includes('.test.')) return [];
    return [path];
  });
}

function importSpecifiers(source: string): string[] {
  return Array.from(
    source.matchAll(/(?:\bfrom\s*|\bimport\s*\()(['"])([^'"]+)\1/g),
    (match) => match[2],
  );
}

function isAllowedPackage(specifier: string): boolean {
  return (
    specifier === 'electron' ||
    specifier.startsWith('node:') ||
    ALLOWED_PACKAGES.some(
      (packageName) => specifier === packageName || specifier.startsWith(`${packageName}/`),
    )
  );
}

describe('target desktop dependency boundary', () => {
  it('depends only on target packages, Electron, Node, and files inside the target root', () => {
    const violations: string[] = [];

    for (const file of sourceFiles(TARGET_ROOT)) {
      const source = readFileSync(file, 'utf8');
      for (const specifier of importSpecifiers(source)) {
        if (specifier.startsWith('.')) {
          const target = resolve(dirname(file), specifier);
          if (!target.startsWith(TARGET_ROOT)) violations.push(`${file}: ${specifier}`);
        } else if (!isAllowedPackage(specifier)) {
          violations.push(`${file}: ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
