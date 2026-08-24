import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REQUIRED_CONTRACT_PATHS = [
  'docs/plans/2026-08-15-project-first-lucid-fin.md',
  'docs/design/project-shell-screen-contract.md',
  'docs/design/project-workspaces-contract.md',
  'docs/plans/2026-08-15-project-data-history-memory-cutover.md',
  'docs/plans/2026-08-15-commander-runtime-tool-surface.md',
  'docs/plans/2026-08-15-film-tool-catalog-contract.md',
  'docs/plans/2026-08-15-project-first-implementation-program.md',
] as const;

export type SchemaKind = 'table' | 'virtual_table' | 'index' | 'trigger';

export interface SchemaObject {
  kind: SchemaKind;
  name: string;
  columns: string[];
  sources: string[];
}

export interface NamedSource {
  name: string;
  sources: string[];
}

export interface ChannelSource extends NamedSource {
  channelKind: 'invoke' | 'push' | 'reply';
}

export interface BaselineInventory {
  contracts: Array<{ path: string; sha256: string }>;
  schema: SchemaObject[];
  tools: NamedSource[];
  excludedTools: string[];
  modelTools: NamedSource[];
  channels: ChannelSource[];
  routes: NamedSource[];
  localStorage: NamedSource[];
}

export interface DispositionRule {
  id: string;
  name: string | string[];
  disposition: string;
}

export interface SchemaDispositionRule extends DispositionRule {
  kind: SchemaKind;
}

export interface ColumnDispositionRule {
  column: string;
  id: string;
  disposition: string;
}

export interface ColumnPolicy {
  table: string | string[];
  default?: Omit<ColumnDispositionRule, 'column'>;
  overrides: ColumnDispositionRule[];
}

function namesFor(value: string | string[]): string[] {
  return Array.isArray(value) ? value : [value];
}

function ruleMatchesName(rule: DispositionRule, name: string): boolean {
  return namesFor(rule.name).includes(name);
}

export interface BaselineManifest {
  version: 1;
  contracts: Array<{ path: string; sha256: string }>;
  inventoryHashes: Record<
    'schema' | 'tools' | 'modelTools' | 'channels' | 'routes' | 'localStorage',
    string
  >;
  schemaObjects: SchemaDispositionRule[];
  columns: ColumnPolicy[];
  tools: DispositionRule[];
  modelTools: DispositionRule[];
  channels: DispositionRule[];
  routes: DispositionRule[];
  localStorage: DispositionRule[];
}

export interface BaselineCheckResult {
  ok: boolean;
  inventory: BaselineInventory;
  errors: string[];
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function repoPath(repoRoot: string, absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).replaceAll(path.sep, '/');
}

function isSourceFile(name: string): boolean {
  return /\.(?:ts|tsx)$/.test(name) && !/\.(?:test|spec)\.(?:ts|tsx)$/.test(name);
}

async function sourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(fullPath)));
    else if (entry.isFile() && isSourceFile(entry.name)) files.push(fullPath);
  }
  return files.sort(compareText);
}

function isIdentifierStart(char: string): boolean {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (/\s/.test(source[index] ?? '')) index += 1;
  return index;
}

function skipJsLiteralOrComment(source: string, start: number): number {
  const quote = source[start] ?? '';
  if (quote === '/' && source[start + 1] === '/') {
    const newline = source.indexOf('\n', start + 2);
    return newline === -1 ? source.length : newline + 1;
  }
  if (quote === '/' && source[start + 1] === '*') {
    const end = source.indexOf('*/', start + 2);
    return end === -1 ? source.length : end + 2;
  }
  if (quote !== "'" && quote !== '"' && quote !== '`') return start + 1;
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\') {
      index += 2;
      continue;
    }
    if (source[index] === quote) return index + 1;
    index += 1;
  }
  return source.length;
}

