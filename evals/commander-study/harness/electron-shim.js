/**
 * Registers an ESM resolve hook that redirects `import 'electron'` to a
 * stub module. Import this file BEFORE any `apps/desktop-main/src/*` import.
 *
 * Only reachable from pure-Node harness runs — inside Electron the real
 * 'electron' binding wins.
 */
import { register } from 'node:module';

// Node's `register()` expects the loader path as either a bare specifier
// resolvable from `parentURL`, or a file:// URL. We use a file:// URL
// constructed by hand to avoid Windows path quirks with pathToFileURL.
const here = import.meta.url.replace(/\/[^/]+$/, '/');
register(new URL('./electron-shim-loader.mjs', here));
