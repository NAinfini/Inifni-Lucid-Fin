/**
 * Deterministically generates the IPC preload bridge and renderer API types
 * from `packages/contracts-parse/src/ipc/index.ts`.
 *
 * Usage:
 *   node scripts/gen-preload.ts
 *   node scripts/gen-preload.ts --check
 */
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { format } from 'prettier';

type ChannelKind = 'invoke' | 'push' | 'reply';

export interface ChannelLike {
  kind: ChannelKind;
  channel: string;
}

interface ExpectedInvokeNames {
  channelConstant: string;
  requestType: string;
  responseType: string;
}

interface ExpectedPushNames {
  channelConstant: string;
  payloadType: string;
}

interface ExpectedReplyNames {
  channelConstant: string;
  requestType: string;
  responseType: string;
}

interface PreparedChannel extends ChannelLike {
  namespace: string;
  method: string;
  apiMethod: string;
}

export interface GeneratedOutputs {
  preload: string;
  lucidApi: string;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contractsParseSourceRoot = path.join(repoRoot, 'packages/contracts-parse/src');
const contractsParseSourceUrl = `${pathToFileURL(contractsParseSourceRoot).href}/`;
const registryPath = path.join(contractsParseSourceRoot, 'ipc/index.ts');
const contractChannelBarrelPath = path.join(
  repoRoot,
  'packages/contracts/src/ipc/channels/index.ts',
);
const preloadPath = path.join(repoRoot, 'apps/desktop-main/src/preload.generated.cts');
const lucidApiPath = path.join(repoRoot, 'packages/contracts/src/ipc/lucid-api.generated.ts');
const prettierOptions = {
  parser: 'typescript',
  printWidth: 100,
  singleQuote: true,
  semi: true,
  trailingComma: 'all',
  endOfLine: 'lf',
} as const;

let sourceHookRegistered = false;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function upperFirst(value: string): string {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function lowerFirst(value: string): string {
  return value ? value[0].toLowerCase() + value.slice(1) : value;
}

export function channelToSymbolBase(channel: string): string {
  return channel
    .split(/[:.-]/)
    .filter(Boolean)
    .map((part) => upperFirst(part))
    .join('');
}

export function expectedGeneratedNames(
  channel: ChannelLike,
): ExpectedInvokeNames | ExpectedPushNames | ExpectedReplyNames {
  const base = channelToSymbolBase(channel.channel);
  const channelConstant = `${lowerFirst(base)}Channel`;

  if (channel.kind === 'push') {
    return {
      channelConstant,
      payloadType: `${base}Payload`,
    };
  }

  return {
    channelConstant,
    requestType: `${base}Request`,
    responseType: `${base}Response`,
  };
}

function registerContractsParseSourceHook(): void {
  if (sourceHookRegistered) return;

  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        // Node's native TypeScript support strips types but intentionally does
        // not remap the NodeNext `.js` source specifiers to sibling `.ts` files.
        if (specifier.endsWith('.js') && context.parentURL?.startsWith(contractsParseSourceUrl)) {
          return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
        }
        throw error;
      }
    },
  });
  sourceHookRegistered = true;
}

async function loadRegistryChannels(): Promise<ChannelLike[]> {
  registerContractsParseSourceHook();
  const registry = (await import(pathToFileURL(registryPath).href)) as {
    allChannels?: readonly ChannelLike[];
  };
  if (!Array.isArray(registry.allChannels)) {
    throw new Error('contracts-parse IPC registry does not export allChannels');
  }
  return registry.allChannels.map(({ kind, channel }) => ({ kind, channel }));
}

