/**
 * Coverage ratchet script.
 *
 * Reads the Vitest coverage JSON summary and compares each per-package glob
 * threshold in `vitest.config.ts` against the actual coverage. If actual
 * coverage exceeds the configured floor, updates the floor in-place so
 * thresholds only ever go up, never down.
 *
 * Usage:
 *   npx tsx scripts/ratchet-coverage.ts          # dry-run (report only)
 *   npx tsx scripts/ratchet-coverage.ts --write   # apply updates to vitest.config.ts
 *
 * Prerequisites: run `npx vitest run --coverage` first so that
 * `coverage/coverage-summary.json` exists.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const COVERAGE_SUMMARY = resolve(ROOT, 'coverage/coverage-summary.json');
const VITEST_CONFIG = resolve(ROOT, 'vitest.config.ts');

/**
 * Per-package globs used in vitest.config.ts thresholds.
 * Order matters: more specific globs must come first to avoid double-counting.
 */
const PACKAGE_GLOBS: readonly string[] = [
  'apps/desktop-main/src/**/*.{ts,tsx}',
  'apps/desktop-renderer/src/**/*.{ts,tsx}',
  'packages/contracts/src/**/*.{ts,tsx}',
  'packages/contracts-parse/src/**/*.{ts,tsx}',
  'packages/shared-utils/src/**/*.{ts,tsx}',
  'packages/application/src/**/*.{ts,tsx}',
  'packages/adapters-ai/src/**/*.{ts,tsx}',
  'packages/domain/src/**/*.{ts,tsx}',
  'packages/storage/src/**/*.{ts,tsx}',
  'packages/media-engine/src/**/*.{ts,tsx}',
] as const;

type MetricKey = 'lines' | 'statements' | 'branches' | 'functions';
const METRIC_KEYS: readonly MetricKey[] = ['lines', 'statements', 'branches', 'functions'];

interface CoverageMetric {
  total: number;
  covered: number;
  skipped: number;
  pct: number;
}

interface CoverageSummaryEntry {
  lines: CoverageMetric;
  statements: CoverageMetric;
  branches: CoverageMetric;
  functions: CoverageMetric;
}

type CoverageSummary = Record<string, CoverageSummaryEntry>;

/**
 * Map a glob prefix like `apps/desktop-main/src/` to the directory prefix
 * used in the coverage-summary.json keys (which are absolute paths).
 */
function globToPrefix(glob: string): string {
  // Strip the trailing glob part: `**/*.{ts,tsx}`
  const prefix = glob.replace(/\*\*\/\*\.\{ts,tsx\}$/, '');
  return resolve(ROOT, prefix);
}

/**
 * Aggregate coverage across all files matching a package prefix.
 */
function aggregatePackageCoverage(
  summary: CoverageSummary,
  prefix: string,
): Record<MetricKey, number> | null {
  const totals: Record<MetricKey, { total: number; covered: number }> = {
    lines: { total: 0, covered: 0 },
    statements: { total: 0, covered: 0 },
    branches: { total: 0, covered: 0 },
    functions: { total: 0, covered: 0 },
  };

  let matched = 0;
  const normalizedPrefix = prefix.replaceAll('\\', '/');

  for (const [filePath, entry] of Object.entries(summary)) {
    if (filePath === 'total') continue;
    const normalizedFile = filePath.replaceAll('\\', '/');
    if (!normalizedFile.startsWith(normalizedPrefix)) continue;

    matched++;
    for (const key of METRIC_KEYS) {
      totals[key].total += entry[key].total;
      totals[key].covered += entry[key].covered;
    }
  }

  if (matched === 0) return null;

  const result: Record<string, number> = {};
  for (const key of METRIC_KEYS) {
    result[key] =
      totals[key].total > 0 ? Math.floor((totals[key].covered / totals[key].total) * 100) : 0;
  }
  return result as Record<MetricKey, number>;
}

interface RatchetUpdate {
  glob: string;
  metric: MetricKey;
  oldThreshold: number;
  newThreshold: number;
}

