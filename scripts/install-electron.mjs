import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const electronRoot = resolve(repoRoot, 'node_modules', 'electron');
const distPath = resolve(electronRoot, 'dist');
const pathFile = resolve(electronRoot, 'path.txt');
const installScript = resolve(electronRoot, 'install.js');

function assertInsideElectronRoot(target) {
  const candidate = relative(electronRoot, target);
  if (candidate === '' || candidate.startsWith('..') || isAbsolute(candidate)) {
    throw new Error(`Refusing to modify path outside Electron package: ${target}`);
  }
}

function installedBinary() {
  if (!existsSync(pathFile)) return undefined;
  const executable = readFileSync(pathFile, 'utf8').trim();
  if (!executable) return undefined;
  const binary = resolve(distPath, executable);
  return existsSync(binary) ? binary : undefined;
}

if (!existsSync(installScript)) {
  throw new Error(`Electron installer is missing: ${installScript}`);
}

const existingBinary = installedBinary();
if (existingBinary) {
  console.log(`Electron binary ready: ${relative(repoRoot, existingBinary)}`);
  process.exit(0);
}

assertInsideElectronRoot(distPath);
assertInsideElectronRoot(pathFile);
rmSync(distPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
rmSync(pathFile, { force: true });

const result = spawnSync(process.execPath, [installScript], {
  cwd: repoRoot,
  env: process.env,
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0 && process.platform !== 'win32') {
  throw new Error(`Electron installer exited with status ${result.status ?? 'unknown'}`);
}

if (result.status !== 0) {
  console.warn(
    'Electron extractor failed on Windows; retrying the verified archive with Expand-Archive.',
  );
  const { downloadArtifact } = require('@electron/get');
  const { version } = require('../node_modules/electron/package.json');
  const checksums = require('../node_modules/electron/checksums.json');
  const zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform:
      process.env.ELECTRON_INSTALL_PLATFORM || process.env.npm_config_platform || process.platform,
    arch: process.env.ELECTRON_INSTALL_ARCH || process.env.npm_config_arch || process.arch,
    cacheRoot: process.env.electron_config_cache,
    checksums,
  });

  assertInsideElectronRoot(distPath);
  rmSync(distPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  mkdirSync(distPath, { recursive: true });

  const powershell = resolve(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const fallback = spawnSync(
    powershell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      "$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath $env:LUCID_FIN_ELECTRON_ZIP -DestinationPath $env:LUCID_FIN_ELECTRON_DIST -Force",
    ],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        LUCID_FIN_ELECTRON_ZIP: zipPath,
        LUCID_FIN_ELECTRON_DIST: distPath,
      },
      stdio: 'inherit',
    },
  );
  if (fallback.error) throw fallback.error;
  if (fallback.status !== 0) {
    throw new Error(
      `Electron Windows fallback extractor exited with status ${fallback.status ?? 'unknown'}`,
    );
  }
  writeFileSync(pathFile, 'electron.exe');
}

const binary = installedBinary();
if (!binary) {
  throw new Error('Electron installer completed without producing a usable binary');
}

console.log(`Electron binary installed: ${relative(repoRoot, binary)}`);