function matchingBrace(source: string, start: number, open: string, close: string): number {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (
      char === "'" ||
      char === '"' ||
      char === '`' ||
      (char === '/' && ['/', '*'].includes(source[index + 1] ?? ''))
    ) {
      index = skipJsLiteralOrComment(source, index) - 1;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function containingJsLiteralEnd(source: string, target: number): number {
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (char !== "'" && char !== '"' && char !== '`') continue;
    const end = skipJsLiteralOrComment(source, index);
    if (target > index && target < end) return end - 1;
    index = end - 1;
  }
  return -1;
}

function enclosingObjectStart(source: string, before: number): number {
  const stack: number[] = [];
  for (let index = 0; index < before; index += 1) {
    const char = source[index] ?? '';
    if (
      char === "'" ||
      char === '"' ||
      char === '`' ||
      (char === '/' && ['/', '*'].includes(source[index + 1] ?? ''))
    ) {
      index = skipJsLiteralOrComment(source, index) - 1;
      continue;
    }
    if (char === '{') stack.push(index);
    else if (char === '}') stack.pop();
  }
  return stack.at(-1) ?? -1;
}

function parseSqlIdentifier(
  source: string,
  start: number,
): { name: string; next: number } | undefined {
  let index = skipWhitespace(source, start);
  if (/^IF\s+NOT\s+EXISTS\b/i.test(source.slice(index))) {
    const match = /^IF\s+NOT\s+EXISTS\b/i.exec(source.slice(index));
    index += match?.[0].length ?? 0;
    index = skipWhitespace(source, index);
  }
  const quote = source[index] ?? '';
  if (quote === '"' || quote === '`' || quote === '[') {
    const endToken = quote === '[' ? ']' : quote;
    const end = source.indexOf(endToken, index + 1);
    if (end === -1) return undefined;
    return { name: source.slice(index + 1, end), next: end + 1 };
  }
  if (!isIdentifierStart(quote)) return undefined;
  const from = index;
  while (isIdentifierPart(source[index] ?? '')) index += 1;
  return { name: source.slice(from, index), next: index };
}

function splitSqlColumns(body: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] ?? '';
    if (char === "'" || char === '"' || char === '`') {
      index = skipJsLiteralOrComment(body, index) - 1;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  const columns = new Set<string>();
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed || /^(?:CONSTRAINT|PRIMARY|UNIQUE|FOREIGN|CHECK)\b/i.test(trimmed)) continue;
    const identifier = parseSqlIdentifier(trimmed, 0);
    if (identifier) columns.add(identifier.name);
  }
  return [...columns].sort(compareText);
}

function sqlObjectsFromSource(source: string): Array<Omit<SchemaObject, 'sources'>> {
  const objects: Array<Omit<SchemaObject, 'sources'>> = [];
  const tablePattern = /\bCREATE\s+(VIRTUAL\s+)?TABLE\b/gi;
  for (let match: RegExpExecArray | null; (match = tablePattern.exec(source));) {
    const literalEnd = containingJsLiteralEnd(source, match.index);
    if (literalEnd === -1) continue;
    const identifier = parseSqlIdentifier(source, match.index + match[0].length);
    if (!identifier) continue;
    const open = source.indexOf('(', identifier.next);
    if (open === -1 || open > literalEnd) continue;
    const close = matchingBrace(source, open, '(', ')');
    if (close === -1 || close > literalEnd) continue;
    objects.push({
      kind: match[1] ? 'virtual_table' : 'table',
      name: identifier.name,
      columns: splitSqlColumns(source.slice(open + 1, close)),
    });
  }
  const derivedPattern = /\bCREATE\s+(?:(UNIQUE)\s+)?(INDEX|TRIGGER)\b/gi;
  for (let match: RegExpExecArray | null; (match = derivedPattern.exec(source));) {
    const literalEnd = containingJsLiteralEnd(source, match.index);
    const statementEnd = literalEnd === -1 ? -1 : source.indexOf(';', match.index);
    if (statementEnd === -1 || statementEnd > literalEnd) continue;
    const identifier = parseSqlIdentifier(source, match.index + match[0].length);
    if (!identifier) continue;
    objects.push({
      kind: match[2]?.toLowerCase() as 'index' | 'trigger',
      name: identifier.name,
      columns: [],
    });
  }
  return objects;
}

async function collectSchema(repoRoot: string): Promise<SchemaObject[]> {
  const root = path.join(repoRoot, 'packages/storage/src');
  const grouped = new Map<string, SchemaObject>();
  for (const file of await sourceFiles(root)) {
    const relative = repoPath(repoRoot, file);
    for (const object of sqlObjectsFromSource(await readFile(file, 'utf8'))) {
      const key = `${object.kind}:${object.name}`;
      const current = grouped.get(key) ?? {
        ...object,
        sources: [],
      };
      if (current.columns.join(',') !== object.columns.join(',')) {
        throw new Error(
          `Conflicting SQL declaration for ${key}: ${[...current.sources, relative].join(', ')}`,
        );
      }
      current.sources.push(relative);
      grouped.set(key, current);
    }
  }
  return [...grouped.values()]
    .map((item) => ({
      ...item,
      sources: [...new Set(item.sources)].sort(compareText),
    }))
    .sort((a, b) => compareText(`${a.kind}:${a.name}`, `${b.kind}:${b.name}`));
}

