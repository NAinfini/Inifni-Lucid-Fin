/**
 * ESM loader hook. Intercepts `import 'electron'` and redirects to our stub.
 * See electron-shim.js for usage notes.
 */
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const STUB_URL = pathToFileURL(path.join(__dirname, 'electron-stub.mjs')).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: STUB_URL, shortCircuit: true, format: 'module' };
  }
  return nextResolve(specifier, context);
}
