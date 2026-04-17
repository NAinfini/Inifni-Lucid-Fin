/**
 * gen-preload.ts — Phase B codegen pipeline.
 *
 * Reads the full channel registry from `@lucid-fin/contracts-parse` and emits:
 *
 *   1. apps/desktop-main/src/preload.generated.cts
 *      Runtime preload. contextBridge.exposeInMainWorld('lucidAPI', { ... })
 *      with each method:
 *        - parsing the request via the channel's zod schema,
 *        - calling ipcRenderer.invoke / .on depending on kind,
 *        - for cancellable invokes, also exposing a `.cancel(invocationId)`.
 *      Preload runs inside the Electron preload sandbox, so bundling zod here
 *      is fine (one-time load cost, not shipped to renderer).
 *
 *   2. packages/contracts/src/ipc/lucid-api.generated.ts
 *      Pure .d.ts-style interface. Zero runtime expressions, zero zod. The
 *      renderer imports `LucidAPI` from `@lucid-fin/contracts` and types
 *      `window.lucidAPI` against it.
 *
 * Both files are checked for byte-equality after a clean run by the
 * codegen-idempotence CI workflow.
 *
 * Run via: npx tsx scripts/gen-preload.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allChannels } from '../packages/contracts-parse/src/ipc/index.js';
import type {
  InvokeChannelDef,
  PushChannelDef,
  ReplyChannelDef,
} from '../packages/contracts-parse/src/channels.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Channel shape ──────────────────────────────────────────────

type AnyChannelDef =
  | InvokeChannelDef<string, unknown, unknown, unknown>
  | PushChannelDef<string, unknown>
  | ReplyChannelDef<string, unknown, unknown>;

interface ChannelMeta {
  kind: 'invoke' | 'push' | 'reply';
  channel: string;
  /** Identifier used to reference the channel object in emitted preload. */
  varName: string;
  /** Namespace bucket (part before the first colon). */
  namespace: string;
  /** Method name on the namespace bucket (camelCase of everything after ':'). */
  methodName: string;
  cancellable: boolean;
  /** Name of the request type as exported from contracts-parse, if known. */
  requestTypeName?: string;
  /** Name of the response type, if known. */
  responseTypeName?: string;
  /** Name of the payload type (push channels). */
  payloadTypeName?: string;
  /** Name of the event type (invoke channels with events). */
  eventTypeName?: string;
}

/**
 * Phase B-4 scaffolding — the registry is referenced by object identity, so
 * the codegen script imports the channel object directly. For types we lean
 * on a naming convention: for channel `<domain>:<method>` we assume the
 * contracts-parse barrel exports `<Domain><Method>Request`, `<Domain><Method>Response`,
 * etc., in PascalCase. Batches that ship channels without matching type
 * exports fall back to `unknown`.
 */