function directProperties(source: string): Set<string> {
  const properties = new Set<string>();
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (
      char === "'" ||
      char === '"' ||
      char === '`' ||
      (char === '/' && ['/', '*'].includes(source[index + 1] ?? ''))
    ) {
      index = skipJsLiteralOrComment(source, index) - 1;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') {
      depth += 1;
      continue;
    }
    if (char === '}' || char === ']' || char === ')') {
      depth -= 1;
      continue;
    }
    if (depth !== 0 || !isIdentifierStart(char)) continue;
    const start = index;
    while (isIdentifierPart(source[index] ?? '')) index += 1;
    const word = source.slice(start, index);
    const after = skipWhitespace(source, index);
    if (
      source[after] === ':' ||
      source[after] === '(' ||
      (word === 'async' && /^\s+execute\s*\(/.test(source.slice(index)))
    ) {
      properties.add(word === 'async' ? 'execute' : word);
    }
    index -= 1;
  }
  return properties;
}

function spreadNames(source: string): string[] {
  const names: string[] = [];
  let depth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? '';
    if (
      char === "'" ||
      char === '"' ||
      char === '`' ||
      (char === '/' && ['/', '*'].includes(source[index + 1] ?? ''))
    ) {
      index = skipJsLiteralOrComment(source, index) - 1;
      continue;
    }
    if (char === '{' || char === '[' || char === '(') {
      depth += 1;
      continue;
    }
    if (char === '}' || char === ']' || char === ')') {
      depth -= 1;
      continue;
    }
    if (depth === 0 && source.slice(index, index + 3) === '...') {
      const identifier = parseSqlIdentifier(source, index + 3);
      if (identifier) names.push(identifier.name);
      index = identifier?.next ?? index + 2;
    }
  }
  return names;
}

function declaredObjectProperties(source: string, variable: string): Set<string> {
  const pattern = new RegExp(`\\b(?:const|let)\\s+${variable}\\s*=\\s*\\{`, 'g');
  const match = pattern.exec(source);
  if (!match) return new Set();
  const start = source.indexOf('{', match.index);
  const end = matchingBrace(source, start, '{', '}');
  return end === -1 ? new Set() : directProperties(source.slice(start + 1, end));
}

function toolNamesFromSource(source: string): string[] {
  const names = new Set<string>();
  const namePattern = /\bname\s*:\s*(['"])([^'"\r\n]+)\1/g;
  for (let match: RegExpExecArray | null; (match = namePattern.exec(source));) {
    const start = enclosingObjectStart(source, match.index);
    if (start === -1) continue;
    const end = matchingBrace(source, start, '{', '}');
    if (end === -1 || end < match.index) continue;
    const object = source.slice(start + 1, end);
    const properties = directProperties(object);
    for (const spread of spreadNames(object)) {
      for (const property of declaredObjectProperties(source, spread)) properties.add(property);
    }
    if (
      ['name', 'inputSchema', 'outputSchema', 'execute', 'process', 'category'].every((field) =>
        properties.has(field),
      )
    ) {
      names.add(match[2] ?? '');
    }
  }
  return [...names].filter(Boolean);
}

function uniqueNamed(items: Array<{ name: string; source: string }>, label: string): NamedSource[] {
  const grouped = new Map<string, string[]>();
  for (const item of items)
    grouped.set(item.name, [...(grouped.get(item.name) ?? []), item.source]);
  const duplicates = [...grouped.entries()].filter(([, sources]) => new Set(sources).size > 1);
  if (duplicates.length > 0) {
    throw new Error(`${label} duplicate names: ${duplicates.map(([name]) => name).join(', ')}`);
  }
  return [...grouped.entries()]
    .map(([name, sources]) => ({
      name,
      sources: [...new Set(sources)].sort(compareText),
    }))
    .sort((a, b) => compareText(a.name, b.name));
}

function importBindings(source: string, sourcePath: string): Map<string, string> {
  const bindings = new Map<string, string>();
  const pattern = /import\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]/g;
  for (let match: RegExpExecArray | null; (match = pattern.exec(source));) {
    const modulePath = match[2] ?? '';
    if (!modulePath.startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(sourcePath), modulePath).replace(/\.js$/, '.ts');
    for (const rawBinding of (match[1] ?? '').split(',')) {
      const binding = rawBinding.trim().replace(/^type\s+/, '');
      if (!binding) continue;
      const [imported, local = imported] = binding.split(/\s+as\s+/);
      if (imported && local) bindings.set(local.trim(), resolved);
    }
  }
  return bindings;
}

function callsFactory(source: string, name: string): boolean {
  return new RegExp(`\\b${name}\\s*\\(`).test(source);
}

async function registeredToolNames(repoRoot: string): Promise<NamedSource[]> {
  const registrationPath = path.join(repoRoot, 'packages/agent/src/agent/register-agent-tools.ts');
  const registration = await readFile(registrationPath, 'utf8');
  const bindings = importBindings(registration, registrationPath);
  const factories = [...bindings.entries()]
    .filter(
      ([name]) =>
        (/^create[A-Z].*(?:Tool|Tools)$/.test(name) && callsFactory(registration, name)) ||
        name === 'colorStyleToolModule',
    )
    .map(([, sourcePath]) => sourcePath);
  const found: Array<{ name: string; source: string }> = [];
  const visited = new Set<string>();
  const visit = async (file: string): Promise<void> => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = await readFile(file, 'utf8');
    for (const name of toolNamesFromSource(source))
      found.push({ name, source: repoPath(repoRoot, file) });
    for (const [name, importedPath] of importBindings(source, file)) {
      if (/^create[A-Z].*(?:Tool|Tools)$/.test(name) && callsFactory(source, name))
        await visit(importedPath);
    }
  };
  for (const factory of factories) await visit(factory);
  return uniqueNamed(found, 'registered ToolDefinition');
}

