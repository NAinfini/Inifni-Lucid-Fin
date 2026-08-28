import { open, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ProductionClosureViolationKind =
  'configuration' | 'forbidden' | 'missing' | 'package' | 'unresolved';

export interface ProductionClosureViolation {
  readonly kind: ProductionClosureViolationKind;
  readonly location: string;
  readonly message: string;
}

export interface ProductionClosureResult {
  readonly ok: boolean;
  readonly violations: readonly ProductionClosureViolation[];
}

export interface ProductionClosureOptions {
  readonly repositoryRoot?: string;
  readonly requirePackage?: boolean;
}

interface JsonRecord {
  readonly [key: string]: unknown;
}

interface WorkspacePackage {
  readonly name: string;
  readonly root: string;
  readonly manifest: JsonRecord;
}

interface AsarFile {
  readonly size?: number;
  readonly offset?: string;
  readonly unpacked?: boolean;
  readonly files?: Readonly<Record<string, AsarFile>>;
}

interface AsarArchive {
  readonly archivePath: string;
  readonly headerSize: number;
  readonly files: ReadonlyMap<string, AsarFile>;
}

const MAIN_ENTRY = 'dist/electron.js';
const PRELOAD_ENTRY = 'dist/preload.cjs';
const RENDERER_ENTRY = 'index.html';
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.cts', '.mts', '.js', '.cjs', '.mjs'] as const;
const TEXT_EXTENSIONS = new Set(['.cjs', '.css', '.html', '.js', '.json', '.map', '.mjs']);

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function displayPath(repositoryRoot: string, value: string): string {
  const path = relative(repositoryRoot, value).replaceAll('\\', '/');
  return path === '' ? '.' : path;
}

function addViolation(
  violations: ProductionClosureViolation[],
  kind: ProductionClosureViolationKind,
  repositoryRoot: string,
  location: string,
  message: string,
): void {
  violations.push({ kind, location: displayPath(repositoryRoot, location), message });
}

async function isDirectory(value: string): Promise<boolean> {
  return stat(value).then(
    (entry) => entry.isDirectory(),
    () => false,
  );
}

async function isFile(value: string): Promise<boolean> {
  return stat(value).then(
    (entry) => entry.isFile(),
    () => false,
  );
}

function isInside(root: string, value: string): boolean {
  const path = relative(root, value);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function isForbiddenReference(value: string): boolean {
  const normalized = value.replaceAll('\\', '/').toLowerCase();
  if (
    (normalized.startsWith('@') && !normalized.startsWith('@lucid-fin/')) ||
    (normalized.includes('node_modules/') && !normalized.includes('node_modules/@lucid-fin/'))
  ) {
    return false;
  }
  return /(?:^|[/._-])(?:target(?:[-_.]?rc)?|legacy|migration)(?:$|[/._-])/u.test(normalized);
}

function extractSpecifiers(source: string): readonly string[] {
  const values = new Set<string>();
  const patterns = [
    /\bfrom\s*['"]([^'"]+)['"]/gu,
    /\bimport\s*['"]([^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/gu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) values.add(match[1]!);
  }
  return [...values];
}

function moduleScriptSources(document: string): readonly string[] {
  const sources: string[] = [];
  for (const tag of document.matchAll(/<script\b[^>]*>/giu)) {
    if (!/\btype\s*=\s*['"]module['"]/iu.test(tag[0])) continue;
    const source = /\bsrc\s*=\s*['"]([^'"]+)['"]/iu.exec(tag[0])?.[1];
    if (source !== undefined) sources.push(source);
  }
  return sources;
}

async function readJson(
  path: string,
  repositoryRoot: string,
  violations: ProductionClosureViolation[],
): Promise<JsonRecord | undefined> {
  try {
    const value: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (isRecord(value)) return value;
    addViolation(violations, 'configuration', repositoryRoot, path, 'must contain a JSON object');
  } catch {
    addViolation(violations, 'missing', repositoryRoot, path, 'is required and readable');
  }
  return undefined;
}

function stringsIn(value: unknown): readonly string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (isRecord(value)) return Object.values(value).flatMap(stringsIn);
  return [];
}

function checkForbiddenStrings(
  value: unknown,
  location: string,
  repositoryRoot: string,
  violations: ProductionClosureViolation[],
): void {
  for (const text of stringsIn(value)) {
    if (isForbiddenReference(text)) {
      addViolation(
        violations,
        'forbidden',
        repositoryRoot,
        location,
        `references disabled path ${text}`,
      );
    }
  }
}

async function listFiles(root: string): Promise<readonly string[]> {
  if (!(await isDirectory(root))) return [];
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await visit(root);
  return files;
}

async function sourceFileFor(path: string): Promise<string | undefined> {
  const directCandidates = [path];
  const extension = extname(path);
  if (['.js', '.cjs', '.mjs'].includes(extension)) {
    const withoutExtension = path.slice(0, -extension.length);
    directCandidates.push(...SOURCE_EXTENSIONS.map((candidate) => withoutExtension + candidate));
  } else if (extension === '') {
    directCandidates.push(...SOURCE_EXTENSIONS.map((candidate) => path + candidate));
    directCandidates.push(...SOURCE_EXTENSIONS.map((candidate) => join(path, 'index' + candidate)));
  }
  for (const candidate of directCandidates) {
    if (await isFile(candidate)) return candidate;
  }
  return undefined;
}

async function loadWorkspacePackages(
  repositoryRoot: string,
): Promise<ReadonlyMap<string, WorkspacePackage>> {
  const packages = new Map<string, WorkspacePackage>();
  for (const container of ['apps', 'packages']) {
    const directory = join(repositoryRoot, container);
    if (!(await isDirectory(directory))) continue;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const root = join(directory, entry.name);
      const manifestPath = join(root, 'package.json');
      if (!(await isFile(manifestPath))) continue;
      try {
        const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
        if (isRecord(manifest) && typeof manifest.name === 'string') {
          packages.set(manifest.name, { name: manifest.name, root, manifest });
        }
      } catch {
        // The production manifests are checked separately; an unrelated workspace is not a closure entry.
      }
    }
  }
  return packages;
}

function packageNameFor(specifier: string): string | undefined {
  const segments = specifier.split('/');
  if (!specifier.startsWith('@') || segments.length < 2) return undefined;
  return segments.slice(0, 2).join('/');
}

function packageExportTarget(manifest: JsonRecord, subpath: string): string | undefined {
  const exportsValue = manifest.exports;
  const exportEntry =
    isRecord(exportsValue) && subpath in exportsValue
      ? exportsValue[subpath]
      : subpath === '.'
        ? manifest.main
        : undefined;
  if (typeof exportEntry === 'string') return exportEntry;
  if (!isRecord(exportEntry)) return undefined;
  return typeof exportEntry.import === 'string'
    ? exportEntry.import
    : typeof exportEntry.default === 'string'
      ? exportEntry.default
      : undefined;
}

async function workspaceSourceFor(
  specifier: string,
  workspacePackages: ReadonlyMap<string, WorkspacePackage>,
): Promise<string | undefined> {
  const packageName = packageNameFor(specifier);
  if (packageName === undefined) return undefined;
  const workspacePackage = workspacePackages.get(packageName);
  if (workspacePackage === undefined) return undefined;
  const subpath = specifier === packageName ? '.' : './' + specifier.slice(packageName.length + 1);
  const target = packageExportTarget(workspacePackage.manifest, subpath);
  if (target === undefined) return undefined;
  const normalizedTarget = target.startsWith('./') ? target.slice(2) : target;
  const sourcePath = normalizedTarget.startsWith('dist/')
    ? join(workspacePackage.root, 'src', normalizedTarget.slice('dist/'.length))
    : join(workspacePackage.root, normalizedTarget);
  return sourceFileFor(sourcePath);
}

async function walkSourceClosure(
  entry: string,
  repositoryRoot: string,
  workspacePackages: ReadonlyMap<string, WorkspacePackage>,
  violations: ProductionClosureViolation[],
): Promise<void> {
  const visited = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    const resolved = resolve(path);
    if (visited.has(resolved)) return;
    visited.add(resolved);
    if (!isInside(repositoryRoot, resolved)) {
      addViolation(violations, 'unresolved', repositoryRoot, resolved, 'escapes the repository');
      return;
    }
    if (isForbiddenReference(displayPath(repositoryRoot, resolved))) {
      addViolation(
        violations,
        'forbidden',
        repositoryRoot,
        resolved,
        'is a disabled production path',
      );
      return;
    }
    let source: string;
    try {
      source = await readFile(resolved, 'utf8');
    } catch {
      addViolation(violations, 'missing', repositoryRoot, resolved, 'is a required source entry');
      return;
    }
    for (const specifier of extractSpecifiers(source)) {
      if (isForbiddenReference(specifier)) {
        addViolation(
          violations,
          'forbidden',
          repositoryRoot,
          resolved,
          `imports disabled path ${specifier}`,
        );
        continue;
      }
      if (specifier.startsWith('.')) {
        const target = await sourceFileFor(resolve(dirname(resolved), specifier));
        if (target === undefined) {
          addViolation(
            violations,
            'unresolved',
            repositoryRoot,
            resolved,
            `cannot resolve ${specifier}`,
          );
        } else {
          await visit(target);
        }
        continue;
      }
      if (specifier.startsWith('@lucid-fin/')) {
        const target = await workspaceSourceFor(specifier, workspacePackages);
        if (target === undefined) {
          addViolation(
            violations,
            'unresolved',
            repositoryRoot,
            resolved,
            `cannot resolve ${specifier}`,
          );
        } else {
          await visit(target);
        }
      }
    }
  };
  await visit(entry);
}

async function checkSourceConfiguration(
  repositoryRoot: string,
  violations: ProductionClosureViolation[],
): Promise<readonly string[]> {
  const mainRoot = join(repositoryRoot, 'apps', 'desktop-main');
  const rendererRoot = join(repositoryRoot, 'apps', 'desktop-renderer');
  const packagePath = join(mainRoot, 'package.json');
  const builderPath = join(mainRoot, 'electron-builder.json');
  const mainTsconfigPath = join(mainRoot, 'tsconfig.json');
  const preloadTsconfigPath = join(mainRoot, 'tsconfig.preload.json');
  const rendererIndexPath = join(rendererRoot, RENDERER_ENTRY);
  const [desktopPackage, builder, mainTsconfig, preloadTsconfig] = await Promise.all([
    readJson(packagePath, repositoryRoot, violations),
    readJson(builderPath, repositoryRoot, violations),
    readJson(mainTsconfigPath, repositoryRoot, violations),
    readJson(preloadTsconfigPath, repositoryRoot, violations),
  ]);

  if (desktopPackage !== undefined) {
    if (desktopPackage.main !== MAIN_ENTRY) {
      addViolation(
        violations,
        'configuration',
        repositoryRoot,
        packagePath,
        `main must be ${MAIN_ENTRY}`,
      );
    }
    checkForbiddenStrings(desktopPackage, packagePath, repositoryRoot, violations);
  }
  if (builder !== undefined) {
    const files = Array.isArray(builder.files) ? builder.files : [];
    const resources = Array.isArray(builder.extraResources) ? builder.extraResources : [];
    const shipsMain = files.some((entry) => entry === 'dist/**/*');
    const shipsRenderer = resources.some(
      (entry) =>
        isRecord(entry) && entry.from === '../desktop-renderer/dist' && entry.to === 'renderer',
    );
    if (!shipsMain || !shipsRenderer) {
      addViolation(
        violations,
        'configuration',
        repositoryRoot,
        builderPath,
        'must ship canonical dist and renderer resources',
      );
    }
    checkForbiddenStrings(builder, builderPath, repositoryRoot, violations);
  }
  if (mainTsconfig !== undefined) {
    const includes = Array.isArray(mainTsconfig.include) ? mainTsconfig.include : [];
    if (!includes.includes('src')) {
      addViolation(
        violations,
        'configuration',
        repositoryRoot,
        mainTsconfigPath,
        'must include src',
      );
    }
    checkForbiddenStrings(mainTsconfig, mainTsconfigPath, repositoryRoot, violations);
  }
  if (preloadTsconfig !== undefined) {
    const includes = Array.isArray(preloadTsconfig.include) ? preloadTsconfig.include : [];
    if (includes.length !== 1 || includes[0] !== 'src/preload.cts') {
      addViolation(
        violations,
        'configuration',
        repositoryRoot,
        preloadTsconfigPath,
        'must compile only src/preload.cts as the preload entry',
      );
    }
    checkForbiddenStrings(preloadTsconfig, preloadTsconfigPath, repositoryRoot, violations);
  }

  let rendererIndex: string | undefined;
  try {
    rendererIndex = await readFile(rendererIndexPath, 'utf8');
  } catch {
    addViolation(violations, 'missing', repositoryRoot, rendererIndexPath, 'is the renderer entry');
  }
  if (rendererIndex !== undefined) {
    const sources = moduleScriptSources(rendererIndex);
    if (sources.length !== 1 || sources[0] !== '/src/main.tsx') {
      addViolation(
        violations,
        'configuration',
        repositoryRoot,
        rendererIndexPath,
        'must have exactly one canonical /src/main.tsx module entry',
      );
    }
    for (const source of sources) {
      if (isForbiddenReference(source)) {
        addViolation(violations, 'forbidden', repositoryRoot, rendererIndexPath, `loads ${source}`);
      }
    }
  }

  const entries = [
    join(mainRoot, 'src', 'electron.ts'),
    join(mainRoot, 'src', 'preload.cts'),
    join(rendererRoot, 'src', 'main.tsx'),
  ];
  for (const entry of entries) {
    if (!(await isFile(entry))) {
      addViolation(violations, 'missing', repositoryRoot, entry, 'is a canonical source entry');
    }
  }
  return entries;
}

async function scanTree(
  root: string,
  repositoryRoot: string,
  violations: ProductionClosureViolation[],
): Promise<void> {
  for (const path of await listFiles(root)) {
    if (isForbiddenReference(displayPath(root, path))) {
      addViolation(violations, 'forbidden', repositoryRoot, path, 'is a disabled emitted path');
    }
    if (!TEXT_EXTENSIONS.has(extname(path).toLowerCase())) continue;
    try {
      const text = await readFile(path, 'utf8');
      for (const specifier of extractSpecifiers(text)) {
        if (isForbiddenReference(specifier)) {
          addViolation(
            violations,
            'forbidden',
            repositoryRoot,
            path,
            `references disabled path ${specifier}`,
          );
        }
      }
    } catch {
      addViolation(violations, 'missing', repositoryRoot, path, 'cannot be scanned');
    }
  }
}

async function checkBuiltOutput(
  repositoryRoot: string,
  violations: ProductionClosureViolation[],
): Promise<void> {
  const mainDist = join(repositoryRoot, 'apps', 'desktop-main', 'dist');
  if (await isDirectory(mainDist)) {
    for (const entry of [MAIN_ENTRY.slice('dist/'.length), PRELOAD_ENTRY.slice('dist/'.length)]) {
      const path = join(mainDist, entry);
      if (!(await isFile(path))) {
        addViolation(violations, 'missing', repositoryRoot, path, 'is a canonical built asset');
      }
    }
    await scanTree(mainDist, repositoryRoot, violations);
  }

  const rendererDist = join(repositoryRoot, 'apps', 'desktop-renderer', 'dist');
  const rendererIndexPath = join(rendererDist, RENDERER_ENTRY);
  if (await isDirectory(rendererDist)) {
    if (!(await isFile(rendererIndexPath))) {
      addViolation(
        violations,
        'missing',
        repositoryRoot,
        rendererIndexPath,
        'is a canonical built renderer asset',
      );
    } else {
      const sources = moduleScriptSources(await readFile(rendererIndexPath, 'utf8'));
      if (sources.length !== 1) {
        addViolation(
          violations,
          'configuration',
          repositoryRoot,
          rendererIndexPath,
          'must have one emitted module entry',
        );
      }
      for (const source of sources) {
        if (isForbiddenReference(source)) {
          addViolation(
            violations,
            'forbidden',
            repositoryRoot,
            rendererIndexPath,
            `loads ${source}`,
          );
          continue;
        }
        const asset = resolve(dirname(rendererIndexPath), source);
        if (!isInside(rendererDist, asset) || !(await isFile(asset))) {
          addViolation(
            violations,
            'missing',
            repositoryRoot,
            rendererIndexPath,
            `emitted module ${source} is unavailable`,
          );
        }
      }
    }
    await scanTree(rendererDist, repositoryRoot, violations);
  }
}

async function readAsarArchive(archivePath: string): Promise<AsarArchive> {
  const handle = await open(archivePath, 'r');
  try {
    const sizeBuffer = Buffer.alloc(8);
    if ((await handle.read(sizeBuffer, 0, sizeBuffer.length, 0)).bytesRead !== sizeBuffer.length) {
      throw new Error('cannot read ASAR header size');
    }
    const headerSize = sizeBuffer.readUInt32LE(4);
    if (headerSize < 8 || headerSize > 64 * 1024 * 1024)
      throw new Error('invalid ASAR header size');
    const headerBuffer = Buffer.alloc(headerSize);
    if ((await handle.read(headerBuffer, 0, headerSize, 8)).bytesRead !== headerSize) {
      throw new Error('cannot read ASAR header');
    }
    const payloadSize = headerBuffer.readUInt32LE(0);
    const textSize = headerBuffer.readUInt32LE(4);
    if (payloadSize < 4 || textSize > payloadSize - 4 || textSize > headerSize - 8) {
      throw new Error('invalid ASAR header payload');
    }
    const header: unknown = JSON.parse(headerBuffer.subarray(8, 8 + textSize).toString('utf8'));
    if (!isRecord(header) || !isRecord(header.files)) throw new Error('ASAR has no file table');
    const files = new Map<string, AsarFile>();
    const visit = (directory: Readonly<Record<string, AsarFile>>, prefix: string): void => {
      for (const [name, entry] of Object.entries(directory)) {
        if (!isRecord(entry)) throw new Error('invalid ASAR file table');
        const file = entry as AsarFile;
        const path = prefix === '' ? name : `${prefix}/${name}`;
        if (file.files !== undefined) visit(file.files, path);
        else files.set(path, file);
      }
    };
    visit(header.files as Readonly<Record<string, AsarFile>>, '');
    return { archivePath, headerSize, files };
  } finally {
    await handle.close();
  }
}

async function readAsarText(archive: AsarArchive, path: string): Promise<string> {
  const file = archive.files.get(path);
  if (file === undefined || typeof file.size !== 'number' || typeof file.offset !== 'string') {
    throw new Error(`${path} is absent from the ASAR`);
  }
  if (file.unpacked) return readFile(join(`${archive.archivePath}.unpacked`, path), 'utf8');
  const offset = Number(file.offset);
  if (!Number.isSafeInteger(offset) || offset < 0 || file.size < 0)
    throw new Error('invalid ASAR file offset');
  const handle = await open(archive.archivePath, 'r');
  try {
    const content = Buffer.alloc(file.size);
    if (
      (await handle.read(content, 0, file.size, 8 + archive.headerSize + offset)).bytesRead !==
      file.size
    ) {
      throw new Error(`cannot read ${path} from the ASAR`);
    }
    return content.toString('utf8');
  } finally {
    await handle.close();
  }
}

function currentUnpackedDirectoryNames(): readonly string[] {
  if (process.platform === 'darwin') {
    return [`mac-${process.arch}`, 'mac', `mac-${process.arch}-unpacked`, 'mac-unpacked'];
  }
  const prefix = process.platform === 'win32' ? 'win' : 'linux';
  return [`${prefix}-${process.arch}-unpacked`, `${prefix}-unpacked`];
}

async function currentPackageRoot(repositoryRoot: string): Promise<string | undefined> {
  const releaseRoot = join(repositoryRoot, 'apps', 'desktop-main', 'release');
  for (const name of currentUnpackedDirectoryNames()) {
    const candidate = join(releaseRoot, name);
    if (await isDirectory(candidate)) return candidate;
  }
  return undefined;
}

async function resourceDirectory(packageRoot: string): Promise<string | undefined> {
  const direct = join(packageRoot, 'resources');
  if (await isDirectory(direct)) return direct;
  if (process.platform !== 'darwin') return undefined;
  for (const entry of await readdir(packageRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('.app')) continue;
    const candidate = join(packageRoot, entry.name, 'Contents', 'Resources');
    if (await isDirectory(candidate)) return candidate;
  }
  return undefined;
}

async function checkPackagedOutput(
  repositoryRoot: string,
  violations: ProductionClosureViolation[],
): Promise<void> {
  const packageRoot = await currentPackageRoot(repositoryRoot);
  if (packageRoot === undefined) {
    addViolation(
      violations,
      'package',
      repositoryRoot,
      join(repositoryRoot, 'apps', 'desktop-main', 'release'),
      'current-platform unpacked Electron package is required',
    );
    return;
  }
  const resources = await resourceDirectory(packageRoot);
  if (resources === undefined) {
    addViolation(violations, 'package', repositoryRoot, packageRoot, 'has no resources directory');
    return;
  }
  const archivePath = join(resources, 'app.asar');
  if (!(await isFile(archivePath))) {
    addViolation(violations, 'package', repositoryRoot, archivePath, 'is required');
    return;
  }

  let archive: AsarArchive;
  try {
    archive = await readAsarArchive(archivePath);
  } catch (cause) {
    addViolation(
      violations,
      'package',
      repositoryRoot,
      archivePath,
      cause instanceof Error ? cause.message : 'cannot read ASAR',
    );
    return;
  }
  for (const path of archive.files.keys()) {
    if (isForbiddenReference(path)) {
      addViolation(
        violations,
        'forbidden',
        repositoryRoot,
        archivePath,
        `contains disabled path ${path}`,
      );
    }
  }
  for (const path of ['package.json', MAIN_ENTRY, PRELOAD_ENTRY]) {
    if (!archive.files.has(path)) {
      addViolation(violations, 'missing', repositoryRoot, archivePath, `is missing ${path}`);
    }
  }
  try {
    const manifest: unknown = JSON.parse(await readAsarText(archive, 'package.json'));
    if (!isRecord(manifest) || manifest.main !== MAIN_ENTRY) {
      addViolation(
        violations,
        'configuration',
        repositoryRoot,
        archivePath,
        `package main must be ${MAIN_ENTRY}`,
      );
    } else {
      const sourceManifest = await readJson(
        join(repositoryRoot, 'apps', 'desktop-main', 'package.json'),
        repositoryRoot,
        violations,
      );
      if (
        sourceManifest !== undefined &&
        typeof sourceManifest.version === 'string' &&
        manifest.version !== sourceManifest.version
      ) {
        addViolation(
          violations,
          'configuration',
          repositoryRoot,
          archivePath,
          `package version must be ${sourceManifest.version}`,
        );
      }
    }
  } catch {
    addViolation(
      violations,
      'package',
      repositoryRoot,
      archivePath,
      'contains no readable package.json',
    );
  }

  const unpacked = `${archivePath}.unpacked`;
  await scanTree(unpacked, repositoryRoot, violations);

  const rendererRoot = join(resources, 'renderer');
  const rendererIndex = join(rendererRoot, RENDERER_ENTRY);
  if (!(await isFile(rendererIndex))) {
    addViolation(
      violations,
      'missing',
      repositoryRoot,
      rendererIndex,
      'is the packaged renderer asset',
    );
  } else {
    const sources = moduleScriptSources(await readFile(rendererIndex, 'utf8'));
    if (sources.length !== 1) {
      addViolation(
        violations,
        'configuration',
        repositoryRoot,
        rendererIndex,
        'must have one module entry',
      );
    }
    for (const source of sources) {
      if (isForbiddenReference(source)) {
        addViolation(violations, 'forbidden', repositoryRoot, rendererIndex, `loads ${source}`);
        continue;
      }
      const asset = resolve(dirname(rendererIndex), source);
      if (!isInside(rendererRoot, asset) || !(await isFile(asset))) {
        addViolation(
          violations,
          'missing',
          repositoryRoot,
          rendererIndex,
          `module ${source} is unavailable`,
        );
      }
    }
  }
  await scanTree(rendererRoot, repositoryRoot, violations);
}

export async function checkProductionClosure(
  options: ProductionClosureOptions = {},
): Promise<ProductionClosureResult> {
  const repositoryRoot = resolve(options.repositoryRoot ?? process.cwd());
  const violations: ProductionClosureViolation[] = [];
  const entries = await checkSourceConfiguration(repositoryRoot, violations);
  const workspacePackages = await loadWorkspacePackages(repositoryRoot);
  for (const entry of entries) {
    if (await isFile(entry))
      await walkSourceClosure(entry, repositoryRoot, workspacePackages, violations);
  }
  await checkBuiltOutput(repositoryRoot, violations);
  if (options.requirePackage) await checkPackagedOutput(repositoryRoot, violations);
  return Object.freeze({ ok: violations.length === 0, violations: Object.freeze(violations) });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--require-package')) {
    throw new Error('Usage: tsx scripts/check-production-closure.ts [--require-package]');
  }
  const result = await checkProductionClosure({
    requirePackage: args.includes('--require-package'),
  });
  if (result.ok) {
    console.log('production closure: OK');
    return;
  }
  for (const violation of result.violations) {
    console.error(`${violation.kind}: ${violation.location}: ${violation.message}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
