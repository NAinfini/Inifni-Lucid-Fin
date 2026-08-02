/**
 * Dependency license audit script.
 *
 * Scans all production dependencies for GPL, AGPL, LGPL, or unlicensed
 * packages that could create legal risk when distributing the Electron app.
 *
 * Usage:
 *   npx tsx scripts/license-audit.ts          # Run audit, write report
 *   npx tsx scripts/license-audit.ts --json   # Print report to stdout as JSON
 *   npx tsx scripts/license-audit.ts --ci     # Exit non-zero if flagged deps found
 *
 * Output:
 *   license-audit-report.json  (written to repo root unless --json)
 *
 * Distribution boundary:
 *   "production" = dependencies of @lucid-fin/desktop-main (bundled in asar)
 *   "renderer"   = dependencies of @lucid-fin/desktop-renderer (bundled by Vite)
 *   "dev-only"   = devDependencies across all workspaces (not shipped)
 *
 * CI integration:
 *   Add to your CI pipeline:
 *     npx tsx scripts/license-audit.ts --ci
 *   This will fail the build if any flagged licenses are found in production deps.
 *
 * DISCLAIMER: This tool is provided for informational purposes only and does
 * not constitute legal advice. Consult a qualified attorney for licensing
 * compliance decisions.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');

/** License SPDX identifiers (or substrings) considered restrictive / copyleft. */
const FLAGGED_LICENSE_PATTERNS: readonly string[] = [
  'GPL',
  'AGPL',
  'LGPL',
  'SSPL',
  'EUPL',
  'OSL',
  'CPAL',
  'CPL',
  'EPL',
  'CECILL',
];