async function collectTools(
  repoRoot: string,
): Promise<{ tools: NamedSource[]; excludedTools: string[]; modelTools: NamedSource[] }> {
  const root = path.join(repoRoot, 'packages/agent/src/agent');
  const found: Array<{ name: string; source: string }> = [];
  for (const file of await sourceFiles(root)) {
    const source = await readFile(file, 'utf8');
    for (const name of toolNamesFromSource(source))
      found.push({ name, source: repoPath(repoRoot, file) });
  }
  const excludedSource = await readFile(path.join(root, 'register-agent-tools.ts'), 'utf8');
  const setStart = excludedSource.indexOf('new Set([');
  const open = setStart === -1 ? -1 : excludedSource.indexOf('[', setStart);
  const close = open === -1 ? -1 : matchingBrace(excludedSource, open, '[', ']');
  if (open === -1 || close === -1) throw new Error('EXCLUDED_TOOLS set was not found');
  const excluded = [...excludedSource.slice(open + 1, close).matchAll(/['"]([^'"]+)['"]/g)]
    .map((match) => match[1] ?? '')
    .filter(Boolean)
    .sort(compareText);
  const tools = uniqueNamed(found, 'ToolDefinition');
  const excludedTools = [...new Set(excluded)];
  const registered = await registeredToolNames(repoRoot);
  return {
    tools,
    excludedTools,
    modelTools: registered.filter((tool) => !excludedTools.includes(tool.name)),
  };
}