function toPascal(parts: string[]): string {
  return parts
    .map((p) => (p.length === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join('');
}

function toCamel(parts: string[]): string {
  if (parts.length === 0) return '';
  const [first, ...rest] = parts;
  return first + toPascal(rest);
}

function channelToVarName(channel: string, kind: ChannelMeta['kind']): string {
  // 'health:ping' → 'healthPingChannel'; 'job:progress' push → 'jobProgressChannel'
  void kind;
  const parts = channel.split(':').flatMap((s) => s.split('-'));
  return toCamel(parts) + 'Channel';
}

function methodFromChannel(channel: string): string {
  // 'commander:chat' → 'chat'; 'canvas:generation:request' → 'generationRequest'
  const [, ...rest] = channel.split(':');
  const parts = rest.flatMap((s) => s.split('-'));
  return toCamel(parts);
}

function typeBasenameFor(channel: string): string {
  // 'health:ping' → 'HealthPing'
  const parts = channel.split(':').flatMap((s) => s.split('-'));
  return toPascal(parts);
}

function toMeta(def: AnyChannelDef): ChannelMeta {
  const channel = def.channel;
  const namespace = channel.split(':')[0];
  const base: ChannelMeta = {
    kind: def.kind,
    channel,
    varName: channelToVarName(channel, def.kind),
    namespace,
    methodName: methodFromChannel(channel),
    cancellable:
      def.kind === 'invoke'
        ? (def as InvokeChannelDef).cancellable ?? false
        : false,
  };
  const typeBase = typeBasenameFor(channel);
  if (def.kind === 'invoke') {
    base.requestTypeName = `${typeBase}Request`;
    base.responseTypeName = `${typeBase}Response`;
  } else if (def.kind === 'reply') {
    base.requestTypeName = `${typeBase}Request`;
    base.responseTypeName = `${typeBase}Response`;
  } else {
    base.payloadTypeName = `${typeBase}Payload`;
  }
  return base;
}

const channels: ChannelMeta[] = (allChannels as readonly AnyChannelDef[]).map(toMeta);

// ── Group by namespace ─────────────────────────────────────────

const byNamespace = new Map<string, ChannelMeta[]>();
for (const ch of channels) {
  const list = byNamespace.get(ch.namespace) ?? [];
  list.push(ch);
  byNamespace.set(ch.namespace, list);
}

// Stable namespace ordering so codegen is deterministic.
const namespaces = Array.from(byNamespace.keys()).sort();

// ── Emit preload.generated.cts ─────────────────────────────────

function emitPreload(): string {
  const lines: string[] = [];
  lines.push('// @generated by scripts/gen-preload.ts. Do not edit by hand.');
  lines.push("import { contextBridge, ipcRenderer } from 'electron';");

  const imports = channels.map((ch) => ch.varName).sort();
  lines.push(
    `import { ${imports.join(', ')} } from '@lucid-fin/contracts-parse';`,
  );
  lines.push('');

  // Cancel helper — exposed on lucidAPI.ipc.cancel so renderers can abort
  // any cancellable invocation by id.
  lines.push("contextBridge.exposeInMainWorld('lucidAPI', {");
  lines.push('  ipc: {');
  lines.push('    cancel: (invocationId: string) => ipcRenderer.invoke(\'ipc:cancel\', invocationId),');
  lines.push('    onInvocation: (channel: string, cb: (invocationId: string) => void) => {');
  lines.push('      const listener = (_e: unknown, payload: { invocationId: string }) => cb(payload.invocationId);');
  lines.push('      ipcRenderer.on(`${channel}:invocation`, listener);');
  lines.push('      return () => ipcRenderer.removeListener(`${channel}:invocation`, listener);');
  lines.push('    },');
  lines.push('    onEvent: (channel: string, cb: (payload: { invocationId: string; event: unknown }) => void) => {');
  lines.push('      const listener = (_e: unknown, payload: { invocationId: string; event: unknown }) => cb(payload);');
  lines.push('      ipcRenderer.on(`${channel}:event`, listener);');
  lines.push('      return () => ipcRenderer.removeListener(`${channel}:event`, listener);');
  lines.push('    },');
  lines.push('  },');

  for (const ns of namespaces) {
    lines.push(`  ${ns}: {`);
    for (const ch of byNamespace.get(ns)!) {
      if (ch.kind === 'invoke') {
        lines.push(
          `    ${ch.methodName}: async (req: unknown) => {`,
        );
        lines.push(
          `      const parsed = ${ch.varName}.schemas.request.parse(req);`,
        );
        lines.push(
          `      return ipcRenderer.invoke('${ch.channel}', parsed);`,
        );
        lines.push('    },');
      } else if (ch.kind === 'reply') {
        lines.push(
          `    ${ch.methodName}: async (req: unknown) => {`,
        );
        lines.push(
          `      const parsed = ${ch.varName}.schemas.request.parse(req);`,
        );
        lines.push(
          `      return ipcRenderer.invoke('${ch.channel}', parsed);`,
        );
        lines.push('    },');
      } else if (ch.kind === 'push') {
        // Push channels expose a subscription helper: renderer passes a cb.
        lines.push(
          `    on${ch.methodName.charAt(0).toUpperCase()}${ch.methodName.slice(1)}: (cb: (payload: unknown) => void) => {`,
        );
        lines.push(
          `      const listener = (_e: unknown, payload: unknown) => cb(payload);`,
        );
        lines.push(
          `      ipcRenderer.on('${ch.channel}', listener);`,
        );
        lines.push(
          `      return () => ipcRenderer.removeListener('${ch.channel}', listener);`,
        );
        lines.push('    },');
      }
    }
    lines.push('  },');
  }

  lines.push('});');
  lines.push('');
  return lines.join('\n');
}

// ── Emit lucid-api.generated.ts ────────────────────────────────

function emitLucidApi(): string {
  const lines: string[] = [];
  lines.push('// @generated by scripts/gen-preload.ts. Do not edit by hand.');
  lines.push('');

  // Gather all referenced type names grouped by the module they come from
  // (currently one flat import from contracts-parse for simplicity).
  const importedTypes = new Set<string>();
  for (const ch of channels) {
    if (ch.requestTypeName) importedTypes.add(ch.requestTypeName);
    if (ch.responseTypeName) importedTypes.add(ch.responseTypeName);
    if (ch.payloadTypeName) importedTypes.add(ch.payloadTypeName);
    if (ch.eventTypeName) importedTypes.add(ch.eventTypeName);
  }
  const typeList = Array.from(importedTypes).sort();
  if (typeList.length > 0) {
    lines.push(
      `import type { ${typeList.join(', ')} } from './channels/index.js';`,
    );
    lines.push('');
  }

  // ── Infrastructure surface (always present) ─────────────────
  lines.push('/** Control surface injected alongside the per-namespace methods. */');
  lines.push('export interface LucidAPIInfrastructure {');
  lines.push('  ipc: {');
  lines.push('    cancel(invocationId: string): Promise<boolean>;');
  lines.push('    onInvocation(channel: string, cb: (invocationId: string) => void): () => void;');
  lines.push('    onEvent(channel: string, cb: (payload: { invocationId: string; event: unknown }) => void): () => void;');
  lines.push('  };');
  lines.push('}');
  lines.push('');

  // ── Per-namespace interfaces ─────────────────────────────────
  for (const ns of namespaces) {
    lines.push(`export interface LucidAPI_${toPascal([ns])} {`);
    for (const ch of byNamespace.get(ns)!) {
      if (ch.kind === 'invoke' || ch.kind === 'reply') {
        const req = ch.requestTypeName ?? 'unknown';
        const res = ch.responseTypeName ?? 'unknown';
        lines.push(`  ${ch.methodName}(req: ${req}): Promise<${res}>;`);
      } else if (ch.kind === 'push') {
        const payload = ch.payloadTypeName ?? 'unknown';
        const cap = ch.methodName.charAt(0).toUpperCase() + ch.methodName.slice(1);
        lines.push(
          `  on${cap}(cb: (payload: ${payload}) => void): () => void;`,
        );
      }
    }
    lines.push('}');
    lines.push('');
  }

  // ── Top-level LucidAPI ──────────────────────────────────────
  lines.push('export interface LucidAPI extends LucidAPIInfrastructure {');
  for (const ns of namespaces) {
    lines.push(`  ${ns}: LucidAPI_${toPascal([ns])};`);
  }
  lines.push('}');
  lines.push('');
  return lines.join('\n');
}

// ── Write files ────────────────────────────────────────────────

const preloadPath = resolve(ROOT, 'apps/desktop-main/src/preload.generated.cts');
const lucidApiPath = resolve(ROOT, 'packages/contracts/src/ipc/lucid-api.generated.ts');

writeFileSync(preloadPath, emitPreload(), 'utf8');
writeFileSync(lucidApiPath, emitLucidApi(), 'utf8');

console.log(`gen-preload: wrote ${preloadPath}`);
console.log(`gen-preload: wrote ${lucidApiPath}`);
console.log(`gen-preload: ${channels.length} channel(s) processed (${namespaces.length} namespace(s)).`);