/** Exact SPDX IDs that are safe even though they contain a flagged substring. */
const SAFE_OVERRIDES: ReadonlySet<string> = new Set([
  // LGPL with linking exception is generally safe for dynamic linking but
  // we still flag it for manual review. Add overrides here if confirmed safe.
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DepEntry {
  name: string;
  version: string;
  license: string;
  repository: string;
  boundary: 'production' | 'renderer' | 'dev-only';
  flagged: boolean;
  flagReason: string | null;
}

interface AuditReport {
  generatedAt: string;
  lastVerified: string;
  disclaimer: string;
  summary: {
    totalScanned: number;
    production: number;
    renderer: number;
    devOnly: number;
    flagged: number;
    clean: number;
  };
  flaggedDependencies: DepEntry[];
  allDependencies: DepEntry[];
}

interface NpmLsDep {
  version?: string;
  resolved?: string;
  dependencies?: Record<string, NpmLsDep>;
}

interface NpmLsOutput {
  dependencies?: Record<string, NpmLsDep>;
}

interface PackageJsonLicense {
  license?: string | { type?: string };
  licenses?: Array<{ type?: string }>;
  repository?: string | { url?: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a command and return stdout, or null on failure. */
function run(cmd: string): string | null {
  try {
    return execSync(cmd, {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: 120_000,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024, // 50 MB — dependency trees can be large
    });
  } catch {
    return null;
  }
}

/** Collect all package names (flattened) from an npm ls --json output. */
function collectDeps(node: NpmLsOutput | NpmLsDep, out: Map<string, string>): void {
  const deps = node.dependencies;
  if (!deps) return;
  for (const [name, info] of Object.entries(deps)) {
    if (info.version && !out.has(name)) {
      out.set(name, info.version);
    }
    collectDeps(info, out);
  }
}

/** Attempt to resolve the installed location of a package in the monorepo. */
function findPackageJson(pkgName: string): string | null {
  // In npm workspaces, packages are hoisted to root node_modules
  const rootPath = join(REPO_ROOT, 'node_modules', pkgName, 'package.json');
  if (existsSync(rootPath)) return rootPath;

  // Scoped packages nested in .pnpm (pnpm-style, just in case)
  // Not expected in this project but defensive
  return null;
}

/** Extract license string from a package.json object. */
function extractLicense(pkg: PackageJsonLicense): string {
  if (typeof pkg.license === 'string') return pkg.license;
  if (typeof pkg.license === 'object' && pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
    return pkg.licenses.map((l) => l.type ?? 'UNKNOWN').join(' OR ');
  }
  return 'UNLICENSED';
}

/** Extract repository URL from a package.json object. */
function extractRepo(pkg: PackageJsonLicense): string {
  if (typeof pkg.repository === 'string') return pkg.repository;
  if (typeof pkg.repository === 'object' && pkg.repository?.url) {
    return pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
  }
  return '';
}

/** Check if a license string is flagged. */
function checkLicense(license: string): { flagged: boolean; reason: string | null } {
  const upper = license.toUpperCase();

  if (upper === 'UNLICENSED' || upper === 'UNKNOWN' || upper === '') {
    return { flagged: true, reason: 'No license declared' };
  }

  if (SAFE_OVERRIDES.has(license)) {
    return { flagged: false, reason: null };
  }

  for (const pattern of FLAGGED_LICENSE_PATTERNS) {
    if (upper.includes(pattern)) {
      return { flagged: true, reason: `Copyleft license detected: ${license}` };
    }
  }

  return { flagged: false, reason: null };
}

// ---------------------------------------------------------------------------
// Dep collection per boundary
// ---------------------------------------------------------------------------

/** Parse JSON from potentially noisy npm output (warnings before JSON). */
function parseNpmJson(raw: string): NpmLsOutput | null {
  try {
    return JSON.parse(raw) as NpmLsOutput;
  } catch {
    const jsonStart = raw.indexOf('{');
    if (jsonStart >= 0) {
      try {
        return JSON.parse(raw.slice(jsonStart)) as NpmLsOutput;
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Read a workspace's package.json to get its direct production dependencies,
 * then resolve each from node_modules. This is more reliable than npm ls in
 * hoisted monorepos where workspace filtering can miss deps.
 */
function getWorkspaceProdDepsFromPackageJson(workspacePath: string): Map<string, string> {
  const out = new Map<string, string>();
  const pkgPath = join(REPO_ROOT, workspacePath, 'package.json');
  if (!existsSync(pkgPath)) return out;

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
    dependencies?: Record<string, string>;
  };

  if (!pkg.dependencies) return out;

  // For each declared dependency, resolve its actual version from node_modules
  for (const depName of Object.keys(pkg.dependencies)) {
    if (INTERNAL_PACKAGES.has(depName)) continue;
    const depPkgPath = findPackageJson(depName);
    if (depPkgPath) {
      try {
        const depPkg = JSON.parse(readFileSync(depPkgPath, 'utf-8')) as {
          version?: string;
          dependencies?: Record<string, string>;
        };
        out.set(depName, depPkg.version ?? 'unknown');

        // Recursively resolve transitive deps from the installed package
        resolveTransitiveDeps(depPkg.dependencies, out);
      } catch {
        out.set(depName, 'unknown');
      }
    }
  }
  return out;
}

/** Recursively resolve transitive dependencies from installed package.json files. */
function resolveTransitiveDeps(
  deps: Record<string, string> | undefined,
  out: Map<string, string>,
): void {
  if (!deps) return;
  for (const depName of Object.keys(deps)) {
    if (INTERNAL_PACKAGES.has(depName)) continue;
    if (out.has(depName)) continue; // Already resolved, avoid cycles

    const depPkgPath = findPackageJson(depName);
    if (depPkgPath) {
      try {
        const depPkg = JSON.parse(readFileSync(depPkgPath, 'utf-8')) as {
          version?: string;
          dependencies?: Record<string, string>;
        };
        out.set(depName, depPkg.version ?? 'unknown');
        resolveTransitiveDeps(depPkg.dependencies, out);
      } catch {
        out.set(depName, 'unknown');
      }
    }
  }
}

/** Get production deps for a workspace using npm ls, with fallback. */
function getWorkspaceProdDeps(workspace: string): Map<string, string> {
  const out = new Map<string, string>();
  const raw = run(`npm ls --json --omit=dev --workspace=${workspace} --all`);
  if (raw) {
    const parsed = parseNpmJson(raw);
    if (parsed) collectDeps(parsed, out);
  }

  // If npm ls returned few results, augment with direct package.json reading.
  // This handles the hoisted-monorepo case where npm ls misses deps.
  const fromPkg = getWorkspaceProdDepsFromPackageJson(workspace);
  for (const [name, ver] of fromPkg) {
    if (!out.has(name)) out.set(name, ver);
  }

  return out;
}

/** Get all deps (including dev) for computing the dev-only set. */
function getWorkspaceAllDeps(workspace: string): Map<string, string> {
  const out = new Map<string, string>();
  const raw = run(`npm ls --json --workspace=${workspace} --all`);
  if (raw) {
    const parsed = parseNpmJson(raw);
    if (parsed) collectDeps(parsed, out);
  }

  // Augment with package.json reading for both deps and devDeps
  const pkgPath = join(REPO_ROOT, workspace, 'package.json');
  if (existsSync(pkgPath)) {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const allDeclared = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    for (const depName of Object.keys(allDeclared)) {
      if (INTERNAL_PACKAGES.has(depName)) continue;
      if (out.has(depName)) continue;
      const depPkgPath = findPackageJson(depName);
      if (depPkgPath) {
        try {
          const depPkg = JSON.parse(readFileSync(depPkgPath, 'utf-8')) as { version?: string };
          out.set(depName, depPkg.version ?? 'unknown');
        } catch {
          out.set(depName, 'unknown');
        }
      }
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// Internal workspace packages (not distributed as npm packages)
// ---------------------------------------------------------------------------

const INTERNAL_PACKAGES = new Set([
  '@lucid-fin/adapters-ai',
  '@lucid-fin/application',
  '@lucid-fin/contracts',
  '@lucid-fin/contracts-parse',
  '@lucid-fin/desktop-main',
  '@lucid-fin/desktop-renderer',
  '@lucid-fin/domain',
  '@lucid-fin/media-engine',
  '@lucid-fin/shared-utils',
  '@lucid-fin/storage',
]);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const jsonMode = process.argv.includes('--json');
  const ciMode = process.argv.includes('--ci');

  if (!jsonMode) {
    console.log('Lucid Fin -- Dependency License Audit\n');
    console.log('Scanning production dependencies for desktop-main...');
  }

  // 1. Collect production deps for Electron main process (bundled in asar)
  const mainProdDeps = getWorkspaceProdDeps('apps/desktop-main');

  if (!jsonMode) {
    console.log(`  desktop-main production deps: ${mainProdDeps.size}`);
    console.log('Scanning production dependencies for desktop-renderer...');
  }

  // 2. Collect production deps for renderer (bundled by Vite into renderer)
  const rendererProdDeps = getWorkspaceProdDeps('apps/desktop-renderer');

  if (!jsonMode) {
    console.log(`  desktop-renderer production deps: ${rendererProdDeps.size}`);
    console.log('Scanning all dependencies for dev-only classification...');
  }

  // 3. Collect all deps across both workspaces to find dev-only
  const mainAllDeps = getWorkspaceAllDeps('apps/desktop-main');
  const rendererAllDeps = getWorkspaceAllDeps('apps/desktop-renderer');

  // Merge all deps
  const allDeps = new Map<string, string>();
  for (const [name, ver] of mainAllDeps) allDeps.set(name, ver);
  for (const [name, ver] of rendererAllDeps) allDeps.set(name, ver);
  // Also include root devDeps that won't show in workspace ls
  const rootPkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
    devDependencies?: Record<string, string>;
  };
  if (rootPkg.devDependencies) {
    for (const name of Object.keys(rootPkg.devDependencies)) {
      if (!allDeps.has(name)) {
        const pkgJsonPath = findPackageJson(name);
        if (pkgJsonPath) {
          const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as { version?: string };
          allDeps.set(name, pkg.version ?? 'unknown');
        }
      }
    }
  }

  if (!jsonMode) {
    console.log(`  total unique deps: ${allDeps.size}`);
    console.log('\nAnalyzing licenses...\n');
  }

  // 4. Build entries
  const entries: DepEntry[] = [];

  for (const [name, version] of allDeps) {
    // Skip internal workspace packages
    if (INTERNAL_PACKAGES.has(name)) continue;

    const pkgJsonPath = findPackageJson(name);
    let license: string;
    let repository = '';

    if (pkgJsonPath) {
      try {
        const pkg: PackageJsonLicense = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
        license = extractLicense(pkg);
        repository = extractRepo(pkg);
      } catch {
        license = 'PARSE_ERROR';
      }
    } else {
      license = 'NOT_FOUND';
    }

    // Determine boundary
    let boundary: DepEntry['boundary'];
    if (mainProdDeps.has(name)) {
      boundary = 'production';
    } else if (rendererProdDeps.has(name)) {
      boundary = 'renderer';
    } else {
      boundary = 'dev-only';
    }

    const { flagged, reason } = checkLicense(license);

    entries.push({
      name,
      version,
      license,
      repository,
      boundary,
      flagged,
      flagReason: reason,
    });
  }

  // Sort: flagged first, then by boundary (production > renderer > dev-only), then name
  const boundaryOrder: Record<string, number> = { production: 0, renderer: 1, 'dev-only': 2 };
  entries.sort((a, b) => {
    if (a.flagged !== b.flagged) return a.flagged ? -1 : 1;
    const bo = (boundaryOrder[a.boundary] ?? 9) - (boundaryOrder[b.boundary] ?? 9);
    if (bo !== 0) return bo;
    return a.name.localeCompare(b.name);
  });

  const flagged = entries.filter((e) => e.flagged);
  const productionCount = entries.filter((e) => e.boundary === 'production').length;
  const rendererCount = entries.filter((e) => e.boundary === 'renderer').length;
  const devOnlyCount = entries.filter((e) => e.boundary === 'dev-only').length;

  // 5. Build report
  const now = new Date().toISOString();
  const report: AuditReport = {
    generatedAt: now,
    lastVerified: now.split('T')[0],
    disclaimer:
      'This report is generated automatically for informational purposes only. ' +
      'It does not constitute legal advice. Consult a qualified attorney for ' +
      'licensing compliance decisions before distributing this software.',
    summary: {
      totalScanned: entries.length,
      production: productionCount,
      renderer: rendererCount,
      devOnly: devOnlyCount,
      flagged: flagged.length,
      clean: entries.length - flagged.length,
    },
    flaggedDependencies: flagged,
    allDependencies: entries,
  };

  // 6. Output
  const reportJson = JSON.stringify(report, null, 2);

  if (jsonMode) {
    console.log(reportJson);
  } else {
    const reportPath = join(REPO_ROOT, 'license-audit-report.json');
    writeFileSync(reportPath, reportJson + '\n', 'utf-8');
    console.log(`Report written to: license-audit-report.json\n`);

    // Print summary
    console.log('  Summary');
    console.log('  -------');
    console.log(`  Total scanned:   ${report.summary.totalScanned}`);
    console.log(`  Production:      ${report.summary.production} (bundled in Electron asar)`);
    console.log(`  Renderer:        ${report.summary.renderer} (bundled by Vite)`);
    console.log(`  Dev-only:        ${report.summary.devOnly} (not shipped)`);
    console.log(`  Flagged:         ${report.summary.flagged}`);
    console.log(`  Clean:           ${report.summary.clean}`);
    console.log('');

    if (flagged.length > 0) {
      console.log('  Flagged Dependencies');
      console.log('  --------------------');
      for (const dep of flagged) {
        const tag = dep.boundary === 'dev-only' ? ' [dev-only]' : ` [${dep.boundary}]`;
        console.log(`  [FLAG] ${dep.name}@${dep.version} — ${dep.license}${tag}`);
        if (dep.flagReason) {
          console.log(`         Reason: ${dep.flagReason}`);
        }
      }
      console.log('');

      const prodFlagged = flagged.filter((d) => d.boundary !== 'dev-only');
      if (prodFlagged.length > 0) {
        console.log(
          `  WARNING: ${prodFlagged.length} flagged package(s) are in the distribution boundary.`,
        );
        console.log('  Review these before releasing.\n');
      } else {
        console.log('  All flagged packages are dev-only (not shipped). Distribution is clean.\n');
      }
    } else {
      console.log('  No flagged licenses found. All clear.\n');
    }

    console.log(`  Last verified: ${report.lastVerified}`);
    console.log('  Disclaimer: This is not legal advice.\n');
  }

  // 7. CI exit code
  if (ciMode) {
    const prodFlagged = flagged.filter((d) => d.boundary !== 'dev-only');
    if (prodFlagged.length > 0) {
      console.error(
        `\nCI FAIL: ${prodFlagged.length} production/renderer dependency(ies) have flagged licenses.`,
      );
      process.exitCode = 1;
    }
  }
}

main().catch((err: unknown) => {
  console.error('license-audit: crashed', err);
  process.exitCode = 1;
});
