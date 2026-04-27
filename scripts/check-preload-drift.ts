/**
 * check-preload-drift.ts
 *
 * Verifies that every top-level namespace declared in global.d.ts
 * (the renderer's `window.lucidAPI` type) has a corresponding entry in
 * preload.cts (the active runtime preload). Exits non-zero if any
 * namespace declared in global.d.ts is absent from preload.cts.
 *
 * Only checks top-level namespace keys — method-level drift inside a
 * namespace is outside the scope of this script (TypeScript itself catches
 * that once the declaration and implementation share the same surface).
 *
 * Invoke: npx tsx scripts/check-preload-drift.ts
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const GLOBAL_DTS = path.join(
  REPO_ROOT,
  'apps/desktop-renderer/src/types/global.d.ts',
);
const PRELOAD_CTS = path.join(
  REPO_ROOT,
  'apps/desktop-main/src/preload.cts',
);

/**
 * Extract the top-level namespace names declared inside the
 * `lucidAPI: { ... }` block of global.d.ts.
 *
 * Strategy: scan for lines of the form `      <key>: {` or `      <key>: (`
 * that are indented with exactly 6 spaces (one level inside `lucidAPI`).
 * This is intentionally simple regex — the file structure is stable and
 * well-formatted.
 */
function extractGlobalDtsNamespaces(src: string): Set<string> {
  const namespaces = new Set<string>();

  // Locate the `lucidAPI: {` opening
  const apiStart = src.indexOf('lucidAPI: {');
  if (apiStart === -1) {
    throw new Error('global.d.ts: could not find "lucidAPI: {" block');
  }

  const body = src.slice(apiStart);

  // Match lines like `      key: {` or `      key: (` — 6-space indent
  // These are the direct children of the lucidAPI object type.
  const re = /^ {6}([a-zA-Z][a-zA-Z0-9]*)\s*:/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    namespaces.add(m[1]);
  }
  return namespaces;
}

/**
 * Extract the top-level keys from the `contextBridge.exposeInMainWorld`
 * object in preload.cts.
 *
 * Strategy: scan for lines of the form `  <key>: ` (2-space indent, one
 * level inside the object literal passed to exposeInMainWorld).
 */
function extractPreloadNamespaces(src: string): Set<string> {
  const namespaces = new Set<string>();

  const exposureStart = src.indexOf("exposeInMainWorld('lucidAPI'");
  if (exposureStart === -1) {
    throw new Error(
      "preload.cts: could not find \"exposeInMainWorld('lucidAPI'\" call",
    );
  }

  const body = src.slice(exposureStart);

  // Match lines like `  key: ` or `  key: (` — 2-space indent (direct
  // children of the top-level object literal).
  const re = /^ {2}([a-zA-Z][a-zA-Z0-9]*)\s*:/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    namespaces.add(m[1]);
  }
  return namespaces;
}

async function main(): Promise<void> {
  const [globalDts, preloadCts] = await Promise.all([
    readFile(GLOBAL_DTS, 'utf-8'),
    readFile(PRELOAD_CTS, 'utf-8'),
  ]);

  const declared = extractGlobalDtsNamespaces(globalDts);
  const implemented = extractPreloadNamespaces(preloadCts);

  const phantom = [...declared].filter((ns) => !implemented.has(ns));

  if (phantom.length === 0) {
    console.log(
      `check-preload-drift: OK — all ${declared.size} global.d.ts namespaces have preload.cts entries.`,
    );
    return;
  }

  console.error('check-preload-drift: DRIFT DETECTED\n');
  console.error(
    'The following namespaces are declared in global.d.ts but have no',
  );
  console.error(
    'corresponding entry in preload.cts. Any renderer call to these APIs',
  );
  console.error('will silently fail or timeout at runtime.\n',
  );
  for (const ns of phantom) {
    console.error(`  window.lucidAPI.${ns}  — no implementation in preload.cts`);
  }
  console.error(
    '\nFix: either add the namespace to preload.cts, or remove it from global.d.ts.',
  );
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('check-preload-drift: crashed', err);
  process.exit(2);
});
