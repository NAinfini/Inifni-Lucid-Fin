import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

export const CODEX_VERSION = '0.145.0';

interface PlatformBinary {
  packageName: string;
  targetTriple: string;
  executable: string;
}

const PLATFORM_BINARIES: Record<string, PlatformBinary> = {
  'darwin-arm64': {
    packageName: '@openai/codex-darwin-arm64',
    targetTriple: 'aarch64-apple-darwin',
    executable: 'codex',
  },
  'darwin-x64': {
    packageName: '@openai/codex-darwin-x64',
    targetTriple: 'x86_64-apple-darwin',
    executable: 'codex',
  },
  'linux-arm64': {
    packageName: '@openai/codex-linux-arm64',
    targetTriple: 'aarch64-unknown-linux-musl',
    executable: 'codex',
  },
  'linux-x64': {
    packageName: '@openai/codex-linux-x64',
    targetTriple: 'x86_64-unknown-linux-musl',
    executable: 'codex',
  },
  'win32-arm64': {
    packageName: '@openai/codex-win32-arm64',
    targetTriple: 'aarch64-pc-windows-msvc',
    executable: 'codex.exe',
  },
  'win32-x64': {
    packageName: '@openai/codex-win32-x64',
    targetTriple: 'x86_64-pc-windows-msvc',
    executable: 'codex.exe',
  },
};

export interface ResolveCodexBinaryOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  resolvePackageJson?: (specifier: string) => string;
  exists?: (filePath: string) => boolean;
  probe?: (filePath: string) => void;
}

/** Resolve the pinned native executable instead of spawning the JavaScript CLI wrapper. */
export function resolveCodexBinary(options: ResolveCodexBinaryOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const descriptor = PLATFORM_BINARIES[`${platform}-${arch}`];
  if (!descriptor) {
    throw new Error('Codex App Server is not available for this platform');
  }

  const require = createRequire(import.meta.url);
  const resolvePackageJson =
    options.resolvePackageJson ?? ((specifier: string) => require.resolve(specifier));
  const packageJsonPath = resolvePackageJson(`${descriptor.packageName}/package.json`);
  assertPinnedPlatformPackage(packageJsonPath);

  const packageRoot = path.dirname(packageJsonPath);
  const binaryPath = mapAsarToUnpacked(
    path.join(packageRoot, 'vendor', descriptor.targetTriple, 'bin', descriptor.executable),
  );
  if (!(options.exists ?? fs.existsSync)(binaryPath)) {
    throw new Error('The bundled Codex App Server executable is missing');
  }
  (options.probe ?? probeCodexBinary)(binaryPath);
  return binaryPath;
}

export function mapAsarToUnpacked(filePath: string): string {
  return filePath.replace(/([\\/])app\.asar\1/, '$1app.asar.unpacked$1');
}

export function probeCodexBinary(binaryPath: string): void {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/^(?:OPENAI|CODEX|CHATGPT)_(?:.*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?))$/i.test(key)) {
      delete environment[key];
    }
  }
  const result = spawnSync(binaryPath, ['--version'], {
    encoding: 'utf8',
    env: environment,
    timeout: 5_000,
    windowsHide: true,
  });
  const versionText = typeof result.stdout === 'string' ? result.stdout.trim() : '';
  if (
    result.status !== 0 ||
    !new RegExp(`(?:^|\\s)${escapeRegExp(CODEX_VERSION)}(?:$|\\s)`).test(versionText)
  ) {
    throw new Error('The bundled Codex App Server executable failed its version probe');
  }
}

function assertPinnedPlatformPackage(packageJsonPath: string): void {
  let version: string;
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version?: unknown };
    version = typeof parsed.version === 'string' ? parsed.version : '';
  } catch {
    throw new Error('The bundled Codex package metadata is unreadable');
  }

  if (version !== CODEX_VERSION && !version.startsWith(`${CODEX_VERSION}-`)) {
    throw new Error('The bundled Codex App Server version does not match the pinned runtime');
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
