import { spawnSync } from 'node:child_process';
import console from 'node:console';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const require = createRequire(import.meta.url);
const runtime = process.argv[2];
const nativeModulePath = require.resolve('better-sqlite3');
const probeScript = [
  `const Database = require(${JSON.stringify(nativeModulePath)});`,
  "const database = new Database(':memory:');",
  'database.close();',
].join(' ');

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    ...options,
  });
}

function probe(command, args, env = process.env) {
  return run(command, args, { env, stdio: 'pipe' }).status === 0;
}

function rebuildForNode() {
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) throw new Error('pnpm executable is unavailable; run this check through pnpm.');
  return run(
    process.execPath,
    [pnpmCli, '--filter', '@lucid-fin/desktop-main', 'rebuild', 'better-sqlite3'],
    { stdio: 'inherit' },
  );
}

function rebuildForElectron(electronVersion) {
  const rebuildCli = resolve(dirname(require.resolve('@electron/rebuild')), 'cli.js');
  return run(process.execPath, [rebuildCli, '-f', '-w', 'better-sqlite3', '-v', electronVersion], {
    stdio: 'inherit',
  });
}

if (runtime === 'node') {
  const args = ['-e', probeScript];
  if (probe(process.execPath, args)) {
    console.log('[native-runtime] better-sqlite3 is ready for Node.');
    process.exit(0);
  }

  console.log('[native-runtime] Rebuilding better-sqlite3 for Node...');
  const result = rebuildForNode();
  if (result.status !== 0 || !probe(process.execPath, args)) {
    throw new Error('better-sqlite3 could not be prepared for Node.');
  }
} else if (runtime === 'electron') {
  const electronPath = require('electron');
  const electronVersion = require('electron/package.json').version;
  const args = ['-e', probeScript];
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  if (probe(electronPath, args, env)) {
    console.log(`[native-runtime] better-sqlite3 is ready for Electron ${electronVersion}.`);
    process.exit(0);
  }

  console.log(`[native-runtime] Rebuilding better-sqlite3 for Electron ${electronVersion}...`);
  const result = rebuildForElectron(electronVersion);
  if (result.status !== 0 || !probe(electronPath, args, env)) {
    throw new Error(`better-sqlite3 could not be prepared for Electron ${electronVersion}.`);
  }
} else {
  throw new Error('Usage: node scripts/ensure-native-runtime.mjs <node|electron>');
}