async function main(): Promise<void> {
  const dryRun = !process.argv.includes('--write');

  // --- Read coverage summary ---
  let summaryRaw: string;
  try {
    summaryRaw = await readFile(COVERAGE_SUMMARY, 'utf-8');
  } catch {
    console.error(
      'ratchet-coverage: coverage/coverage-summary.json not found.\n' +
        'Run `npx vitest run --coverage` first.',
    );
    process.exitCode = 1;
    return;
  }

  const summary: CoverageSummary = JSON.parse(summaryRaw);

  // --- Read current vitest config ---
  const configRaw = await readFile(VITEST_CONFIG, 'utf-8');

  // --- Calculate actual coverage per package and determine updates ---
  const updates: RatchetUpdate[] = [];

  console.log('Package coverage summary:\n');
  for (const glob of PACKAGE_GLOBS) {
    const prefix = globToPrefix(glob);
    const actual = aggregatePackageCoverage(summary, prefix);

    if (!actual) {
      console.log(`  ${glob}: (no files found in coverage report)`);
      continue;
    }

    console.log(`  ${glob}:`);
    for (const key of METRIC_KEYS) {
      const actualPct = actual[key];
      // Parse current threshold from config by finding the glob section
      const currentThreshold = parseThresholdFromConfig(configRaw, glob, key);
      const marker = actualPct > currentThreshold ? ' [RATCHET]' : '';
      console.log(`    ${key}: ${actualPct}% (threshold: ${currentThreshold}%)${marker}`);

      if (actualPct > currentThreshold) {
        updates.push({
          glob,
          metric: key,
          oldThreshold: currentThreshold,
          newThreshold: actualPct,
        });
      }
    }
    console.log('');
  }

  if (updates.length === 0) {
    console.log('ratchet-coverage: all thresholds are up to date. No updates needed.');
    return;
  }

  console.log(`\nFound ${updates.length} threshold(s) to ratchet up.`);

  if (dryRun) {
    console.log('\nDry run — pass --write to apply changes to vitest.config.ts');
    for (const u of updates) {
      console.log(`  ${u.glob} ${u.metric}: ${u.oldThreshold} -> ${u.newThreshold}`);
    }
    return;
  }

  // --- Apply updates to config file ---
  let updatedConfig = configRaw;
  for (const u of updates) {
    updatedConfig = applyThresholdUpdate(updatedConfig, u.glob, u.metric, u.newThreshold);
  }

  await writeFile(VITEST_CONFIG, updatedConfig, 'utf-8');
  console.log('\nvitest.config.ts updated successfully.');
  for (const u of updates) {
    console.log(`  ${u.glob} ${u.metric}: ${u.oldThreshold} -> ${u.newThreshold}`);
  }
}

/**
 * Parse a specific threshold value from the vitest config text.
 * Looks for the glob string in the config, then finds the metric line nearby.
 */
function parseThresholdFromConfig(configText: string, glob: string, metric: MetricKey): number {
  const escapedGlob = glob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match the glob key and then look for the metric within the next ~10 lines
  const globPattern = new RegExp(`['"]${escapedGlob}['"]\\s*:\\s*\\{([^}]+)\\}`, 's');
  const globMatch = configText.match(globPattern);
  if (!globMatch) return 0;

  const block = globMatch[1];
  const metricPattern = new RegExp(`${metric}\\s*:\\s*(\\d+)`);
  const metricMatch = block.match(metricPattern);
  return metricMatch ? parseInt(metricMatch[1], 10) : 0;
}

/**
 * Replace a threshold value in the config file text for a given glob + metric.
 */
function applyThresholdUpdate(
  configText: string,
  glob: string,
  metric: MetricKey,
  newValue: number,
): string {
  const escapedGlob = glob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Find the glob block
  const globPattern = new RegExp(`('${escapedGlob}'\\s*:\\s*\\{)([^}]+)(\\})`, 's');
  const globMatch = configText.match(globPattern);
  if (!globMatch) return configText;

  const block = globMatch[2];
  const metricPattern = new RegExp(`(${metric}\\s*:\\s*)\\d+`);
  const updatedBlock = block.replace(metricPattern, `$1${newValue}`);

  return configText.replace(globPattern, `$1${updatedBlock}$3`);
}

main().catch((err) => {
  console.error('ratchet-coverage: crashed', err);
  process.exit(2);
});