async function collectChannels(repoRoot: string): Promise<ChannelSource[]> {
  const root = path.join(repoRoot, 'packages/contracts-parse/src/ipc/channels');
  const found: Array<ChannelSource & { source: string }> = [];
  const pattern = /\bdefine(Invoke|Push|Reply)Channel\s*\(/g;
  for (const file of await sourceFiles(root)) {
    const source = await readFile(file, 'utf8');
    for (let match: RegExpExecArray | null; (match = pattern.exec(source));) {
      const open = source.indexOf('(', match.index);
      const close = matchingBrace(source, open, '(', ')');
      if (close === -1) continue;
      const call = source.slice(open + 1, close);
      const channel = /\bchannel\s*:\s*(['"])([^'"\r\n]+)\1/.exec(call)?.[2];
      if (!channel) continue;
      found.push({
        name: channel,
        channelKind: match[1].toLowerCase() as ChannelSource['channelKind'],
        sources: [],
        source: repoPath(repoRoot, file),
      });
    }
  }
  const grouped = new Map<string, ChannelSource>();
  for (const item of found) {
    const key = `${item.channelKind}:${item.name}`;
    const current = grouped.get(key) ?? {
      name: item.name,
      channelKind: item.channelKind,
      sources: [],
    };
    current.sources.push(item.source);
    grouped.set(key, current);
  }
  const duplicates = [...grouped.values()].filter((item) => new Set(item.sources).size > 1);
  if (duplicates.length > 0)
    throw new Error(
      `IPC duplicate channels: ${duplicates.map((item) => `${item.channelKind}:${item.name}`).join(', ')}`,
    );
  return [...grouped.values()]
    .map((item) => ({
      ...item,
      sources: [...new Set(item.sources)].sort(compareText),
    }))
    .sort((a, b) => compareText(`${a.channelKind}:${a.name}`, `${b.channelKind}:${b.name}`));
}

async function collectRoutes(repoRoot: string): Promise<NamedSource[]> {
  const file = path.join(repoRoot, 'apps/desktop-renderer/src/App.tsx');
  const source = await readFile(file, 'utf8');
  const found = [...source.matchAll(/<Route\s+path\s*=\s*(['"])([^'"]+)\1/g)].map((match) => ({
    name: match[2] ?? '',
    source: repoPath(repoRoot, file),
  }));
  return uniqueNamed(found, 'App route');
}

async function collectLocalStorage(repoRoot: string): Promise<NamedSource[]> {
  const root = path.join(repoRoot, 'apps/desktop-renderer/src');
  const found: Array<{ name: string; source: string }> = [];
  const directKeyPattern =
    /localStorage\.(?:getItem|setItem|removeItem)\s*\(\s*['"](lucid-[A-Za-z0-9:_-]+)['"]/g;
  const declaredKeyPattern =
    /\b(?:const|let|export\s+const)\s+[A-Za-z_][A-Za-z0-9_]*(?:KEY|STORAGE_KEY|LS_KEY)[A-Za-z0-9_]*\s*=\s*['"](lucid-[A-Za-z0-9:_-]+)['"]/g;
  for (const file of await sourceFiles(root)) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(directKeyPattern)) {
      found.push({ name: match[1] ?? '', source: repoPath(repoRoot, file) });
    }
    for (const match of source.matchAll(declaredKeyPattern)) {
      found.push({ name: match[1] ?? '', source: repoPath(repoRoot, file) });
    }
  }
  const grouped = new Map<string, string[]>();
  for (const item of found)
    grouped.set(item.name, [...new Set([...(grouped.get(item.name) ?? []), item.source])]);
  return [...grouped.entries()]
    .map(([name, sources]) => ({ name, sources: sources.sort(compareText) }))
    .sort((a, b) => compareText(a.name, b.name));
}

export async function collectInventory(repoRoot: string): Promise<BaselineInventory> {
  const contracts = await Promise.all(
    REQUIRED_CONTRACT_PATHS.map(async (contractPath) => ({
      path: contractPath,
      sha256: sha256(await readFile(path.join(repoRoot, contractPath), 'utf8')),
    })),
  );
  const { tools, excludedTools, modelTools } = await collectTools(repoRoot);
  return {
    contracts,
    schema: await collectSchema(repoRoot),
    tools,
    excludedTools,
    modelTools,
    channels: await collectChannels(repoRoot),
    routes: await collectRoutes(repoRoot),
    localStorage: await collectLocalStorage(repoRoot),
  };
}

export function inventoryHashes(
  inventory: BaselineInventory,
): Record<'schema' | 'tools' | 'modelTools' | 'channels' | 'routes' | 'localStorage', string> {
  return {
    schema: sha256(canonicalJson(inventory.schema)),
    tools: sha256(canonicalJson(inventory.tools)),
    modelTools: sha256(canonicalJson(inventory.modelTools)),
    channels: sha256(canonicalJson(inventory.channels)),
    routes: sha256(canonicalJson(inventory.routes)),
    localStorage: sha256(canonicalJson(inventory.localStorage)),
  };
}

function matchExactlyOne<T extends { name: string }>(
  item: T,
  rules: DispositionRule[],
  label: string,
  errors: string[],
): void {
  const matches = rules.filter((rule) => ruleMatchesName(rule, item.name));
  if (matches.length === 0) errors.push(`${label} ${item.name} has no disposition rule`);
  else if (matches.length > 1)
    errors.push(`${label} ${item.name} has ${matches.length} disposition rules`);
}

function checkRuleNameMembership(label: string, rules: DispositionRule[], errors: string[]): void {
  const owners = new Map<string, string>();
  for (const rule of rules) {
    const names = namesFor(rule.name);
    if (new Set(names).size !== names.length)
      errors.push(`${label} disposition ${rule.id} repeats a name`);
    for (const name of names) {
      const previous = owners.get(name);
      if (previous && previous !== rule.id)
        errors.push(`${label} ${name} has duplicate disposition rules`);
      owners.set(name, rule.id);
    }
  }
}

function checkContractManifest(
  inventory: BaselineInventory,
  manifest: BaselineManifest,
  errors: string[],
): void {
  const expected = new Map(manifest.contracts.map((item) => [item.path, item.sha256]));
  const actual = new Map(inventory.contracts.map((item) => [item.path, item.sha256]));
  for (const contractPath of REQUIRED_CONTRACT_PATHS) {
    const expectedHash = expected.get(contractPath);
    const actualHash = actual.get(contractPath);
    if (!expectedHash) errors.push(`contract ${contractPath} is missing from manifest`);
    else if (expectedHash !== actualHash) errors.push(`contract drift: ${contractPath}`);
  }
  for (const contractPath of expected.keys()) {
    if (!actual.has(contractPath)) errors.push(`manifest has unknown contract ${contractPath}`);
  }
}

function checkSchema(
  inventory: BaselineInventory,
  manifest: BaselineManifest,
  errors: string[],
): void {
  checkRuleNameMembership('schema', manifest.schemaObjects, errors);
  const ruleIds = new Set<string>();
  for (const rule of manifest.schemaObjects) {
    if (ruleIds.has(rule.id)) errors.push(`duplicate schema disposition id ${rule.id}`);
    ruleIds.add(rule.id);
  }
  for (const object of inventory.schema) {
    const matches = manifest.schemaObjects.filter(
      (rule) => rule.kind === object.kind && ruleMatchesName(rule, object.name),
    );
    if (matches.length === 0)
      errors.push(`schema ${object.kind}:${object.name} has no disposition rule`);
    else if (matches.length > 1)
      errors.push(`schema ${object.kind}:${object.name} has ${matches.length} disposition rules`);
  }
  for (const rule of manifest.schemaObjects) {
    for (const name of namesFor(rule.name)) {
      if (!inventory.schema.some((object) => object.kind === rule.kind && object.name === name)) {
        errors.push(`stale schema disposition rule ${rule.kind}:${name}`);
      }
    }
  }
  const tableObjects = inventory.schema.filter(
    (item) => item.kind === 'table' || item.kind === 'virtual_table',
  );
  const policies = new Map<string, ColumnPolicy[]>();
  for (const policy of manifest.columns) {
    for (const table of namesFor(policy.table)) {
      policies.set(table, [...(policies.get(table) ?? []), policy]);
    }
    const columns = new Set<string>();
    for (const override of policy.overrides) {
      if (columns.has(override.column))
        errors.push(`column policy ${policy.table} duplicates ${override.column}`);
      columns.add(override.column);
    }
  }
  for (const table of tableObjects) {
    const tablePolicies = policies.get(table.name) ?? [];
    if (tablePolicies.length !== 1) {
      errors.push(`schema columns ${table.name} have ${tablePolicies.length} policies`);
      continue;
    }
    const policy = tablePolicies[0];
    for (const override of policy.overrides) {
      if (!table.columns.includes(override.column))
        errors.push(`column policy ${table.name}.${override.column} is stale`);
    }
    for (const column of table.columns) {
      const overrides = policy.overrides.filter((override) => override.column === column);
      if (overrides.length > 1)
        errors.push(`schema column ${table.name}.${column} has ${overrides.length} overrides`);
      else if (overrides.length === 0 && !policy.default)
        errors.push(`schema column ${table.name}.${column} has no disposition`);
    }
  }
  for (const tableName of policies.keys()) {
    if (!tableObjects.some((table) => table.name === tableName))
      errors.push(`stale column policy ${tableName}`);
  }
}

export function checkInventory(inventory: BaselineInventory, manifest: BaselineManifest): string[] {
  const errors: string[] = [];
  for (const [label, rules] of [
    ['schema', manifest.schemaObjects],
    ['tool', manifest.tools],
    ['model tool', manifest.modelTools],
    ['IPC channel', manifest.channels],
    ['route', manifest.routes],
    ['localStorage key', manifest.localStorage],
  ] as const) {
    for (const rule of rules) {
      if (namesFor(rule.name).includes('*'))
        errors.push(`${label} disposition ${rule.id} must not use wildcard`);
    }
  }
  checkContractManifest(inventory, manifest, errors);
  for (const [section, hash] of Object.entries(inventoryHashes(inventory)) as Array<
    [keyof BaselineManifest['inventoryHashes'], string]
  >) {
    if (manifest.inventoryHashes[section] !== hash) errors.push(`inventory drift: ${section}`);
  }
  checkSchema(inventory, manifest, errors);
  for (const [label, items, rules] of [
    ['tool', inventory.tools, manifest.tools],
    ['model tool', inventory.modelTools, manifest.modelTools],
    ['IPC channel', inventory.channels, manifest.channels],
    ['route', inventory.routes, manifest.routes],
    ['localStorage key', inventory.localStorage, manifest.localStorage],
  ] as const) {
    checkRuleNameMembership(label, rules, errors);
    const ids = new Set<string>();
    for (const rule of rules) {
      if (ids.has(rule.id)) errors.push(`duplicate ${label} disposition id ${rule.id}`);
      ids.add(rule.id);
    }
    for (const item of items) matchExactlyOne(item, rules, label, errors);
    for (const rule of rules) {
      for (const name of namesFor(rule.name)) {
        if (!items.some((item) => item.name === name)) {
          errors.push(`stale ${label} disposition rule ${name}`);
        }
      }
    }
  }
  return errors;
}

export async function checkBaseline(
  repoRoot: string,
  manifestPath = 'scripts/i0-baseline.manifest.json',
): Promise<BaselineCheckResult> {
  const inventory = await collectInventory(repoRoot);
  const manifest = JSON.parse(
    await readFile(path.join(repoRoot, manifestPath), 'utf8'),
  ) as BaselineManifest;
  const errors = checkInventory(inventory, manifest);
  return { ok: errors.length === 0, inventory, errors };
}

function canonicalValue(value: unknown): string {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError('Canonical JSON cannot contain a non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      compareText(a, b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalValue(item)}`).join(',')}}`;
  }
  throw new TypeError(`Canonical JSON cannot contain ${typeof value}`);
}

export function canonicalJson(value: unknown): string {
  return canonicalValue(value);
}

export interface FixtureWriteResult {
  directory: string;
  files: Array<{ name: string; sha256: string }>;
  manifestSha256: string;
}

const FIXTURE_SCHEMA = 'lucid-fin.i0-synthetic-fixture/v1';
const FIXTURE_TIMESTAMP = 1_750_000_000_000;
const FIXTURE_MEDIA_CONTENT = 'lucid-fin synthetic media fixture v1';
const FIXTURE_MEDIA_HASH = sha256(FIXTURE_MEDIA_CONTENT);
const FIXTURE_MEDIA_BASE64 = Buffer.from(FIXTURE_MEDIA_CONTENT, 'utf8').toString('base64');

const SYNTHETIC_FIXTURES: Record<string, unknown> = {
  'empty-install': {
    schema: FIXTURE_SCHEMA,
    kind: 'empty_install',
    source: {
      databases: { main: { tables: {} }, prompts: { tables: {} } },
      cas: { files: [] },
      rendererLocalStorage: {},
    },
    expected: { projectCount: 0, chatCount: 0, mediaBlobCount: 0, credentialCount: 0 },
  },
  'representative-legacy-project-canvas': {
    schema: FIXTURE_SCHEMA,
    kind: 'representative_legacy_project_canvas',
    source: {
      databases: {
        main: {
          asset_contents: [
            {
              hash: FIXTURE_MEDIA_HASH,
              file_size: Buffer.byteLength(FIXTURE_MEDIA_CONTENT, 'utf8'),
              type: 'image',
            },
          ],
          asset_entries: [{ id: 'asset.demo', asset_hash: FIXTURE_MEDIA_HASH, folder_id: null }],
          canvases: [
            {
              id: 'canvas.demo',
              name: 'Synthetic Project',
              archived_at: null,
              created_at: FIXTURE_TIMESTAMP,
              updated_at: FIXTURE_TIMESTAMP + 1,
            },
          ],
          canvas_nodes: [
            {
              id: 'node.image',
              canvas_id: 'canvas.demo',
              type: 'image',
              data: { assetHash: FIXTURE_MEDIA_HASH },
            },
            {
              id: 'node.text',
              canvas_id: 'canvas.demo',
              type: 'text',
              data: { text: 'Synthetic note' },
            },
            {
              id: 'node.backdrop',
              canvas_id: 'canvas.demo',
              type: 'backdrop',
              data: { label: 'Synthetic scene' },
            },
          ],
          characters: [
            {
              id: 'character.lead',
              name: 'Synthetic Lead',
              ref_image: FIXTURE_MEDIA_HASH,
            },
          ],
          commander_sessions: [
            {
              id: 'chat.demo',
              default_canvas_id: 'canvas.demo',
              messages: [
                { id: 'message.user.1', role: 'user', content: 'Create a synthetic scene.' },
                { id: 'message.assistant.1', role: 'assistant', content: 'Synthetic response.' },
              ],
            },
          ],
          task_lists: [
            {
              id: 'task-list.demo',
              entity_id: 'canvas.demo',
              entity_type: 'canvas',
              status: 'completed',
            },
          ],
          tasks: [
            {
              id: 'task.demo',
              task_list_id: 'task-list.demo',
              status: 'completed',
            },
          ],
          delivery_asset_refs: [{ canvas_id: 'canvas.demo', asset_hash: FIXTURE_MEDIA_HASH }],
        },
        prompts: { process_prompts: [], t_prompt_overrides: [] },
      },
      cas: {
        files: [
          {
            relativePath: `cas/${FIXTURE_MEDIA_HASH}`,
            byteLength: Buffer.byteLength(FIXTURE_MEDIA_CONTENT, 'utf8'),
            contentBase64: FIXTURE_MEDIA_BASE64,
            sha256: FIXTURE_MEDIA_HASH,
          },
        ],
      },
    },
    expected: {
      projectId: 'canvas.demo',
      canvasId: 'canvas.demo',
      chatId: 'chat.demo',
      mediaBlobIds: [FIXTURE_MEDIA_HASH],
      blockingFindings: [],
    },
  },
  'missing-media': {
    schema: FIXTURE_SCHEMA,
    kind: 'missing_media',
    source: {
      assetContents: [
        {
          hash: FIXTURE_MEDIA_HASH,
          file_size: Buffer.byteLength(FIXTURE_MEDIA_CONTENT, 'utf8'),
        },
      ],
      assetEntries: [{ id: 'asset.missing', asset_hash: FIXTURE_MEDIA_HASH }],
      cas: { files: [] },
    },
    expected: {
      disposition: 'blocking_error',
      blockerCode: 'missing_media_blob_bytes',
      sourceRemainsUnchanged: true,
    },
  },
  'provider-unknown': {
    schema: FIXTURE_SCHEMA,
    kind: 'provider_unknown',
    source: {
      taskAttempts: [
        {
          id: 'attempt.provider-unknown',
          kind: 'production_media',
          status: 'submitting',
          idempotency_key: 'fixture-provider-unknown',
          provider_id: 'provider.synthetic',
          provider_job_id: null,
          provider_receipt: null,
          submitted_at: null,
        },
      ],
    },
    expected: {
      operationState: 'unknown',
      automaticRetryAllowed: false,
      blockerCode: 'unknown_provider_submission',
    },
  },
  'protected-choice': {
    schema: FIXTURE_SCHEMA,
    kind: 'protected_choice',
    source: {
      userChoice: {
        id: 'choice.primary-result',
        projectId: 'canvas.demo',
        selectedResultId: 'result.selected',
        revision: 3,
        actor: 'user',
        causation: { kind: 'message', id: 'message.user.choice' },
      },
      protection: { subjectId: 'result.selected', protected: true, revision: 2 },
      requestedMutation: { kind: 'replace_primary_result', resultId: 'result.other' },
    },
    expected: {
      confirmationMode: 'exact_protected',
      mutationBeforeConfirmation: false,
    },
  },
  'corrupt-drift': {
    schema: FIXTURE_SCHEMA,
    kind: 'corrupt_unsupported_drift',
    source: {
      schemaDrift: { table: 'canvases', extraColumn: 'unsupported_extra' },
      foreignKeyViolation: { table: 'canvas_nodes', column: 'canvas_id', value: 'canvas.missing' },
      mediaHashMismatch: {
        declaredHash: 'a'.repeat(64),
        observedHash: 'b'.repeat(64),
      },
      sequenceGap: { table: 'commander_events', expectedSequence: 2, observedSequence: 3 },
    },
    expected: {
      stopBeforeWrites: true,
      sourceRemainsUnchanged: true,
      blockerCodes: [
        'unsupported_source_schema',
        'legacy_foreign_key_violation',
        'media_blob_hash_mismatch',
        'legacy_event_sequence_gap',
      ],
    },
  },
};

export async function writeSyntheticFixtures(destination: string): Promise<FixtureWriteResult> {
  const directory = path.join(path.resolve(destination), 'i0-baseline-fixtures');
  await mkdir(directory, { recursive: true });
  const files: Array<{ name: string; sha256: string }> = [];
  for (const [name, fixture] of Object.entries(SYNTHETIC_FIXTURES).sort(([a], [b]) =>
    compareText(a, b),
  )) {
    const content = `${canonicalJson(fixture)}\n`;
    await writeFile(path.join(directory, `${name}.json`), content, 'utf8');
    files.push({ name: `${name}.json`, sha256: sha256(content) });
  }
  return { directory, files, manifestSha256: sha256(canonicalJson(files)) };
}

function printInventory(inventory: BaselineInventory): void {
  process.stdout.write(`${canonicalJson(inventory)}\n`);
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
  const fixtureIndex = process.argv.indexOf('--fixtures');
  if (fixtureIndex !== -1) {
    const destination = process.argv[fixtureIndex + 1];
    if (!destination) throw new Error('--fixtures requires a caller-provided temporary directory');
    const result = await writeSyntheticFixtures(destination);
    process.stdout.write(
      `i0-baseline: wrote ${result.files.length} synthetic fixtures to ${result.directory}\n`,
    );
  }
  if (process.argv.includes('--inventory')) {
    printInventory(await collectInventory(repoRoot));
    return;
  }
  if (process.argv.includes('--hashes')) {
    process.stdout.write(`${canonicalJson(inventoryHashes(await collectInventory(repoRoot)))}\n`);
    return;
  }
  if (!process.argv.includes('--check')) {
    throw new Error(
      'usage: pnpm exec tsx scripts/i0-baseline.ts --check [--fixtures <temporary-directory>]',
    );
  }
  const result = await checkBaseline(repoRoot);
  if (!result.ok) {
    for (const error of result.errors) process.stderr.write(`i0-baseline: ${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `i0-baseline: OK — ${result.inventory.schema.length} schema objects, ${result.inventory.tools.length} tools, ${result.inventory.modelTools.length} model tools, ${result.inventory.channels.length} IPC channels, ${result.inventory.routes.length} routes, ${result.inventory.localStorage.length} localStorage keys.\n`,
  );
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `i0-baseline: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  });
}
