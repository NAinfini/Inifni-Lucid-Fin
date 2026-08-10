const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const EXPECTED_VERSION = '0.145.0';

const targets = {
  'win32-x64': ['@openai/codex-win32-x64', 'x86_64-pc-windows-msvc', 'codex.exe'],
  'win32-arm64': ['@openai/codex-win32-arm64', 'aarch64-pc-windows-msvc', 'codex.exe'],
  'darwin-x64': ['@openai/codex-darwin-x64', 'x86_64-apple-darwin', 'codex'],
  'darwin-arm64': ['@openai/codex-darwin-arm64', 'aarch64-apple-darwin', 'codex'],
  'linux-x64': ['@openai/codex-linux-x64', 'x86_64-unknown-linux-musl', 'codex'],
  'linux-arm64': ['@openai/codex-linux-arm64', 'aarch64-unknown-linux-musl', 'codex'],
};

function normalizeArch(value) {
  if (typeof value === 'string') return value;
  return { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }[value];
}

/** @param {import('electron-builder').AfterPackContext} context */
module.exports = async function verifyCodexBinary(context) {
  const platform = context.electronPlatformName;
  const arch = normalizeArch(context.arch);
  const target = targets[`${platform}-${arch}`];
  if (!target) {
    throw new Error(`Unsupported Codex package target: ${platform}-${String(arch)}`);
  }

  const [packageName, triple, executable] = target;
  const binaryPath = path.join(
    context.appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    ...packageName.split('/'),
    'vendor',
    triple,
    'bin',
    executable,
  );
  const stat = fs.statSync(binaryPath);
  if (!stat.isFile()) throw new Error(`Bundled Codex binary is not a file: ${binaryPath}`);

  const output = execFileSync(binaryPath, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  }).trim();
  if (!new RegExp(`\\b${EXPECTED_VERSION.replaceAll('.', '\\.')}\\b`).test(output)) {
    throw new Error(`Bundled Codex version mismatch: expected ${EXPECTED_VERSION}, received ${output}`);
  }
};
