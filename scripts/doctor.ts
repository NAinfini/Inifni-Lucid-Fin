/**
 * Development environment diagnostic script.
 *
 * Checks that the local dev environment has all required tools and
 * configurations for working on Lucid Fin.
 *
 * Usage:
 *   pnpm exec tsx scripts/doctor.ts          # Run all checks
 *   pnpm exec tsx scripts/doctor.ts --json   # Output results as JSON
 *
 * Checks performed:
 *   - Node.js version (>= engines.node from package.json)
 *   - pnpm version
 *   - Git is installed
 *   - FFmpeg availability (bundled path + system PATH)
 *   - pnpm workspaces linked correctly
 *   - TypeScript compiles (pnpm exec tsc --noEmit)
 *   - Platform-specific checks (long paths on Windows, Xcode CLT on macOS)
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');

interface PackageJson {
  engines?: { node?: string; pnpm?: string };
  packageManager?: string;
}

const PKG: PackageJson = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8'));

const REQUIRED_NODE_VERSION = PKG.engines?.node ?? '>=26.5.1';
const REQUIRED_PNPM_VERSION = PKG.packageManager?.replace(/^pnpm@/, '') ?? '11.21.0';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  fix?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run a command and return trimmed stdout, or null on failure. */
function run(cmd: string): string | null {
  try {
    return execSync(cmd, {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      timeout: 60_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/** Parse a semver-ish string like "v26.5.1" into [major, minor, patch]. */
function parseSemver(raw: string): [number, number, number] | null {
  const m = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Check if `actual` >= `required` using semver comparison. */
function semverGte(actual: [number, number, number], required: [number, number, number]): boolean {
  for (let i = 0; i < 3; i++) {
    if (actual[i] > required[i]) return true;
    if (actual[i] < required[i]) return false;
  }
  return true; // equal
}

/** Extract the minimum version from an engines constraint like ">=26.5.1". */
function parseMinVersion(constraint: string): [number, number, number] | null {
  const m = constraint.match(/>=?\s*(\d+\.\d+\.\d+)/);
  if (!m) return null;
  return parseSemver(m[1]);
}

// ---------------------------------------------------------------------------
// Individual Checks
// ---------------------------------------------------------------------------

function checkNodeVersion(): CheckResult {
  const raw = run('node --version');
  if (!raw) {
    return {
      name: 'Node.js',
      status: 'fail',
      message: 'Node.js not found in PATH',
      fix: `Install Node.js ${REQUIRED_NODE_VERSION} from https://nodejs.org`,
    };
  }

  const actual = parseSemver(raw);
  const required = parseMinVersion(REQUIRED_NODE_VERSION);

  if (!actual) {
    return {
      name: 'Node.js',
      status: 'warn',
      message: `Could not parse Node.js version: ${raw}`,
    };
  }

  if (!required) {
    return {
      name: 'Node.js',
      status: 'pass',
      message: `Node.js ${raw} (could not parse required version constraint "${REQUIRED_NODE_VERSION}", skipping comparison)`,
    };
  }

  if (!semverGte(actual, required)) {
    return {
      name: 'Node.js',
      status: 'fail',
      message: `Node.js ${raw} is below required ${REQUIRED_NODE_VERSION}`,
      fix: `Upgrade Node.js to ${REQUIRED_NODE_VERSION} — https://nodejs.org`,
    };
  }

  return {
    name: 'Node.js',
    status: 'pass',
    message: `Node.js ${raw} (requires ${REQUIRED_NODE_VERSION})`,
  };
}

function checkPnpm(): CheckResult {
  const raw = run('pnpm --version');
  if (!raw) {
    return {
      name: 'pnpm',
      status: 'fail',
      message: 'pnpm not found in PATH',
      fix: `Install pnpm ${REQUIRED_PNPM_VERSION} from https://pnpm.io/installation`,
    };
  }

  if (raw !== REQUIRED_PNPM_VERSION) {
    return {
      name: 'pnpm',
      status: 'fail',
      message: `pnpm ${raw} does not match packageManager pnpm@${REQUIRED_PNPM_VERSION}`,
      fix: `Install pnpm ${REQUIRED_PNPM_VERSION}`,
    };
  }

  return { name: 'pnpm', status: 'pass', message: `pnpm ${raw}` };
}

function checkGit(): CheckResult {
  const raw = run('git --version');
  if (!raw) {
    return {
      name: 'Git',
      status: 'fail',
      message: 'Git not found in PATH',
      fix: 'Install Git from https://git-scm.com',
    };
  }
  return { name: 'Git', status: 'pass', message: raw };
}

function checkFfmpeg(): CheckResult {
  const platform = `${process.platform}-${process.arch}`;
  const bundledDir = join(REPO_ROOT, 'resources', 'bin', platform);
  const ext = process.platform === 'win32' ? '.exe' : '';
  const bundledPath = join(bundledDir, `ffmpeg${ext}`);

  const hasBundled = existsSync(bundledPath);
  const systemVersion = run('ffmpeg -version');
  const hasSystem = systemVersion !== null;

  if (hasBundled && hasSystem) {
    const firstLine = systemVersion.split('\n')[0];
    return {
      name: 'FFmpeg',
      status: 'pass',
      message: `Bundled: ${bundledPath} | System: ${firstLine}`,
    };
  }
  if (hasBundled) {
    return {
      name: 'FFmpeg',
      status: 'pass',
      message: `Bundled: ${bundledPath} (not in system PATH — OK for production)`,
    };
  }
  if (hasSystem) {
    const firstLine = systemVersion.split('\n')[0];
    return {
      name: 'FFmpeg',
      status: 'warn',
      message: `System: ${firstLine} (bundled binary not found at ${bundledPath})`,
      fix: `Run "pnpm exec tsx scripts/fetch-ffmpeg.ts" to download bundled FFmpeg`,
    };
  }

  return {
    name: 'FFmpeg',
    status: 'warn',
    message: 'FFmpeg not found (bundled or system PATH)',
    fix: `Run "pnpm exec tsx scripts/fetch-ffmpeg.ts" to download, or install FFmpeg system-wide`,
  };
}

function checkWorkspaces(): CheckResult {
  const output = run('pnpm --recursive list --depth=-1 --json');
  if (output === null) {
    return {
      name: 'Workspaces',
      status: 'fail',
      message: 'pnpm list failed — workspaces may not be linked correctly',
      fix: 'Run "pnpm install" from the repo root to link workspaces',
    };
  }

  try {
    const workspaces = JSON.parse(output) as unknown[];
    if (!Array.isArray(workspaces) || workspaces.length === 0) throw new Error('empty workspace');
    return {
      name: 'Workspaces',
      status: 'pass',
      message: `${workspaces.length} pnpm workspace packages linked`,
    };
  } catch {
    return {
      name: 'Workspaces',
      status: 'fail',
      message: 'pnpm list returned an invalid workspace graph',
      fix: 'Run "pnpm install" from the repo root to relink workspaces',
    };
  }
}

function checkTypeScript(): CheckResult {
  // Run tsc --noEmit in each workspace that has a tsconfig.json.
  // We use the root-level approach: just verify that each workspace compiles.
  const workspaceDirs = [
    'apps/desktop-main',
    'apps/desktop-renderer',
    'packages/contracts',
    'packages/contracts-parse',
    'packages/shared-utils',
    'packages/application',
    'packages/adapters-ai',
    'packages/domain',
    'packages/storage',
    'packages/media-engine',
    'packages/task-execution',
    'packages/agent',
  ];

  const failures: string[] = [];

  for (const ws of workspaceDirs) {
    const tsconfig = join(REPO_ROOT, ws, 'tsconfig.json');
    if (!existsSync(tsconfig)) continue;

    const result = run(`pnpm exec tsc --noEmit --project "${tsconfig}"`);
    if (result === null) {
      failures.push(ws);
    }
  }

  if (failures.length > 0) {
    return {
      name: 'TypeScript',
      status: 'fail',
      message: `tsc --noEmit failed in: ${failures.join(', ')}`,
      fix: 'Fix type errors in the listed workspaces',
    };
  }

  return {
    name: 'TypeScript',
    status: 'pass',
    message: 'All workspaces compile without errors',
  };
}

// ---------------------------------------------------------------------------
// Platform-Specific Checks
// ---------------------------------------------------------------------------

function checkWindowsLongPaths(): CheckResult {
  if (process.platform !== 'win32') {
    return { name: 'Win Long Paths', status: 'skip', message: 'Not Windows' };
  }

  // Check registry for LongPathsEnabled
  const regOutput = run(
    'reg query "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled',
  );

  if (regOutput && /LongPathsEnabled\s+REG_DWORD\s+0x1/i.test(regOutput)) {
    return {
      name: 'Win Long Paths',
      status: 'pass',
      message: 'Long path support is enabled',
    };
  }

  return {
    name: 'Win Long Paths',
    status: 'warn',
    message: 'Long path support may not be enabled (node_modules can hit MAX_PATH)',
    fix: 'Run as admin: reg add "HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem" /v LongPathsEnabled /t REG_DWORD /d 1 /f',
  };
}

function checkWindowsBuildTools(): CheckResult {
  if (process.platform !== 'win32') {
    return { name: 'MSVC Build Tools', status: 'skip', message: 'Not Windows' };
  }

  // Check if node-gyp can find build tools by looking for cl.exe or msbuild
  const vsWhere = run(
    'cmd /c ""%ProgramFiles(x86)%\\Microsoft Visual Studio\\Installer\\vswhere.exe" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath"',
  );

  if (vsWhere) {
    return {
      name: 'MSVC Build Tools',
      status: 'pass',
      message: `Visual Studio Build Tools found: ${vsWhere}`,
    };
  }

  return {
    name: 'MSVC Build Tools',
    status: 'warn',
    message:
      'Visual Studio Build Tools not detected (needed for native modules like better-sqlite3)',
    fix: 'Install "Desktop development with C++" from https://visualstudio.microsoft.com/visual-cpp-build-tools/',
  };
}

function checkMacXcodeClT(): CheckResult {
  if (process.platform !== 'darwin') {
    return { name: 'Xcode CLT', status: 'skip', message: 'Not macOS' };
  }

  const result = run('xcode-select -p');
  if (result) {
    return {
      name: 'Xcode CLT',
      status: 'pass',
      message: `Xcode Command Line Tools: ${result}`,
    };
  }

  return {
    name: 'Xcode CLT',
    status: 'fail',
    message: 'Xcode Command Line Tools not installed',
    fix: 'Run: xcode-select --install',
  };
}

function checkLinuxBuildEssentials(): CheckResult {
  if (process.platform !== 'linux') {
    return { name: 'Linux Build Deps', status: 'skip', message: 'Not Linux' };
  }

  const hasMake = run('make --version') !== null;
  const hasGcc = run('gcc --version') !== null;
  const hasPython = run('python3 --version') !== null;

  const missing: string[] = [];
  if (!hasMake) missing.push('make');
  if (!hasGcc) missing.push('gcc');
  if (!hasPython) missing.push('python3');

  if (missing.length > 0) {
    return {
      name: 'Linux Build Deps',
      status: 'warn',
      message: `Missing build tools: ${missing.join(', ')}`,
      fix: 'Ubuntu/Debian: sudo apt install build-essential python3  |  Fedora: sudo dnf groupinstall "Development Tools"',
    };
  }

  return {
    name: 'Linux Build Deps',
    status: 'pass',
    message: 'make, gcc, python3 are available',
  };
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

const STATUS_ICONS: Record<CheckStatus, string> = {
  pass: '[PASS]',
  fail: '[FAIL]',
  warn: '[WARN]',
  skip: '[SKIP]',
};

function printResults(results: CheckResult[]): void {
  const maxName = Math.max(...results.map((r) => r.name.length));

  console.log('\n  Lucid Fin — Environment Diagnostic\n');

  for (const r of results) {
    const icon = STATUS_ICONS[r.status];
    const pad = ' '.repeat(maxName - r.name.length);
    console.log(`  ${icon} ${r.name}${pad}  ${r.message}`);
    if (r.fix) {
      console.log(`  ${''.padStart(6)}${''.padStart(maxName)}  Fix: ${r.fix}`);
    }
  }

  const fails = results.filter((r) => r.status === 'fail').length;
  const warns = results.filter((r) => r.status === 'warn').length;

  console.log('');
  if (fails > 0) {
    console.log(`  ${fails} check(s) FAILED — fix the issues above before developing.`);
  } else if (warns > 0) {
    console.log(`  All critical checks passed. ${warns} warning(s) — see above.`);
  } else {
    console.log('  All checks passed. Environment looks good!');
  }
  console.log('');
}

async function main(): Promise<void> {
  const jsonMode = process.argv.includes('--json');

  console.log('Running environment checks...\n');

  // Core checks
  const results: CheckResult[] = [
    checkNodeVersion(),
    checkPnpm(),
    checkGit(),
    checkFfmpeg(),
    checkWorkspaces(),
  ];

  // Platform-specific checks (only active platform runs, rest skip)
  results.push(checkWindowsLongPaths());
  results.push(checkWindowsBuildTools());
  results.push(checkMacXcodeClT());
  results.push(checkLinuxBuildEssentials());

  // TypeScript check (slower, run last)
  console.log('Checking TypeScript compilation (this may take a moment)...');
  results.push(checkTypeScript());

  // Filter out skipped checks for cleaner output (unless JSON mode)
  const displayResults = jsonMode ? results : results.filter((r) => r.status !== 'skip');

  if (jsonMode) {
    console.log(JSON.stringify(displayResults, null, 2));
  } else {
    printResults(displayResults);
  }

  // Exit code: 1 if any check failed
  if (results.some((r) => r.status === 'fail')) {
    process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error('doctor: crashed', err);
  process.exitCode = 1;
});