function collectContractTypeExports(): Set<string> {
  const barrel = fs.readFileSync(contractChannelBarrelPath, 'utf8');
  const sourcePaths = new Set<string>();
  const modulePattern = /from\s+['"]\.\/([^'"]+)\.js['"]/g;

  for (const match of barrel.matchAll(modulePattern)) {
    sourcePaths.add(path.join(path.dirname(contractChannelBarrelPath), `${match[1]}.ts`));
  }

  const typeNames = new Set<string>();
  const declarationPattern = /export\s+(?:interface|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  for (const sourcePath of [...sourcePaths].sort(compareText)) {
    const source = fs.readFileSync(sourcePath, 'utf8');
    for (const match of source.matchAll(declarationPattern)) {
      typeNames.add(match[1]);
    }
  }
  return typeNames;
}

function prepareChannels(channels: readonly ChannelLike[]): PreparedChannel[] {
  const seenChannels = new Set<string>();
  const seenMethods = new Set<string>();
  const prepared: PreparedChannel[] = [];

  for (const channel of [...channels].sort((left, right) =>
    compareText(left.channel, right.channel),
  )) {
    if (!['invoke', 'push', 'reply'].includes(channel.kind)) {
      throw new Error(`Unsupported IPC channel kind for ${channel.channel}: ${channel.kind}`);
    }
    if (seenChannels.has(channel.channel)) {
      throw new Error(`Duplicate IPC channel: ${channel.channel}`);
    }
    seenChannels.add(channel.channel);

    const parts = channel.channel.split(/[:.-]/).filter(Boolean);
    if (parts.length < 2) {
      throw new Error(`IPC channel must contain a namespace and method: ${channel.channel}`);
    }
    const namespace = lowerFirst(channelToSymbolBase(parts[0]));
    const method = lowerFirst(parts.slice(1).map(upperFirst).join(''));
    const apiMethod = channel.kind === 'push' ? `on${upperFirst(method)}` : method;
    const methodKey = `${namespace}.${apiMethod}`;
    if (seenMethods.has(methodKey)) {
      throw new Error(`IPC channels produce the same generated API method: ${methodKey}`);
    }
    seenMethods.add(methodKey);
    prepared.push({ ...channel, namespace, method, apiMethod });
  }

  return prepared;
}

function groupChannels(channels: readonly PreparedChannel[]): Map<string, PreparedChannel[]> {
  const groups = new Map<string, PreparedChannel[]>();
  for (const channel of channels) {
    const group = groups.get(channel.namespace) ?? [];
    group.push(channel);
    groups.set(channel.namespace, group);
  }
  return new Map([...groups.entries()].sort(([left], [right]) => compareText(left, right)));
}

function renderPreload(channels: readonly PreparedChannel[]): string {
  const groups = groupChannels(channels);
  const lines = [
    '// @generated by scripts/gen-preload.ts. Do not edit by hand.',
    "import { contextBridge, ipcRenderer } from 'electron';",
    "import { allChannels } from '@lucid-fin/contracts-parse';",
    '',
    'interface GeneratedRequestSchema {',
    '  parse(value: unknown): unknown;',
    '}',
    '',
    'const requestSchemas = new Map<string, GeneratedRequestSchema>();',
    'for (const definition of allChannels) {',
    "  if ('request' in definition.schemas) {",
    '    requestSchemas.set(definition.channel, definition.schemas.request);',
    '  }',
    '}',
    '',
    'function parseRequest(channel: string, request: unknown): unknown {',
    '  const schema = requestSchemas.get(channel);',
    '  if (!schema) {',
    '    throw new Error(`Missing request schema for generated IPC channel: ${channel}`);',
    '  }',
    '  return schema.parse(request);',
    '}',
    '',
    "contextBridge.exposeInMainWorld('lucidAPI', {",
    '  ipc: {',
    "    cancel: (invocationId: string) => ipcRenderer.invoke('ipc:cancel', invocationId),",
    '    onInvocation: (channel: string, cb: (invocationId: string) => void) => {',
    '      const listener = (_e: unknown, payload: { invocationId: string }) =>',
    '        cb(payload.invocationId);',
    '      ipcRenderer.on(`${channel}:invocation`, listener);',
    '      return () => ipcRenderer.removeListener(`${channel}:invocation`, listener);',
    '    },',
    '    onEvent: (',
    '      channel: string,',
    '      cb: (payload: { invocationId: string; event: unknown }) => void,',
    '    ) => {',
    '      const listener = (_e: unknown, payload: { invocationId: string; event: unknown }) =>',
    '        cb(payload);',
    '      ipcRenderer.on(`${channel}:event`, listener);',
    '      return () => ipcRenderer.removeListener(`${channel}:event`, listener);',
    '    },',
    '  },',
  ];

  for (const [namespace, namespaceChannels] of groups) {
    lines.push(`  ${namespace}: {`);
    for (const channel of namespaceChannels) {
      if (channel.kind === 'push') {
        lines.push(
          `    ${channel.apiMethod}: (cb: (payload: unknown) => void) => {`,
          '      const listener = (_e: unknown, payload: unknown) => cb(payload);',
          `      ipcRenderer.on('${channel.channel}', listener);`,
          `      return () => ipcRenderer.removeListener('${channel.channel}', listener);`,
          '    },',
        );
      } else {
        lines.push(
          `    ${channel.apiMethod}: async (req: unknown) => {`,
          `      const parsed = parseRequest('${channel.channel}', req);`,
          `      return ipcRenderer.invoke('${channel.channel}', parsed);`,
          '    },',
        );
      }
    }
    lines.push('  },');
  }

  lines.push('});', '');
  return lines.join('\n');
}

function requiredTypeNames(channels: readonly PreparedChannel[]): Set<string> {
  const result = new Set<string>();
  for (const channel of channels) {
    const names = expectedGeneratedNames(channel);
    if (channel.kind === 'push') {
      result.add((names as ExpectedPushNames).payloadType);
    } else {
      const invokeNames = names as ExpectedInvokeNames | ExpectedReplyNames;
      result.add(invokeNames.requestType);
      result.add(invokeNames.responseType);
    }
  }
  return result;
}

function renderLucidApi(
  channels: readonly PreparedChannel[],
  availableTypeNames: ReadonlySet<string>,
): string {
  const groups = groupChannels(channels);
  const requiredTypes = [...requiredTypeNames(channels)].sort(compareText);
  const importedTypes = requiredTypes.filter((name) => availableTypeNames.has(name));
  const unavailableTypes = requiredTypes.filter((name) => !availableTypeNames.has(name));
  const lines = ['// @generated by scripts/gen-preload.ts. Do not edit by hand.', ''];

  if (importedTypes.length > 0) {
    lines.push(
      'import type {',
      ...importedTypes.map((name) => `  ${name},`),
      "} from './channels/index.js';",
      '',
    );
  }

  if (unavailableTypes.length > 0) {
    lines.push(
      '// The runtime registry owns these channels, but the pure contracts barrel does not',
      '// yet export corresponding DTOs. Keep the generated surface complete without',
      '// introducing a contracts -> contracts-parse package cycle.',
      ...unavailableTypes.map((name) => `type ${name} = unknown;`),
      '',
    );
  }

  lines.push(
    '/** Control surface injected alongside the per-namespace methods. */',
    'export interface LucidAPIInfrastructure {',
    '  ipc: {',
    '    cancel(invocationId: string): Promise<boolean>;',
    '    onInvocation(channel: string, cb: (invocationId: string) => void): () => void;',
    '    onEvent(',
    '      channel: string,',
    '      cb: (payload: { invocationId: string; event: unknown }) => void,',
    '    ): () => void;',
    '  };',
    '}',
    '',
  );

  for (const [namespace, namespaceChannels] of groups) {
    const interfaceName = `LucidAPI_${channelToSymbolBase(namespace)}`;
    lines.push(`export interface ${interfaceName} {`);
    for (const channel of namespaceChannels) {
      const names = expectedGeneratedNames(channel);
      if (channel.kind === 'push') {
        lines.push(
          `  ${channel.apiMethod}(`,
          `    cb: (payload: ${(names as ExpectedPushNames).payloadType}) => void,`,
          '  ): () => void;',
        );
      } else {
        const invokeNames = names as ExpectedInvokeNames | ExpectedReplyNames;
        lines.push(
          `  ${channel.apiMethod}(`,
          `    req: ${invokeNames.requestType},`,
          `  ): Promise<${invokeNames.responseType}>;`,
        );
      }
    }
    lines.push('}', '');
  }

  lines.push('export interface LucidAPI extends LucidAPIInfrastructure {');
  for (const namespace of groups.keys()) {
    lines.push(`  ${namespace}: LucidAPI_${channelToSymbolBase(namespace)};`);
  }
  lines.push('}', '');
  return lines.join('\n');
}

export async function generateOutputs(
  channels: readonly ChannelLike[],
  availableTypeNames: ReadonlySet<string> = collectContractTypeExports(),
): Promise<GeneratedOutputs> {
  const prepared = prepareChannels(channels);
  const [preload, lucidApi] = await Promise.all([
    format(renderPreload(prepared), prettierOptions),
    format(renderLucidApi(prepared, availableTypeNames), prettierOptions),
  ]);
  return { preload, lucidApi };
}

function fileMatches(filePath: string, expected: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  return fs.readFileSync(filePath).equals(Buffer.from(expected, 'utf8'));
}

function writeIfChanged(filePath: string, content: string): boolean {
  if (fileMatches(filePath, content)) return false;
  fs.writeFileSync(filePath, content, 'utf8');
  return true;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const check = args.length === 1 && args[0] === '--check';
  if (args.length > 0 && !check) {
    throw new Error(`Unknown arguments: ${args.join(' ')}`);
  }

  const channels = await loadRegistryChannels();
  const outputs = await generateOutputs(channels);
  const staleFiles = [
    [preloadPath, outputs.preload],
    [lucidApiPath, outputs.lucidApi],
  ].filter(([filePath, content]) => !fileMatches(filePath, content));

  if (check) {
    if (staleFiles.length > 0) {
      for (const [filePath] of staleFiles) {
        console.error(`${path.relative(repoRoot, filePath)} differs from generated output`);
      }
      process.exitCode = 1;
      return;
    }
    console.log(`Generated preload/API files exactly match all ${channels.length} IPC channels.`);
    return;
  }

  let updated = 0;
  if (writeIfChanged(preloadPath, outputs.preload)) updated += 1;
  if (writeIfChanged(lucidApiPath, outputs.lucidApi)) updated += 1;
  console.log(`Generated ${channels.length} IPC channels (${updated} files updated).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
