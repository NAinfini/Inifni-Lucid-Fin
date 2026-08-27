import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { builtinModules, createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build as viteBuild, loadConfigFromFile, mergeConfig, version as viteVersion } from 'vite';

export const TARGET_RC_CLOSURE_SCHEMA = 'lucid-fin.target-rc-closure/v3';
export const TARGET_RC_ENTRYPOINTS = Object.freeze([
  'apps/desktop-main/src/target/electron-entry.ts',
  'apps/desktop-main/src/target/preload.generated.cts',
  'apps/desktop-renderer/src/target-entry.tsx',
]);
export const TARGET_RC_RUNTIME_ENTRYPOINTS = Object.freeze([
  'apps/desktop-main/dist-target-rc/target/electron-entry.js',
  'apps/desktop-main/dist-target-rc/target/preload.generated.cjs',
  'apps/desktop-renderer/dist-target-rc/index.html',
  'apps/desktop-renderer/dist-target-rc/assets/target-entry.js',
]);

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.cts', '.mts', '.js', '.jsx'] as const;
const RUNTIME_EXTENSIONS = ['.js', '.mjs', '.cjs', '.css', '.html'] as const;
const PARSEABLE_EXTENSIONS = new Set([...SOURCE_EXTENSIONS, '.mjs', '.cjs']);
const TARGET_RC_TYPE_SCRIPT_CONFIGURATIONS = Object.freeze([
  'packages/target-contracts/tsconfig.json',
  'packages/target-storage/tsconfig.json',
  'packages/target-runtime/tsconfig.json',
  'apps/desktop-main/tsconfig.target-rc.json',
  'apps/desktop-main/tsconfig.target-rc-preload.json',
  'apps/desktop-renderer/tsconfig.target-rc.json',
]);
const TARGET_RC_PACKAGE_MANIFESTS = Object.freeze([
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'apps/desktop-main/package.json',
  'apps/desktop-renderer/package.json',
  'packages/target-contracts/package.json',
  'packages/target-runtime/package.json',
  'packages/target-storage/package.json',
  'apps/desktop-renderer/vite.target-rc.config.ts',
]);
// These are the only toolchain-owned virtual modules emitted by the pinned Vite/Rolldown build.
const VITE_INTERNAL_MODULE_IDS = new Set(['\0rolldown/runtime.js', '\0vite/preload-helper.js']);
// The configuration source and its evaluated plugin objects are executable inputs. Both must match
// this approved contract before Vite sees the isolated Target RC build.
const TARGET_RC_VITE_CONFIGURATION_SHA256 =
  '98d5b07d4f69127c40f98ce2c383897b4f75ea87a6c2ad9d8d7a8c0ba4f80f59';
const TARGET_RC_VITE_CONFIGURATION_IMPORTS = new Set([
  'node:path',
  'node:url',
  '@vitejs/plugin-react',
  'vite',
]);
const TARGET_RC_VITE_PLUGIN_CONTRACT = Object.freeze([
  {
    name: 'vite:react-babel',
    properties: ['config', 'configResolved', 'enforce', 'name', 'options'],
  },
  {
    name: 'vite:react:refresh-wrapper',
    properties: ['apply', 'applyToEnvironment', 'name'],
  },
  { name: 'vite:react:config-post', properties: ['config', 'enforce', 'name'] },
  { name: 'vite:react-refresh-fbm', properties: ['enforce', 'name', 'transformIndexHtml'] },
  {
    name: 'vite:react-refresh',
    properties: ['config', 'enforce', 'load', 'name', 'resolveId', 'transformIndexHtml'],
  },
  { name: 'vite:react-virtual-preamble', properties: ['load', 'name', 'resolveId'] },
  { name: 'target-rc-html', properties: ['generateBundle', 'name'] },
]);
const VITE_PLUGIN_HOOK_NAMES = new Set([
  'augmentChunkHash',
  'banner',
  'buildApp',
  'buildEnd',
  'buildStart',
  'closeBundle',
  'closeWatcher',
  'config',
  'configEnvironment',
  'configResolved',
  'configurePreviewServer',
  'configureServer',
  'configureSharedDuringBuild',
  'footer',
  'generateBundle',
  'handleHotUpdate',
  'hotUpdate',
  'intro',
  'load',
  'moduleParsed',
  'options',
  'outro',
  'outputOptions',
  'perEnvironmentStart',
  'renderDynamicImport',
  'renderChunk',
  'renderError',
  'renderStart',
  'resolveDynamicImport',
  'resolveFileUrl',
  'resolveId',
  'resolveImportMeta',
  'sharedDuringBuild',
  'shouldTransformCachedModule',
  'transform',
  'transformIndexHtml',
  'watchChange',
  'writeBundle',
]);

const TARGET_WORKSPACE_PACKAGES = Object.freeze({
  '@lucid-fin/target-contracts': {
    packageRoot: 'packages/target-contracts',
    sourceRoot: 'packages/target-contracts/src',
    sourceEntry: 'index.ts',
    configuration: 'packages/target-contracts/tsconfig.json',
  },
  '@lucid-fin/target-runtime': {
    packageRoot: 'packages/target-runtime',
    sourceRoot: 'packages/target-runtime/src',
    sourceEntry: 'index.ts',
    configuration: 'packages/target-runtime/tsconfig.json',
  },
  '@lucid-fin/target-storage': {
    packageRoot: 'packages/target-storage',
    sourceRoot: 'packages/target-storage/src',
    sourceEntry: 'kernel/index.ts',
    configuration: 'packages/target-storage/tsconfig.json',
  },
});

type TargetWorkspacePackageName = keyof typeof TARGET_WORKSPACE_PACKAGES;
type RuntimeResolutionKind = 'import' | 'require';

export interface TargetRcClosureOptions {
  readonly repositoryRoot?: string;
  readonly entrypoints?: readonly string[];
  readonly beforeFinalSourceVerification?: () => Promise<void> | void;
}

export interface TargetRcClosureFile {
  readonly path: string;
  readonly sha256: string;
}

export interface TargetRcEmittedArtifact extends TargetRcClosureFile {
  readonly bytes: number;
}

export interface TargetRcToolVersion {
  readonly name: string;
  readonly version: string;
}

export interface TargetRcToolchain {
  readonly node: string;
  readonly typescript: string;
  readonly vite: string;
  readonly plugins: readonly TargetRcToolVersion[];
}

export interface TargetRcClosureReport {
  readonly schema: typeof TARGET_RC_CLOSURE_SCHEMA;
  readonly entrypoints: readonly string[];
  readonly runtimeEntrypoints: readonly string[];
  readonly emittedAuditRoots: readonly string[];
  readonly files: readonly TargetRcClosureFile[];
  readonly externalSpecifiers: readonly string[];
  readonly inputs: readonly TargetRcClosureFile[];
  readonly toolchain: TargetRcToolchain;
  readonly closureSha256: string;
  readonly violations: readonly string[];
  readonly ok: boolean;
}

export interface TargetRcEmittedClosureOptions {
  readonly repositoryRoot: string;
  readonly isolatedRoot: string;
  readonly entrypoints: readonly string[];
  readonly emittedArtifacts?: readonly TargetRcEmittedArtifact[];
  readonly sourceEntrypoints?: readonly string[];
  readonly inputs?: readonly TargetRcClosureFile[];
  readonly toolchain?: TargetRcToolchain;
}

export interface TargetRcIsolatedBuild {
  readonly isolatedRoot: string;
  readonly configurations: readonly TargetRcClosureFile[];
  readonly inputs: readonly TargetRcClosureFile[];
  readonly toolchain: TargetRcToolchain;
  readonly packages: {
    readonly contracts: readonly TargetRcEmittedArtifact[];
    readonly storage: readonly TargetRcEmittedArtifact[];
    readonly runtime: readonly TargetRcEmittedArtifact[];
  };
  readonly main: readonly TargetRcEmittedArtifact[];
  readonly preload: readonly TargetRcEmittedArtifact[];
  readonly renderer: readonly TargetRcEmittedArtifact[];
}

export interface TargetRcIsolatedBuildOptions {
  readonly sourceEntrypoints?: readonly string[];
  readonly beforeFinalSourceVerification?: () => Promise<void> | void;
}

export function targetRcEmittedArtifacts(
  build: TargetRcIsolatedBuild,
): readonly TargetRcEmittedArtifact[] {
  return [
    ...build.packages.contracts,
    ...build.packages.storage,
    ...build.packages.runtime,
    ...build.main,
    ...build.preload,
    ...build.renderer,
  ];
}

interface TargetPackageManifest {
  readonly name: TargetWorkspacePackageName;
  readonly packageRoot: string;
  readonly manifest: Record<string, unknown>;
}

interface RuntimeSpecifier {
  readonly specifier: string | null;
  readonly kind: RuntimeResolutionKind;
  readonly violation?: string;
}

interface EmittedRuntimeReference {
  readonly specifier: string | null;
  readonly kind: RuntimeResolutionKind | 'asset';
  readonly violation?: string;
}

type SourceReferenceKind = RuntimeResolutionKind | 'asset' | 'path' | 'types' | 'lib';

interface SourceReference {
  readonly specifier: string | null;
  readonly kind: SourceReferenceKind;
  readonly resolutionMode?: ts.ResolutionMode;
  readonly violation?: string;
}

interface SourcePreflightReport {
  readonly files: readonly TargetRcClosureFile[];
  readonly violations: readonly string[];
}

interface TargetRcVerificationSnapshot {
  readonly sourceClosure: readonly TargetRcClosureFile[];
  readonly configurations: readonly TargetRcClosureFile[];
  readonly inputs: readonly TargetRcClosureFile[];
}

class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafePathError';
  }
}

interface SafeRoot {
  readonly path: string;
  readonly canonicalPath: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function repositoryRootFromModule(): string {
  return fileURLToPath(new URL('..', import.meta.url));
}

function normalizedRelative(root: string, file: string): string {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

function isReparsePoint(value: Awaited<ReturnType<typeof lstat>>): boolean {
  return value.isSymbolicLink();
}

async function safeRoot(root: string): Promise<SafeRoot> {
  const absolute = path.resolve(root);
  const details = await lstat(absolute);
  if (isReparsePoint(details)) {
    throw new UnsafePathError('unsafe path (symbolic link or junction): .');
  }
  return { path: absolute, canonicalPath: await realpath(absolute) };
}

async function assertSafePath(root: SafeRoot, candidate: string): Promise<void> {
  const absolute = path.resolve(candidate);
  if (!isInside(root.path, absolute)) {
    throw new UnsafePathError(`path escapes root: ${normalizedRelative(root.path, absolute)}`);
  }
  const relativeParts = path.relative(root.path, absolute).split(path.sep).filter(Boolean);
  let current = root.path;
  for (const part of relativeParts) {
    current = path.join(current, part);
    const details = await lstat(current);
    if (isReparsePoint(details)) {
      throw new UnsafePathError(
        `unsafe path (symbolic link or junction): ${normalizedRelative(root.path, current)}`,
      );
    }
  }
  const canonical = await realpath(absolute);
  if (!isInside(root.canonicalPath, canonical)) {
    throw new UnsafePathError(
      `canonical path escapes root: ${normalizedRelative(root.path, absolute)}`,
    );
  }
}

async function safeFile(root: SafeRoot, candidate: string): Promise<void> {
  await assertSafePath(root, candidate);
  if (!(await stat(candidate)).isFile()) {
    throw new Error(`not a file: ${normalizedRelative(root.path, candidate)}`);
  }
}

async function safeDirectory(root: SafeRoot, candidate: string): Promise<void> {
  await assertSafePath(root, candidate);
  if (!(await stat(candidate)).isDirectory()) {
    throw new Error(`not a directory: ${normalizedRelative(root.path, candidate)}`);
  }
}

async function safeReadFile(root: SafeRoot, candidate: string): Promise<string> {
  await safeFile(root, candidate);
  return readFile(candidate, 'utf8');
}

async function safePathIsFile(root: SafeRoot, candidate: string): Promise<boolean> {
  try {
    await safeFile(root, candidate);
    return true;
  } catch (cause) {
    if (cause instanceof UnsafePathError) throw cause;
    const code =
      cause !== null &&
      typeof cause === 'object' &&
      'code' in cause &&
      typeof cause.code === 'string'
        ? cause.code
        : undefined;
    if (code === 'ENOENT' || (cause instanceof Error && cause.message.startsWith('not a file:')))
      return false;
    throw cause;
  }
}

async function assertSafeTree(root: SafeRoot, directory: string): Promise<void> {
  await assertSafePath(root, directory);
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    await assertSafePath(root, candidate);
    if (entry.isDirectory()) await assertSafeTree(root, candidate);
  }
}

function sourceAllowed(relativePath: string): boolean {
  return (
    relativePath.startsWith('apps/desktop-main/src/target/') ||
    relativePath.startsWith('apps/desktop-renderer/src/target/') ||
    relativePath === 'apps/desktop-renderer/src/target-entry.tsx' ||
    relativePath.startsWith('packages/target-contracts/src/') ||
    relativePath.startsWith('packages/target-runtime/src/') ||
    relativePath.startsWith('packages/target-storage/src/')
  );
}

function emittedAllowed(relativePath: string): boolean {
  return (
    relativePath.startsWith('apps/desktop-main/dist-target-rc/') ||
    relativePath.startsWith('apps/desktop-renderer/dist-target-rc/') ||
    relativePath.startsWith('packages/target-contracts/dist/') ||
    relativePath.startsWith('packages/target-runtime/dist/') ||
    relativePath.startsWith('packages/target-storage/dist/')
  );
}

function targetWorkspaceSpecifier(specifier: string): TargetWorkspacePackageName | null {
  return (
    (Object.keys(TARGET_WORKSPACE_PACKAGES) as TargetWorkspacePackageName[]).find(
      (packageName) => specifier === packageName || specifier.startsWith(`${packageName}/`),
    ) ?? null
  );
}

function sourceWorkspaceResolution(repositoryRoot: string, specifier: string): string | null {
  const packageName = targetWorkspaceSpecifier(specifier);
  if (packageName === null) return null;
  const target = TARGET_WORKSPACE_PACKAGES[packageName];
  if (specifier === packageName)
    return path.join(repositoryRoot, target.sourceRoot, target.sourceEntry);
  return path.join(repositoryRoot, target.sourceRoot, specifier.slice(packageName.length + 1));
}

function isLocalFileSpecifier(specifier: string): boolean {
  return /^file:/i.test(specifier) || path.isAbsolute(specifier);
}

function matchesCompilerPathMapping(pattern: string, specifier: string): boolean {
  const wildcard = pattern.indexOf('*');
  if (wildcard === -1) return pattern === specifier;
  const prefix = pattern.slice(0, wildcard);
  const suffix = pattern.slice(wildcard + 1);
  return (
    specifier.startsWith(prefix) &&
    specifier.endsWith(suffix) &&
    specifier.length >= prefix.length + suffix.length
  );
}

function hasCompilerPathMapping(options: ts.CompilerOptions, specifier: string): boolean {
  return Object.keys(options.paths ?? {}).some((pattern) =>
    matchesCompilerPathMapping(pattern, specifier),
  );
}

function isNodeBuiltinSpecifier(specifier: string): boolean {
  return (
    builtinModules.includes(specifier) ||
    (specifier.startsWith('node:') && builtinModules.includes(specifier.slice('node:'.length)))
  );
}

async function resolveSourceFile(root: SafeRoot, candidate: string): Promise<string | null> {
  const extension = path.extname(candidate);
  const withoutRuntimeExtension = ['.js', '.mjs', '.cjs'].includes(extension)
    ? candidate.slice(0, -extension.length)
    : candidate;
  const candidates = [
    candidate,
    ...SOURCE_EXTENSIONS.map((sourceExtension) => `${withoutRuntimeExtension}${sourceExtension}`),
    ...SOURCE_EXTENSIONS.map((sourceExtension) =>
      path.join(withoutRuntimeExtension, `index${sourceExtension}`),
    ),
  ];
  for (const value of candidates) {
    if (await safePathIsFile(root, value)) return path.resolve(value);
  }
  return null;
}

async function resolveRuntimeFile(root: SafeRoot, candidate: string): Promise<string | null> {
  const extension = path.extname(candidate);
  const withoutRuntimeExtension = ['.js', '.mjs', '.cjs'].includes(extension)
    ? candidate.slice(0, -extension.length)
    : candidate;
  const candidates = [
    candidate,
    ...RUNTIME_EXTENSIONS.map(
      (runtimeExtension) => `${withoutRuntimeExtension}${runtimeExtension}`,
    ),
    ...RUNTIME_EXTENSIONS.map((runtimeExtension) =>
      path.join(withoutRuntimeExtension, `index${runtimeExtension}`),
    ),
  ];
  for (const value of candidates) {
    if (await safePathIsFile(root, value)) return path.resolve(value);
  }
  return null;
}

function isViteRouteModuleImport(
  node: ts.CallExpression,
  source: string,
  sourceFile: ts.SourceFile,
): boolean {
  const [argument] = node.arguments;
  if (
    argument === undefined ||
    !ts.isPropertyAccessExpression(argument) ||
    !ts.isIdentifier(argument.expression) ||
    argument.expression.text !== 'route' ||
    argument.name.text !== 'module'
  ) {
    return false;
  }
  const leading = source.slice(node.getStart(sourceFile), argument.getStart(sourceFile));
  return leading.includes('/* @vite-ignore */') && leading.includes('/* webpackIgnore: true */');
}

function importMetaCallName(node: ts.CallExpression): string | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return undefined;
  const target = node.expression.expression;
  return ts.isMetaProperty(target) && target.keywordToken === ts.SyntaxKind.ImportKeyword
    ? node.expression.name.text
    : undefined;
}

function isImportMetaPropertyAccess(node: ts.Node | undefined, name: string): boolean {
  return (
    node !== undefined &&
    ts.isPropertyAccessExpression(node) &&
    ts.isMetaProperty(node.expression) &&
    node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
    node.expression.name.text === 'meta' &&
    node.name.text === name
  );
}

function isVitePreloadImportMetaResolve(
  node: ts.CallExpression,
  enclosingFunction: ts.Node | undefined,
): boolean {
  if (
    enclosingFunction === undefined ||
    !ts.isFunctionDeclaration(enclosingFunction) ||
    enclosingFunction.name?.text !== 'importMetaResolve' ||
    enclosingFunction.parameters.length !== 1 ||
    enclosingFunction.body === undefined ||
    enclosingFunction.body.statements.length !== 2
  ) {
    return false;
  }
  const [parameter] = enclosingFunction.parameters;
  const [argument] = node.arguments;
  if (
    parameter === undefined ||
    !ts.isIdentifier(parameter.name) ||
    argument === undefined ||
    !ts.isIdentifier(argument) ||
    argument.text !== parameter.name.text
  ) {
    return false;
  }
  const [condition, fallback] = enclosingFunction.body.statements;
  if (
    !ts.isIfStatement(condition) ||
    !isImportMetaPropertyAccess(condition.expression, 'resolve') ||
    !ts.isReturnStatement(condition.thenStatement) ||
    condition.thenStatement.expression !== node ||
    !ts.isReturnStatement(fallback) ||
    fallback.expression === undefined ||
    !ts.isPropertyAccessExpression(fallback.expression) ||
    fallback.expression.name.text !== 'href' ||
    !ts.isNewExpression(fallback.expression.expression) ||
    fallback.expression.expression.arguments === undefined
  ) {
    return false;
  }
  const fallbackArguments = fallback.expression.expression.arguments;
  return (
    fallbackArguments.length === 2 &&
    ts.isIdentifier(fallbackArguments[0]) &&
    fallbackArguments[0].text === parameter.name.text &&
    isImportMetaPropertyAccess(fallbackArguments[1], 'url')
  );
}

function dynamicLoaderModuleViolation(specifier: string): string | undefined {
  if (specifier === 'module' || specifier === 'node:module') {
    return `unsupported dynamic loader module ${specifier}`;
  }
  if (specifier === 'vm' || specifier === 'node:vm') {
    return `unsupported dynamic loader module ${specifier}`;
  }
  return undefined;
}

// Source auditing rejects conventional dynamic-code and module-loader capability names wherever
// they are referenced or statically selected. Emitted code is checked at call/new-expression
// sites so bundler helper identifiers remain auditable. This is not a claim to deobfuscate
// arbitrary JavaScript.
const DYNAMIC_LOADER_CAPABILITIES = new Map<string, string>([
  ['Function', 'Function'],
  ['eval', 'eval'],
  ['createRequire', 'createRequire'],
  ['require', 'require'],
  ['getBuiltinModule', 'process.getBuiltinModule'],
  ['runInThisContext', 'vm.runInThisContext'],
  ['runInNewContext', 'vm.runInNewContext'],
  ['runInContext', 'vm.runInContext'],
  ['compileFunction', 'vm.compileFunction'],
  ['Script', 'vm.Script'],
]);

const SOURCE_DYNAMIC_CODE_IDENTIFIERS = new Set(['Worker', 'SharedWorker', 'importScripts']);
const SOURCE_DYNAMIC_CODE_PROPERTIES = new Map<string, string>([
  ['Worker', 'Worker'],
  ['SharedWorker', 'SharedWorker'],
  ['importScripts', 'importScripts'],
  ['createElement', 'createElement'],
  ['serviceWorker', 'navigator.serviceWorker'],
  ['addModule', 'worklet.addModule'],
]);

function dynamicLoaderCapability(name: string): string | undefined {
  return DYNAMIC_LOADER_CAPABILITIES.get(name);
}

function sourceDynamicCodeIdentifierViolation(name: string): string | undefined {
  return SOURCE_DYNAMIC_CODE_IDENTIFIERS.has(name)
    ? `unsupported dynamic code capability ${name}`
    : undefined;
}

function sourceDynamicCodePropertyViolation(name: string): string | undefined {
  const capability = SOURCE_DYNAMIC_CODE_PROPERTIES.get(name);
  return capability === undefined ? undefined : `unsupported dynamic code capability ${capability}`;
}

function staticStringValue(node: ts.Expression | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isStringLiteralLike(node)) return node.text;
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  ) {
    return staticStringValue(node.expression);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticStringValue(node.left);
    const right = staticStringValue(node.right);
    return left === undefined || right === undefined ? undefined : `${left}${right}`;
  }
  return undefined;
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isInTypePosition(node: ts.Node): boolean {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (ts.isTypeNode(current)) return true;
  }
  return false;
}

function isIdentifierReference(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (parent === undefined || isInTypePosition(node)) return false;
  if (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isQualifiedName(parent) && parent.right === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isGetAccessorDeclaration(parent) && parent.name === node) ||
    (ts.isSetAccessorDeclaration(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isFunctionExpression(parent) && parent.name === node) ||
    (ts.isClassDeclaration(parent) && parent.name === node) ||
    (ts.isClassExpression(parent) && parent.name === node) ||
    (ts.isInterfaceDeclaration(parent) && parent.name === node) ||
    (ts.isTypeAliasDeclaration(parent) && parent.name === node) ||
    (ts.isEnumDeclaration(parent) && parent.name === node) ||
    (ts.isModuleDeclaration(parent) && parent.name === node) ||
    (ts.isTypeParameterDeclaration(parent) && parent.name === node) ||
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isImportEqualsDeclaration(parent) ||
    ts.isExportSpecifier(parent)
  ) {
    return false;
  }
  return true;
}

function staticPropertyName(node: ts.PropertyName | undefined): string | undefined {
  if (node === undefined) return undefined;
  if (ts.isComputedPropertyName(node)) return staticStringValue(node.expression);
  return propertyName(node);
}

function bindingPropertyName(node: ts.BindingElement): string | undefined {
  if (node.propertyName !== undefined) return staticPropertyName(node.propertyName);
  return ts.isIdentifier(node.name) ? node.name.text : undefined;
}

function dynamicLoaderPropertyViolation(
  receiver: ts.Expression,
  property: string | undefined,
): string | undefined {
  if (property === undefined) return undefined;
  const capability = dynamicLoaderCapability(property);
  if (capability !== undefined) return `unsupported dynamic loader capability ${capability}`;
  const unwrappedReceiver = unwrapExpression(receiver);
  if (
    property === 'resolve' &&
    ts.isIdentifier(unwrappedReceiver) &&
    unwrappedReceiver.text === 'require'
  ) {
    return 'unsupported dynamic loader capability require.resolve';
  }
  return undefined;
}

function dynamicLoaderBindingViolation(node: ts.BindingElement): string | undefined {
  const property = bindingPropertyName(node);
  if (property === undefined) return undefined;
  const capability = dynamicLoaderCapability(property);
  if (capability !== undefined) return `unsupported dynamic loader capability ${capability}`;
  return undefined;
}

function bindingElementInitializer(node: ts.BindingElement): ts.Expression | undefined {
  const pattern = node.parent;
  if (!ts.isObjectBindingPattern(pattern)) return undefined;
  const declaration = pattern.parent;
  if (
    (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration)) &&
    declaration.name === pattern
  ) {
    return declaration.initializer;
  }
  return undefined;
}

function dynamicLoaderImportViolation(node: ts.ImportSpecifier): string | undefined {
  if (node.isTypeOnly || (ts.isImportClause(node.parent.parent) && node.parent.parent.isTypeOnly)) {
    return undefined;
  }
  const imported = node.propertyName ?? node.name;
  const capability = dynamicLoaderCapability(imported.text);
  if (capability !== undefined) return `unsupported dynamic loader capability ${capability}`;
  return undefined;
}

function importSpecifiersFromSourceFile(
  source: string,
  script: ts.SourceFile,
  allowViteRuntimeHelpers: boolean,
  rejectDynamicLoaderReferences: boolean,
): RuntimeSpecifier[] {
  const specifiers = new Map<string, RuntimeSpecifier>();
  const nonLiteralSpecifiers = new Map<RuntimeResolutionKind, RuntimeSpecifier>();
  type ProtectedReceiverKind = 'global' | 'module' | 'process' | 'document' | 'Object' | 'Reflect';
  const receiverAliases: Record<ProtectedReceiverKind, Set<string>> = {
    global: new Set<string>(),
    module: new Set<string>(),
    process: new Set<string>(),
    document: new Set<string>(),
    Object: new Set<string>(),
    Reflect: new Set<string>(),
  };
  type TimerCapability = 'setTimeout' | 'setInterval';
  const timerAliases = new Map<string, TimerCapability>();
  const staticStringAliases = new Map<string, string>();
  const stringCapableAliases = new Set<string>();
  const addViolation = (violation: string, kind: RuntimeResolutionKind = 'import'): void => {
    specifiers.set(`violation:${violation}`, { specifier: null, kind, violation });
  };
  const add = (
    value: ts.Expression | ts.ModuleReference | undefined,
    kind: RuntimeResolutionKind,
  ): void => {
    if (value !== undefined && ts.isStringLiteral(value)) {
      const violation = dynamicLoaderModuleViolation(value.text);
      if (violation !== undefined) {
        addViolation(violation, kind);
        return;
      }
      specifiers.set(`${kind}:${value.text}`, { specifier: value.text, kind });
    }
  };
  const addDynamic = (value: ts.Expression | undefined, kind: RuntimeResolutionKind): void => {
    if (value !== undefined && ts.isStringLiteral(value)) {
      const violation = dynamicLoaderModuleViolation(value.text);
      if (violation !== undefined) {
        addViolation(violation, kind);
        return;
      }
      specifiers.set(`${kind}:${value.text}`, { specifier: value.text, kind });
      return;
    }
    nonLiteralSpecifiers.set(kind, { specifier: null, kind });
  };
  const addUnsupportedImportMetaCall = (name: string): void => {
    addViolation(`unsupported import.meta.${name} call`);
  };
  const addReceiverAlias = (name: string, kind: ProtectedReceiverKind): void => {
    receiverAliases[kind].add(name);
  };
  const staticPropertyAccess = (
    expression: ts.Expression,
  ): { readonly receiver: ts.Expression; readonly property: string | undefined } | undefined => {
    const value = unwrapExpression(expression);
    if (ts.isPropertyAccessExpression(value)) {
      return { receiver: value.expression, property: value.name.text };
    }
    if (ts.isElementAccessExpression(value)) {
      return {
        receiver: value.expression,
        property: staticStringValue(value.argumentExpression),
      };
    }
    return undefined;
  };
  const derivedReceiverKind = (
    receiver: ProtectedReceiverKind,
    property: string,
  ): ProtectedReceiverKind | undefined => {
    if (receiver === 'global') {
      if (
        property === 'globalThis' ||
        property === 'global' ||
        property === 'window' ||
        property === 'self'
      ) {
        return 'global';
      }
      if (property === 'module' || property === 'require') return 'module';
      if (property === 'process') return 'process';
      if (property === 'document') return 'document';
      if (property === 'Object') return 'Object';
      if (property === 'Reflect') return 'Reflect';
    }
    if (receiver === 'module' && (property === 'module' || property === 'require')) return 'module';
    if (receiver === 'process' && property === 'process') return 'process';
    if (receiver === 'document' && property === 'document') return 'document';
    if (receiver === 'Object' && property === 'Object') return 'Object';
    if (receiver === 'Reflect' && property === 'Reflect') return 'Reflect';
    return undefined;
  };
  const protectedReceiverKind = (receiver: ts.Expression): ProtectedReceiverKind | undefined => {
    const value = unwrapExpression(receiver);
    if (ts.isIdentifier(value)) {
      if (
        value.text === 'globalThis' ||
        value.text === 'global' ||
        value.text === 'window' ||
        value.text === 'self'
      ) {
        return 'global';
      }
      if (value.text === 'module' || value.text === 'require') return 'module';
      if (value.text === 'process') return 'process';
      if (value.text === 'document') return 'document';
      if (value.text === 'Object') return 'Object';
      if (value.text === 'Reflect') return 'Reflect';
      for (const [kind, aliases] of Object.entries(receiverAliases) as [
        ProtectedReceiverKind,
        Set<string>,
      ][]) {
        if (aliases.has(value.text)) return kind;
      }
      return undefined;
    }
    const propertyAccess = staticPropertyAccess(value);
    if (propertyAccess?.property === undefined) return undefined;
    const base = protectedReceiverKind(propertyAccess.receiver);
    return base === undefined ? undefined : derivedReceiverKind(base, propertyAccess.property);
  };
  const objectReflectReceiverKind = (receiver: ts.Expression): 'Object' | 'Reflect' | undefined => {
    const kind = protectedReceiverKind(receiver);
    return kind === 'Object' || kind === 'Reflect' ? kind : undefined;
  };
  const timerCapability = (expression: ts.Expression): TimerCapability | undefined => {
    const value = unwrapExpression(expression);
    if (ts.isIdentifier(value)) {
      if (value.text === 'setTimeout' || value.text === 'setInterval') return value.text;
      return timerAliases.get(value.text);
    }
    const access = staticPropertyAccess(value);
    if (access?.property !== 'setTimeout' && access?.property !== 'setInterval') {
      return undefined;
    }
    return protectedReceiverKind(access.receiver) === 'global' ? access.property : undefined;
  };
  const typeMayContainString = (type: ts.TypeNode | undefined): boolean => {
    if (type === undefined) return false;
    if (
      type.kind === ts.SyntaxKind.StringKeyword ||
      type.kind === ts.SyntaxKind.AnyKeyword ||
      type.kind === ts.SyntaxKind.UnknownKeyword ||
      (ts.isLiteralTypeNode(type) && ts.isStringLiteralLike(type.literal))
    ) {
      return true;
    }
    if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) {
      return type.types.some(typeMayContainString);
    }
    if (ts.isParenthesizedTypeNode(type)) return typeMayContainString(type.type);
    return false;
  };
  const aliasedStaticString = (
    expression: ts.Expression | undefined,
    seen: ReadonlySet<string> = new Set(),
  ): string | undefined => {
    if (expression === undefined) return undefined;
    const value = unwrapExpression(expression);
    if (ts.isIdentifier(value)) {
      if (seen.has(value.text)) return undefined;
      return staticStringAliases.get(value.text);
    }
    if (ts.isStringLiteralLike(value)) return value.text;
    if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = aliasedStaticString(value.left, seen);
      const right = aliasedStaticString(value.right, seen);
      return left === undefined || right === undefined ? undefined : `${left}${right}`;
    }
    if (ts.isTemplateExpression(value)) {
      let result = value.head.text;
      for (const span of value.templateSpans) {
        const substitution = aliasedStaticString(span.expression, seen);
        if (substitution === undefined) return undefined;
        result += substitution + span.literal.text;
      }
      return result;
    }
    return undefined;
  };
  const timerHandlerMayBeString = (expression: ts.Expression): boolean => {
    const value = unwrapExpression(expression);
    if (aliasedStaticString(value) !== undefined || ts.isTemplateExpression(value)) return true;
    if (ts.isIdentifier(value)) return stringCapableAliases.has(value.text);
    if (ts.isConditionalExpression(value)) {
      return timerHandlerMayBeString(value.whenTrue) || timerHandlerMayBeString(value.whenFalse);
    }
    if (ts.isBinaryExpression(value) && value.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return timerHandlerMayBeString(value.left) || timerHandlerMayBeString(value.right);
    }
    if (ts.isCallExpression(value) && ts.isIdentifier(value.expression)) {
      return value.expression.text === 'String';
    }
    return (
      (ts.isAsExpression(expression) ||
        ts.isTypeAssertionExpression(expression) ||
        ts.isSatisfiesExpression(expression)) &&
      typeMayContainString(expression.type)
    );
  };
  const registerValueAlias = (
    name: string,
    initializer: ts.Expression | undefined,
    type: ts.TypeNode | undefined,
  ): void => {
    if (initializer !== undefined) {
      const timer = timerCapability(initializer);
      if (timer !== undefined) timerAliases.set(name, timer);
      const stringValue = aliasedStaticString(initializer);
      if (stringValue !== undefined) staticStringAliases.set(name, stringValue);
    }
    if (
      typeMayContainString(type) ||
      (initializer !== undefined && timerHandlerMayBeString(initializer))
    ) {
      stringCapableAliases.add(name);
    }
  };
  const registerAlias = (name: string, initializer: ts.Expression): void => {
    const kind = protectedReceiverKind(initializer);
    if (kind !== undefined) addReceiverAlias(name, kind);
  };
  const registerBindingAlias = (node: ts.BindingElement): void => {
    if (!ts.isIdentifier(node.name)) return;
    const initializer = bindingElementInitializer(node);
    const property = bindingPropertyName(node);
    if (initializer === undefined || property === undefined) return;
    const receiver = protectedReceiverKind(initializer);
    const kind = receiver === undefined ? undefined : derivedReceiverKind(receiver, property);
    if (kind !== undefined) addReceiverAlias(node.name.text, kind);
    if (
      (property === 'setTimeout' || property === 'setInterval') &&
      protectedReceiverKind(initializer) === 'global'
    ) {
      timerAliases.set(node.name.text, property);
    }
  };
  const registerObjectAssignmentAliases = (node: ts.BinaryExpression): void => {
    if (
      node.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
      !ts.isObjectLiteralExpression(node.left)
    ) {
      return;
    }
    for (const property of node.left.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = staticPropertyName(property.name);
      const target = unwrapExpression(property.initializer);
      if (name === undefined || !ts.isIdentifier(target)) continue;
      const receiver = protectedReceiverKind(node.right);
      const kind = receiver === undefined ? undefined : derivedReceiverKind(receiver, name);
      if (kind !== undefined) addReceiverAlias(target.text, kind);
    }
  };
  const registerAliases = (node: ts.Node): void => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) {
      if (node.initializer !== undefined) registerAlias(node.name.text, node.initializer);
      registerValueAlias(node.name.text, node.initializer, node.type);
    }
    if (ts.isBindingElement(node)) registerBindingAlias(node);
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      registerAlias(node.left.text, node.right);
      registerValueAlias(node.left.text, node.right, undefined);
    }
    if (ts.isBinaryExpression(node)) registerObjectAssignmentAliases(node);
  };
  const dynamicLoaderExpressionViolation = (expression: ts.Expression): string | undefined => {
    const callee = unwrapExpression(expression);
    if (ts.isIdentifier(callee)) {
      const capability = dynamicLoaderCapability(callee.text);
      if (capability !== undefined && callee.text !== 'require')
        return `unsupported dynamic loader capability ${capability}`;
      return undefined;
    }
    if (ts.isPropertyAccessExpression(callee)) {
      return dynamicLoaderPropertyViolation(callee.expression, callee.name.text);
    }
    if (ts.isElementAccessExpression(callee)) {
      return dynamicLoaderPropertyViolation(
        callee.expression,
        staticStringValue(callee.argumentExpression),
      );
    }
    if (ts.isBinaryExpression(callee) && callee.operatorToken.kind === ts.SyntaxKind.CommaToken) {
      return dynamicLoaderExpressionViolation(callee.right);
    }
    return undefined;
  };
  const timerCallViolation = (node: ts.CallExpression): string | undefined => {
    const callee = unwrapExpression(node.expression);
    const access = staticPropertyAccess(callee);
    if (
      access !== undefined &&
      (access.property === 'call' || access.property === 'apply' || access.property === 'bind')
    ) {
      const timer = timerCapability(access.receiver);
      if (timer !== undefined) {
        return `unsupported dynamic code timer reflection ${timer}.${access.property}`;
      }
    }
    const timer = timerCapability(callee);
    const [handler] = node.arguments;
    return timer !== undefined && handler !== undefined && timerHandlerMayBeString(handler)
      ? `unsupported dynamic code string timer ${timer}`
      : undefined;
  };
  const computedAccessViolation = (receiver: ProtectedReceiverKind): string =>
    `unsupported dynamic loader computed ${receiver} access`;
  const sourceDynamicCodeMemberViolation = (
    receiver: ts.Expression,
    property: string | undefined,
  ): string | undefined => {
    if (property === undefined) return undefined;
    const genericViolation = sourceDynamicCodePropertyViolation(property);
    if (genericViolation !== undefined) return genericViolation;
    if (
      (property === 'write' || property === 'writeln') &&
      protectedReceiverKind(receiver) === 'document'
    ) {
      return `unsupported dynamic code capability document.${property}`;
    }
    return undefined;
  };
  const objectReflectMemberViolation = (
    receiver: ts.Expression,
    property: string | undefined,
    directCall: ts.CallExpression | undefined,
  ): string | undefined => {
    if (property === undefined) return undefined;
    const kind = objectReflectReceiverKind(receiver);
    if (kind === undefined || (kind === 'Object' && property === 'prototype')) return undefined;
    if (kind === 'Reflect' && property === 'get') {
      return 'unsupported dynamic loader capability Reflect.get';
    }
    if (kind === 'Object' && property === 'getOwnPropertyDescriptor') {
      return 'unsupported dynamic loader capability Object.getOwnPropertyDescriptor';
    }
    if (directCall === undefined) {
      return `unsupported dynamic loader reflective member reference ${kind}.${property}`;
    }
    for (const argument of directCall.arguments) {
      const argumentKind = protectedReceiverKind(argument);
      if (argumentKind === 'global' || argumentKind === 'module' || argumentKind === 'process') {
        return `unsupported dynamic loader reflective ${kind}.${property} access on ${argumentKind} object`;
      }
    }
    return undefined;
  };
  const objectAssignmentViolation = (node: ts.BinaryExpression): string | undefined => {
    if (
      node.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
      !ts.isObjectLiteralExpression(node.left)
    ) {
      return undefined;
    }
    for (const property of node.left.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = staticPropertyName(property.name);
      const reflectiveViolation = objectReflectMemberViolation(node.right, name, undefined);
      if (reflectiveViolation !== undefined) return reflectiveViolation;
      const dynamicCodeViolation = sourceDynamicCodeMemberViolation(node.right, name);
      if (dynamicCodeViolation !== undefined) return dynamicCodeViolation;
    }
    const receiver = protectedReceiverKind(node.right);
    if (receiver === undefined) return undefined;
    for (const property of node.left.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const name = staticPropertyName(property.name);
      if (name === undefined && ts.isComputedPropertyName(property.name)) {
        return computedAccessViolation(receiver);
      }
      if (name === undefined) continue;
      const capability = dynamicLoaderCapability(name);
      if (capability !== undefined) return `unsupported dynamic loader capability ${capability}`;
    }
    return undefined;
  };
  const visit = (node: ts.Node, enclosingFunction?: ts.Node): void => {
    const functionScope = ts.isFunctionLike(node) ? node : enclosingFunction;
    if (rejectDynamicLoaderReferences) registerAliases(node);
    if (rejectDynamicLoaderReferences && ts.isIdentifier(node) && isIdentifierReference(node)) {
      const capability = dynamicLoaderCapability(node.text);
      if (capability !== undefined && node.text !== 'require')
        addViolation(`unsupported dynamic loader capability ${capability}`);
      const dynamicCodeViolation = sourceDynamicCodeIdentifierViolation(node.text);
      if (dynamicCodeViolation !== undefined) addViolation(dynamicCodeViolation);
      if (node.text === 'require') {
        const parent = node.parent;
        const isDirectRequireCall = ts.isCallExpression(parent) && parent.expression === node;
        const isRequireResolve =
          (ts.isPropertyAccessExpression(parent) &&
            parent.expression === node &&
            parent.name.text === 'resolve') ||
          (ts.isElementAccessExpression(parent) &&
            parent.expression === node &&
            staticStringValue(parent.argumentExpression) === 'resolve');
        if (!isDirectRequireCall && !isRequireResolve) {
          addViolation('unsupported dynamic loader capability require');
        }
      }
    }
    if (rejectDynamicLoaderReferences && ts.isBindingElement(node)) {
      const violation = dynamicLoaderBindingViolation(node);
      if (violation !== undefined) addViolation(violation);
      const property = bindingPropertyName(node);
      const initializer = bindingElementInitializer(node);
      const dynamicCodeViolation =
        initializer === undefined
          ? undefined
          : sourceDynamicCodeMemberViolation(initializer, property);
      if (dynamicCodeViolation !== undefined) addViolation(dynamicCodeViolation);
      const reflectiveViolation =
        initializer === undefined
          ? undefined
          : objectReflectMemberViolation(initializer, property, undefined);
      if (reflectiveViolation !== undefined) addViolation(reflectiveViolation);
      if (
        node.propertyName !== undefined &&
        ts.isComputedPropertyName(node.propertyName) &&
        staticStringValue(node.propertyName.expression) === undefined &&
        initializer !== undefined
      ) {
        const receiver = protectedReceiverKind(initializer);
        if (receiver !== undefined) addViolation(computedAccessViolation(receiver));
      }
    }
    if (rejectDynamicLoaderReferences && ts.isBinaryExpression(node)) {
      const violation = objectAssignmentViolation(node);
      if (violation !== undefined) addViolation(violation);
    }
    if (rejectDynamicLoaderReferences && ts.isImportSpecifier(node)) {
      const violation = dynamicLoaderImportViolation(node);
      if (violation !== undefined) addViolation(violation);
    }
    if (rejectDynamicLoaderReferences && ts.isPropertyAccessExpression(node)) {
      const violation = dynamicLoaderPropertyViolation(node.expression, node.name.text);
      if (violation !== undefined) addViolation(violation);
      const dynamicCodeViolation = sourceDynamicCodeMemberViolation(
        node.expression,
        node.name.text,
      );
      if (dynamicCodeViolation !== undefined) addViolation(dynamicCodeViolation);
      const reflectiveViolation = objectReflectMemberViolation(
        node.expression,
        node.name.text,
        ts.isCallExpression(node.parent) && node.parent.expression === node
          ? node.parent
          : undefined,
      );
      if (reflectiveViolation !== undefined) addViolation(reflectiveViolation);
    }
    if (rejectDynamicLoaderReferences && ts.isElementAccessExpression(node)) {
      const property = staticStringValue(node.argumentExpression);
      const violation = dynamicLoaderPropertyViolation(node.expression, property);
      if (violation !== undefined) addViolation(violation);
      const dynamicCodeViolation = sourceDynamicCodeMemberViolation(node.expression, property);
      if (dynamicCodeViolation !== undefined) addViolation(dynamicCodeViolation);
      const reflectiveViolation = objectReflectMemberViolation(
        node.expression,
        property,
        ts.isCallExpression(node.parent) && node.parent.expression === node
          ? node.parent
          : undefined,
      );
      if (reflectiveViolation !== undefined) addViolation(reflectiveViolation);
      if (property === undefined) {
        const receiver = protectedReceiverKind(node.expression);
        if (receiver !== undefined) addViolation(computedAccessViolation(receiver));
      }
    }
    if (
      rejectDynamicLoaderReferences &&
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === 'script'
    ) {
      addViolation('unsupported dynamic code capability JSX script');
    }
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      add(node.moduleSpecifier, 'import');
    if (ts.isImportTypeNode(node)) {
      const argument = node.argument;
      if (ts.isLiteralTypeNode(argument) && ts.isStringLiteral(argument.literal)) {
        add(argument.literal, 'import');
      } else {
        nonLiteralSpecifiers.set('import', { specifier: null, kind: 'import' });
      }
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression, 'require');
    }
    if (ts.isCallExpression(node)) {
      const [firstArgument] = node.arguments;
      const importMetaName = importMetaCallName(node);
      if (
        importMetaName?.startsWith('glob') ||
        (importMetaName === 'resolve' &&
          !(allowViteRuntimeHelpers && isVitePreloadImportMetaResolve(node, functionScope)))
      ) {
        addUnsupportedImportMetaCall(importMetaName);
      }
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        !(allowViteRuntimeHelpers && isViteRouteModuleImport(node, source, script))
      ) {
        addDynamic(firstArgument, 'import');
      }
      const dynamicLoaderViolation = dynamicLoaderExpressionViolation(node.expression);
      if (dynamicLoaderViolation !== undefined) addViolation(dynamicLoaderViolation);
      if (rejectDynamicLoaderReferences) {
        const timerViolation = timerCallViolation(node);
        if (timerViolation !== undefined) addViolation(timerViolation);
      }
      if (ts.isIdentifier(node.expression)) {
        if (node.expression.text === 'require') addDynamic(firstArgument, 'require');
      }
    }
    if (ts.isNewExpression(node)) {
      const dynamicLoaderViolation = dynamicLoaderExpressionViolation(node.expression);
      if (dynamicLoaderViolation !== undefined) addViolation(dynamicLoaderViolation);
    }
    ts.forEachChild(node, (child) => visit(child, functionScope));
  };
  visit(script);
  return [...specifiers.values(), ...nonLiteralSpecifiers.values()].sort((left, right) =>
    compare(
      `${left.kind}:${left.specifier ?? ''}:${left.violation ?? ''}`,
      `${right.kind}:${right.specifier ?? ''}:${right.violation ?? ''}`,
    ),
  );
}

function importSpecifiers(
  file: string,
  source: string,
  allowViteRouteModuleImport: boolean = false,
): RuntimeSpecifier[] {
  if (!PARSEABLE_EXTENSIONS.has(path.extname(file))) return [];
  const script = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  return importSpecifiersFromSourceFile(source, script, allowViteRouteModuleImport, false);
}

function addAssetReference(
  references: Map<string, EmittedRuntimeReference>,
  specifier: string | undefined,
): void {
  if (specifier === undefined || specifier.trim() === '') return;
  references.set(`asset:${specifier}`, { specifier, kind: 'asset' });
}

function htmlAttribute(tag: string, attribute: string): string | undefined {
  const expression = new RegExp(
    `\\b${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>\\x60]+))`,
    'i',
  );
  const match = expression.exec(tag);
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function emittedHtmlReferences(source: string): EmittedRuntimeReference[] {
  const references = new Map<string, EmittedRuntimeReference>();
  const addViolation = (violation: string): void => {
    references.set(`violation:${violation}`, { specifier: null, kind: 'asset', violation });
  };
  for (const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)(?:<\/script\s*>|$)/gi)) {
    const tag = `<script${match[1] ?? ''}>`;
    const body = match[2] ?? '';
    addAssetReference(references, htmlAttribute(tag, 'src'));
    if (body.trim() !== '') addViolation('inline emitted script');
  }
  for (const match of source.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = htmlAttribute(tag, 'rel')?.toLowerCase().split(/\s+/) ?? [];
    if (rel.includes('modulepreload') || rel.includes('stylesheet')) {
      addAssetReference(references, htmlAttribute(tag, 'href'));
    }
  }
  return [...references.values()].sort((left, right) =>
    compare(left.specifier ?? '', right.specifier ?? ''),
  );
}

function emittedCssReferences(source: string): EmittedRuntimeReference[] {
  const references = new Map<string, EmittedRuntimeReference>();
  const addMatches = (expression: RegExp): void => {
    for (const match of source.matchAll(expression)) {
      addAssetReference(references, match[1] ?? match[2] ?? match[3]);
    }
  };
  addMatches(/@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s)'";]+))\s*\)?/gi);
  addMatches(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi);
  return [...references.values()].sort((left, right) =>
    compare(left.specifier ?? '', right.specifier ?? ''),
  );
}

function emittedReferences(file: string, source: string): EmittedRuntimeReference[] {
  const extension = path.extname(file).toLowerCase();
  if (extension === '.html') return emittedHtmlReferences(source);
  if (extension === '.css') return emittedCssReferences(source);
  return importSpecifiers(file, source, true);
}

function viteAssetReferences(script: ts.SourceFile): SourceReference[] {
  const references = new Map<string, SourceReference>();
  const add = (reference: SourceReference): void => {
    references.set(
      `${reference.kind}:${reference.specifier ?? ''}:${reference.violation ?? ''}`,
      reference,
    );
  };
  const addViolation = (violation: string): void => {
    add({ specifier: null, kind: 'asset', violation });
  };
  const isDirectGlobalThis = (expression: ts.Expression): boolean => {
    const value = unwrapExpression(expression);
    return ts.isIdentifier(value) && value.text === 'globalThis';
  };
  const isDirectGlobalThisProperty = (expression: ts.Expression, name: string): boolean =>
    ts.isPropertyAccessExpression(expression) &&
    isDirectGlobalThis(expression.expression) &&
    expression.name.text === name;
  const isDirectGlobalThisUrl = (expression: ts.Expression): boolean =>
    isDirectGlobalThisProperty(expression, 'URL');
  const isAllowedUrlConstructor = (expression: ts.Expression): boolean =>
    (ts.isIdentifier(expression) && expression.text === 'URL') || isDirectGlobalThisUrl(expression);
  const isDirectNewCallee = (node: ts.Expression): boolean =>
    ts.isNewExpression(node.parent) && node.parent.expression === node;
  const auditUrlConstruction = (node: ts.NewExpression): void => {
    if (!isAllowedUrlConstructor(node.expression)) return;
    if (node.arguments === undefined || node.arguments.length !== 2) {
      addViolation('unsupported Vite asset URL form');
      return;
    }
    const [asset, base] = node.arguments;
    if (!isImportMetaPropertyAccess(base, 'url')) {
      addViolation('unsupported Vite asset URL base');
      return;
    }
    if (asset === undefined || !ts.isStringLiteralLike(asset)) {
      addViolation('non-literal Vite asset URL');
      return;
    }
    if (!asset.text.startsWith('./') && !asset.text.startsWith('../')) {
      addViolation('non-local Vite asset URL');
      return;
    }
    add({ specifier: asset.text, kind: 'asset' });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isNewExpression(node)) auditUrlConstruction(node);
    if (ts.isBindingElement(node) && bindingPropertyName(node) === 'URL') {
      addViolation('unsupported Vite asset URL constructor reference');
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isObjectLiteralExpression(node.left) &&
      node.left.properties.some(
        (property) =>
          ts.isPropertyAssignment(property) && staticPropertyName(property.name) === 'URL',
      )
    ) {
      addViolation('unsupported Vite asset URL constructor reference');
    }
    if (
      ts.isIdentifier(node) &&
      node.text === 'URL' &&
      isIdentifierReference(node) &&
      !isDirectNewCallee(node)
    ) {
      addViolation('unsupported Vite asset URL constructor reference');
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'URL') {
      if (!isDirectGlobalThisUrl(node) || !isDirectNewCallee(node)) {
        addViolation('unsupported Vite asset URL constructor reference');
      }
    }
    if (
      ts.isElementAccessExpression(node) &&
      staticStringValue(node.argumentExpression) === 'URL'
    ) {
      addViolation('unsupported Vite asset URL constructor reference');
    }
    ts.forEachChild(node, visit);
  };
  visit(script);
  return [...references.values()].sort((left, right) =>
    compare(
      `${left.kind}:${left.specifier ?? ''}:${left.violation ?? ''}`,
      `${right.kind}:${right.specifier ?? ''}:${right.violation ?? ''}`,
    ),
  );
}

function sourceReferences(
  file: string,
  source: string,
  includeViteAssets: boolean,
): SourceReference[] {
  if (path.extname(file).toLowerCase() === '.css') return emittedCssReferences(source);
  if (!PARSEABLE_EXTENSIONS.has(path.extname(file))) return [];
  const script = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const references = new Map<string, SourceReference>();
  const add = (reference: SourceReference): void => {
    references.set(
      `${reference.kind}:${reference.specifier ?? ''}:${reference.violation ?? ''}`,
      reference,
    );
  };
  for (const reference of importSpecifiersFromSourceFile(source, script, false, true))
    add(reference);
  for (const reference of script.referencedFiles)
    add({ specifier: reference.fileName, kind: 'path', resolutionMode: reference.resolutionMode });
  for (const reference of script.typeReferenceDirectives)
    add({ specifier: reference.fileName, kind: 'types', resolutionMode: reference.resolutionMode });
  for (const reference of script.libReferenceDirectives)
    add({ specifier: reference.fileName, kind: 'lib', resolutionMode: reference.resolutionMode });
  if (includeViteAssets) {
    for (const reference of viteAssetReferences(script)) add(reference);
  }
  return [...references.values()].sort((left, right) =>
    compare(
      `${left.kind}:${left.specifier ?? ''}:${left.violation ?? ''}`,
      `${right.kind}:${right.specifier ?? ''}:${right.violation ?? ''}`,
    ),
  );
}

function localAssetSpecifier(specifier: string): string | null {
  const asset = specifier.trim().split(/[?#]/, 1)[0] ?? '';
  if (asset === '') return null;
  if (/^(?:data|blob|https?|mailto|tel):/i.test(asset) || asset.startsWith('//')) return null;
  return asset;
}

function emittedAssetPath(isolatedRoot: SafeRoot, file: string, specifier: string): string | null {
  const asset = localAssetSpecifier(specifier);
  if (asset === null) return null;
  if (/^file:/i.test(asset)) {
    throw new Error(
      `file URL emitted asset reference ${specifier} from ${normalizedRelative(isolatedRoot.path, file)}`,
    );
  }
  if (asset.startsWith('/')) {
    return path.resolve(isolatedRoot.path, 'apps/desktop-renderer/dist-target-rc', `.${asset}`);
  }
  if (path.isAbsolute(asset)) {
    throw new Error(
      `absolute emitted asset reference ${specifier} from ${normalizedRelative(isolatedRoot.path, file)}`,
    );
  }
  return path.resolve(path.dirname(file), asset);
}

function fallbackToolchain(): TargetRcToolchain {
  return Object.freeze({
    node: process.version,
    typescript: ts.version,
    vite: viteVersion,
    plugins: [],
  });
}

function emptyReport(input: {
  readonly entrypoints: readonly string[];
  readonly runtimeEntrypoints?: readonly string[];
  readonly emittedAuditRoots?: readonly string[];
  readonly inputs?: readonly TargetRcClosureFile[];
  readonly toolchain?: TargetRcToolchain;
  readonly violations: readonly string[];
}): TargetRcClosureReport {
  const files: TargetRcClosureFile[] = [];
  return Object.freeze({
    schema: TARGET_RC_CLOSURE_SCHEMA,
    entrypoints: [...input.entrypoints].sort(compare),
    runtimeEntrypoints: [...(input.runtimeEntrypoints ?? [])].sort(compare),
    emittedAuditRoots: [...(input.emittedAuditRoots ?? input.runtimeEntrypoints ?? [])].sort(
      compare,
    ),
    files,
    externalSpecifiers: [],
    inputs: [...(input.inputs ?? [])].sort((left, right) => compare(left.path, right.path)),
    toolchain: input.toolchain ?? fallbackToolchain(),
    closureSha256: sha256(JSON.stringify(files)),
    violations: [...new Set(input.violations)].sort(compare),
    ok: input.violations.length === 0,
  });
}

function targetRcConfigurationForSource(relativePath: string): string | null {
  if (relativePath === 'apps/desktop-main/src/target/preload.generated.cts')
    return 'apps/desktop-main/tsconfig.target-rc-preload.json';
  if (relativePath.startsWith('apps/desktop-main/src/target/'))
    return 'apps/desktop-main/tsconfig.target-rc.json';
  if (
    relativePath === 'apps/desktop-renderer/src/target-entry.tsx' ||
    relativePath.startsWith('apps/desktop-renderer/src/target/')
  ) {
    return 'apps/desktop-renderer/tsconfig.target-rc.json';
  }
  for (const target of Object.values(TARGET_WORKSPACE_PACKAGES)) {
    if (relativePath.startsWith(`${target.sourceRoot}/`)) return target.configuration;
  }
  return null;
}

function isExternalDependency(repositoryRoot: SafeRoot, candidate: string): boolean {
  return normalizedRelative(repositoryRoot.path, candidate).startsWith('node_modules/');
}

async function sourcePreflight(
  repositoryRoot: SafeRoot,
  entrypoints: readonly string[],
): Promise<SourcePreflightReport> {
  const pending = entrypoints.map((entrypoint) => path.resolve(repositoryRoot.path, entrypoint));
  const visited = new Set<string>();
  const files = new Map<string, string>();
  const violations: string[] = [];
  const configurations = new Map<string, Promise<ts.ParsedCommandLine>>();
  const parsedConfigurationFor = (configuration: string): Promise<ts.ParsedCommandLine> => {
    const existing = configurations.get(configuration);
    if (existing !== undefined) return existing;
    const parsed = parsedConfiguration({ repositoryRoot, configuration });
    configurations.set(configuration, parsed);
    return parsed;
  };
  const compilerOptionsForSource = async (relativePath: string): Promise<ts.CompilerOptions> => {
    const configuration = targetRcConfigurationForSource(relativePath);
    return configuration === null ? {} : (await parsedConfigurationFor(configuration)).options;
  };
  const resolveTargetSource = async (
    specifier: string,
    relativePath: string,
    kind: 'import' | 'types',
  ): Promise<void> => {
    const target = targetWorkspaceSpecifier(specifier);
    if (target === null) {
      violations.push(
        `legacy workspace package ${kind === 'types' ? 'type reference' : 'import'} ${specifier} from ${relativePath}`,
      );
      return;
    }
    const resolved = await resolveSourceFile(
      repositoryRoot,
      sourceWorkspaceResolution(repositoryRoot.path, specifier)!,
    );
    if (resolved === null) {
      violations.push(
        `unresolved target workspace ${kind === 'types' ? 'type reference' : 'import'} ${specifier} from ${relativePath}`,
      );
    } else {
      pending.push(resolved);
    }
  };
  const auditBareImport = async (
    reference: SourceReference,
    file: string,
    relativePath: string,
    compilerOptions: ts.CompilerOptions | undefined,
  ): Promise<void> => {
    const specifier = reference.specifier!;
    const options = compilerOptions ?? (await compilerOptionsForSource(relativePath));
    const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule
      ?.resolvedFileName;
    const target = targetWorkspaceSpecifier(specifier);
    if (specifier.startsWith('@lucid-fin/') && target === null) {
      violations.push(`legacy workspace package import ${specifier} from ${relativePath}`);
      return;
    }
    if (target !== null) {
      const expected = await resolveSourceFile(
        repositoryRoot,
        sourceWorkspaceResolution(repositoryRoot.path, specifier)!,
      );
      if (expected === null) {
        violations.push(`unresolved target workspace import ${specifier} from ${relativePath}`);
        return;
      }
      if (resolved === undefined) {
        if (hasCompilerPathMapping(options, specifier)) {
          violations.push(`unresolved source ${reference.kind} ${specifier} from ${relativePath}`);
          return;
        }
        pending.push(expected);
        return;
      }
      await safeFile(repositoryRoot, resolved);
      const targetRoot = TARGET_WORKSPACE_PACKAGES[target];
      const targetDistribution = path.join(repositoryRoot.path, targetRoot.packageRoot, 'dist');
      if (path.resolve(resolved) !== expected && !isInside(targetDistribution, resolved)) {
        violations.push(
          `target workspace import ${specifier} resolves outside approved source: ${normalizedRelative(repositoryRoot.path, resolved)} from ${relativePath}`,
        );
        return;
      }
      pending.push(expected);
      return;
    }
    if (resolved === undefined) {
      if (isNodeBuiltinSpecifier(specifier)) return;
      violations.push(`unresolved source ${reference.kind} ${specifier} from ${relativePath}`);
      return;
    }
    await safeFile(repositoryRoot, resolved);
    const resolvedRelativePath = normalizedRelative(repositoryRoot.path, resolved);
    if (sourceAllowed(resolvedRelativePath)) {
      pending.push(resolved);
    } else if (!isExternalDependency(repositoryRoot, resolved)) {
      violations.push(`legacy or non-target source reached: ${resolvedRelativePath}`);
    }
  };
  const auditTypeReference = async (
    reference: SourceReference,
    file: string,
    relativePath: string,
    compilerOptions: ts.CompilerOptions | undefined,
  ): Promise<void> => {
    const specifier = reference.specifier!;
    if (isLocalFileSpecifier(specifier)) {
      violations.push(`local file source type reference ${specifier} from ${relativePath}`);
      return;
    }
    if (specifier.startsWith('.')) {
      const resolved = await resolveSourceFile(
        repositoryRoot,
        path.resolve(path.dirname(file), specifier),
      );
      if (resolved === null) {
        violations.push(`unresolved source type reference ${specifier} from ${relativePath}`);
      } else {
        pending.push(resolved);
      }
      return;
    }
    if (specifier.startsWith('@lucid-fin/')) {
      await resolveTargetSource(specifier, relativePath, 'types');
      return;
    }
    const options = compilerOptions ?? (await compilerOptionsForSource(relativePath));
    const resolved = ts.resolveTypeReferenceDirective(
      specifier,
      file,
      options,
      ts.sys,
      undefined,
      undefined,
      reference.resolutionMode,
    ).resolvedTypeReferenceDirective?.resolvedFileName;
    if (resolved === undefined) {
      violations.push(`unresolved source type reference ${specifier} from ${relativePath}`);
      return;
    }
    await safeFile(repositoryRoot, resolved);
    const resolvedRelativePath = normalizedRelative(repositoryRoot.path, resolved);
    if (sourceAllowed(resolvedRelativePath)) {
      pending.push(resolved);
    } else if (!isExternalDependency(repositoryRoot, resolved)) {
      violations.push(`legacy or non-target source reached: ${resolvedRelativePath}`);
    }
  };
  const auditLibReference = async (
    reference: SourceReference,
    file: string,
    relativePath: string,
  ): Promise<void> => {
    const specifier = reference.specifier!;
    if (specifier.startsWith('@lucid-fin/')) {
      violations.push(`legacy workspace package lib reference ${specifier} from ${relativePath}`);
      return;
    }
    const libraryMap = (ts as typeof ts & { readonly libMap?: ReadonlyMap<string, string> }).libMap;
    const libraryFileName = libraryMap?.get(specifier.toLowerCase());
    if (libraryFileName === undefined) {
      violations.push(`unresolved source lib reference ${specifier} from ${relativePath}`);
      return;
    }
    const options = await compilerOptionsForSource(relativePath);
    const libraryResolver = ts as typeof ts & {
      resolveLibrary?: (
        libraryName: string,
        resolveFrom: string,
        compilerOptions: ts.CompilerOptions,
        host: ts.ModuleResolutionHost,
      ) => ts.ResolvedModuleWithFailedLookupLocations;
    };
    const replacement = options.libReplacement
      ? libraryResolver.resolveLibrary?.(
          `@typescript/lib-${specifier.toLowerCase()}`,
          file,
          options,
          ts.sys,
        ).resolvedModule?.resolvedFileName
      : undefined;
    const resolved =
      replacement ?? path.join(path.dirname(ts.getDefaultLibFilePath(options)), libraryFileName);
    await safeFile(repositoryRoot, resolved);
    const resolvedRelativePath = normalizedRelative(repositoryRoot.path, resolved);
    if (sourceAllowed(resolvedRelativePath)) {
      pending.push(resolved);
    } else if (!isExternalDependency(repositoryRoot, resolved)) {
      violations.push(`legacy or non-target source reached: ${resolvedRelativePath}`);
    }
  };
  const auditReference = async (
    reference: SourceReference,
    file: string,
    relativePath: string,
    compilerOptions?: ts.CompilerOptions,
  ): Promise<void> => {
    const { specifier, kind } = reference;
    if (reference.violation !== undefined) {
      violations.push(`${reference.violation} from ${relativePath}`);
      return;
    }
    if (specifier === null) {
      violations.push(`non-literal dynamic ${kind} from ${relativePath}`);
      return;
    }
    if (kind === 'path') {
      if (isLocalFileSpecifier(specifier)) {
        violations.push(`local file source path reference ${specifier} from ${relativePath}`);
        return;
      }
      const resolved = await resolveSourceFile(
        repositoryRoot,
        path.resolve(path.dirname(file), specifier),
      );
      if (resolved === null) {
        violations.push(`unresolved source path reference ${specifier} from ${relativePath}`);
      } else {
        pending.push(resolved);
      }
      return;
    }
    if (kind === 'types') {
      await auditTypeReference(reference, file, relativePath, compilerOptions);
      return;
    }
    if (kind === 'lib') {
      await auditLibReference(reference, file, relativePath);
      return;
    }
    if (kind === 'asset') {
      const asset = localAssetSpecifier(specifier);
      if (asset === null) return;
      if (/^file:/i.test(asset) || path.isAbsolute(asset)) {
        violations.push(`local file source asset ${specifier} from ${relativePath}`);
        return;
      }
      const resolved = await resolveSourceFile(
        repositoryRoot,
        path.resolve(path.dirname(file), asset),
      );
      if (resolved === null) {
        violations.push(`unresolved source asset ${specifier} from ${relativePath}`);
      } else {
        pending.push(resolved);
      }
      return;
    }
    if (isLocalFileSpecifier(specifier)) {
      violations.push(`local file source import ${specifier} from ${relativePath}`);
      return;
    }
    if (specifier.startsWith('.')) {
      const resolved = await resolveSourceFile(
        repositoryRoot,
        path.resolve(path.dirname(file), specifier),
      );
      if (resolved === null) {
        violations.push(`unresolved relative import ${specifier} from ${relativePath}`);
      } else {
        pending.push(resolved);
      }
      return;
    }
    await auditBareImport(reference, file, relativePath, compilerOptions);
  };
  const auditPendingFiles = async (): Promise<void> => {
    while (pending.length > 0) {
      const file = pending.pop();
      if (file === undefined || visited.has(file)) continue;
      visited.add(file);
      try {
        await safeFile(repositoryRoot, file);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        violations.push(
          cause instanceof UnsafePathError
            ? message
            : `source is missing: ${normalizedRelative(repositoryRoot.path, file)}`,
        );
        continue;
      }
      const relativePath = normalizedRelative(repositoryRoot.path, file);
      if (!sourceAllowed(relativePath)) {
        violations.push(`legacy or non-target source reached: ${relativePath}`);
        continue;
      }
      const source = await safeReadFile(repositoryRoot, file);
      files.set(relativePath, sha256(source));
      const rendererSource =
        relativePath === 'apps/desktop-renderer/src/target-entry.tsx' ||
        relativePath.startsWith('apps/desktop-renderer/src/target/');
      for (const reference of sourceReferences(file, source, rendererSource)) {
        try {
          await auditReference(reference, file, relativePath);
        } catch (cause) {
          violations.push(cause instanceof Error ? cause.message : String(cause));
        }
      }
    }
  };
  const enqueueTypeRootSources = async (directory: string): Promise<void> => {
    const visit = async (current: string): Promise<void> => {
      await safeDirectory(repositoryRoot, current);
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const candidate = path.join(current, entry.name);
        await assertSafePath(repositoryRoot, candidate);
        if (entry.isDirectory()) {
          await visit(candidate);
        } else if (entry.isFile() && PARSEABLE_EXTENSIONS.has(path.extname(candidate))) {
          pending.push(candidate);
        }
      }
    };
    await visit(directory);
  };

  await auditPendingFiles();
  if (violations.length === 0) {
    for (const configuration of TARGET_RC_TYPE_SCRIPT_CONFIGURATIONS) {
      try {
        const parsed = await parsedConfigurationFor(configuration);
        const file = path.join(repositoryRoot.path, configuration);
        for (const rootName of parsed.fileNames) pending.push(rootName);
        for (const configuredTypeRoot of parsed.options.typeRoots ?? []) {
          const typeRoot = path.isAbsolute(configuredTypeRoot)
            ? configuredTypeRoot
            : path.resolve(path.dirname(file), configuredTypeRoot);
          await safeDirectory(repositoryRoot, typeRoot);
          if (!isExternalDependency(repositoryRoot, typeRoot)) {
            await enqueueTypeRootSources(typeRoot);
          }
        }
        const typeReferences = new Set([
          ...(parsed.options.types ?? []),
          ...ts.getAutomaticTypeDirectiveNames(parsed.options, ts.sys),
        ]);
        for (const specifier of [...typeReferences].sort(compare)) {
          await auditReference({ specifier, kind: 'types' }, file, configuration, parsed.options);
        }
      } catch (cause) {
        violations.push(cause instanceof Error ? cause.message : String(cause));
      }
    }
    await auditPendingFiles();
  }

  return {
    files: [...files.entries()]
      .map(([filePath, fileSha256]) => ({ path: filePath, sha256: fileSha256 }))
      .sort((left, right) => compare(left.path, right.path)),
    violations: [...new Set(violations)].sort(compare),
  };
}

export async function targetRcSourcePreflightViolations(
  repositoryRoot: string,
  entrypoints: readonly string[] = TARGET_RC_ENTRYPOINTS,
): Promise<string[]> {
  try {
    return [
      ...(await sourcePreflight(await safeRoot(repositoryRoot), [...entrypoints].sort(compare)))
        .violations,
    ];
  } catch (cause) {
    return [cause instanceof Error ? cause.message : String(cause)];
  }
}

export async function assertTargetRcSourcePreflight(
  repositoryRoot: string,
  entrypoints: readonly string[] = TARGET_RC_ENTRYPOINTS,
): Promise<void> {
  const violations = await targetRcSourcePreflightViolations(repositoryRoot, entrypoints);
  if (violations.length > 0) {
    throw new Error(`Target RC source preflight failed:\n${violations.join('\n')}`);
  }
}

function packageSubpath(packageName: TargetWorkspacePackageName, specifier: string): string {
  return specifier === packageName ? '.' : `.${specifier.slice(packageName.length)}`;
}

function conditionTarget(
  value: unknown,
  condition: RuntimeResolutionKind | 'types',
): string | null {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return conditionTarget(record[condition] ?? record.default, condition);
}

function manifestTarget(
  manifest: Record<string, unknown>,
  subpath: string,
  condition: RuntimeResolutionKind | 'types',
): string | null {
  const exportsValue = manifest.exports;
  if (exportsValue !== undefined) {
    if (typeof exportsValue === 'string') return subpath === '.' ? exportsValue : null;
    if (exportsValue !== null && typeof exportsValue === 'object' && !Array.isArray(exportsValue)) {
      const exportsRecord = exportsValue as Record<string, unknown>;
      const hasSubpathKeys = Object.keys(exportsRecord).some((key) => key.startsWith('.'));
      return conditionTarget(hasSubpathKeys ? exportsRecord[subpath] : exportsRecord, condition);
    }
    return null;
  }
  if (subpath !== '.') return null;
  const direct = condition === 'types' ? manifest.types : manifest.main;
  return typeof direct === 'string' ? direct : null;
}

async function targetPackageManifests(repositoryRoot: SafeRoot): Promise<TargetPackageManifest[]> {
  return Promise.all(
    (Object.keys(TARGET_WORKSPACE_PACKAGES) as TargetWorkspacePackageName[]).map(async (name) => {
      const target = TARGET_WORKSPACE_PACKAGES[name];
      const pathToManifest = path.join(repositoryRoot.path, target.packageRoot, 'package.json');
      const source = await safeReadFile(repositoryRoot, pathToManifest);
      const parsed: unknown = JSON.parse(source);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error(
          `Target package manifest is not an object: ${target.packageRoot}/package.json`,
        );
      }
      return { name, packageRoot: target.packageRoot, manifest: parsed as Record<string, unknown> };
    }),
  );
}

function targetExternalRuntimeDependencies(manifests: readonly TargetPackageManifest[]): string[] {
  const dependencies = new Set<string>();
  for (const { manifest, name } of manifests) {
    const declared = manifest.dependencies;
    if (declared === undefined) continue;
    if (!isRecord(declared)) {
      throw new Error(`Target package dependencies are not an object: ${name}`);
    }
    for (const [dependency, range] of Object.entries(declared)) {
      if (typeof range !== 'string') {
        throw new Error(`Target package dependency range is invalid: ${name} -> ${dependency}`);
      }
      if (targetWorkspaceSpecifier(dependency) === null) dependencies.add(dependency);
    }
  }
  return [...dependencies].sort(compare);
}

function targetPackageRuntimeSpecifiers(manifest: TargetPackageManifest): string[] {
  const exported = manifest.manifest.exports;
  if (!isRecord(exported) || !Object.keys(exported).some((key) => key.startsWith('.'))) {
    return [manifest.name];
  }
  return Object.keys(exported)
    .filter((subpath) => subpath.startsWith('.'))
    .map((subpath) => {
      if (subpath.includes('*')) {
        throw new Error(
          `Target package wildcard export is unsupported: ${manifest.name} -> ${subpath}`,
        );
      }
      return subpath === '.' ? manifest.name : `${manifest.name}${subpath.slice(1)}`;
    })
    .sort((left, right) => right.length - left.length || compare(left, right));
}

function packageManifestFor(
  manifests: readonly TargetPackageManifest[],
  name: TargetWorkspacePackageName,
): TargetPackageManifest {
  const manifest = manifests.find((candidate) => candidate.name === name);
  if (manifest === undefined) throw new Error(`Target package manifest is unavailable: ${name}`);
  return manifest;
}

function emittedPackageTarget(
  isolatedRoot: SafeRoot,
  manifest: TargetPackageManifest,
  specifier: string,
  condition: RuntimeResolutionKind | 'types',
): string | null {
  const target = manifestTarget(
    manifest.manifest,
    packageSubpath(manifest.name, specifier),
    condition,
  );
  if (target === null) return null;
  const packageRoot = path.join(isolatedRoot.path, manifest.packageRoot);
  const resolved = path.resolve(packageRoot, target);
  if (!isInside(packageRoot, resolved)) {
    throw new Error(
      `target package export escapes isolated package: ${manifest.name} -> ${target}`,
    );
  }
  return resolved;
}

function diagnosticText(diagnostics: readonly ts.Diagnostic[], repositoryRoot: string): string {
  return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => repositoryRoot,
    getNewLine: () => '\n',
  });
}

function compilerHostWithIsolatedPackages(input: {
  readonly options: ts.CompilerOptions;
  readonly manifests: readonly TargetPackageManifest[];
  readonly repositoryRoot: SafeRoot;
  readonly isolatedRoot: SafeRoot;
}): ts.CompilerHost {
  const host = ts.createCompilerHost(input.options);
  const resolutionCache = ts.createModuleResolutionCache(
    input.repositoryRoot.path,
    host.getCanonicalFileName,
    input.options,
  );
  const resolver = host as ts.CompilerHost & {
    resolveModuleNames?: (
      moduleNames: string[],
      containingFile: string,
      reusedNames?: string[],
      redirectedReference?: ts.ResolvedProjectReference,
      options?: ts.CompilerOptions,
      containingSourceFile?: ts.SourceFile,
    ) => (ts.ResolvedModuleFull | undefined)[];
    resolveModuleNameLiterals?: (
      moduleLiterals: readonly ts.StringLiteralLike[],
      containingFile: string,
      redirectedReference: ts.ResolvedProjectReference | undefined,
      options: ts.CompilerOptions,
      containingSourceFile: ts.SourceFile,
      reusedNames: readonly ts.StringLiteralLike[] | undefined,
    ) => readonly ts.ResolvedModuleWithFailedLookupLocations[];
  };
  const resolve = (
    moduleName: string,
    containingFile: string,
  ): ts.ResolvedModuleFull | undefined => {
    const packageName = targetWorkspaceSpecifier(moduleName);
    if (packageName !== null) {
      const target = emittedPackageTarget(
        input.isolatedRoot,
        packageManifestFor(input.manifests, packageName),
        moduleName,
        'types',
      );
      if (target === null) return undefined;
      return {
        resolvedFileName: target,
        extension: ts.Extension.Dts,
        isExternalLibraryImport: true,
      };
    }
    const externalContainingFile =
      isInside(input.isolatedRoot.path, containingFile) &&
      !moduleName.startsWith('.') &&
      !path.isAbsolute(moduleName)
        ? path.join(input.repositoryRoot.path, 'package.json')
        : containingFile;
    return ts.resolveModuleName(
      moduleName,
      externalContainingFile,
      input.options,
      host,
      resolutionCache,
    ).resolvedModule;
  };
  resolver.resolveModuleNames = (moduleNames, containingFile) =>
    moduleNames.map((moduleName) => resolve(moduleName, containingFile));
  resolver.resolveModuleNameLiterals = (moduleLiterals, containingFile) =>
    moduleLiterals.map((moduleLiteral) => ({
      resolvedModule: resolve(moduleLiteral.text, containingFile),
    }));
  return host;
}

async function parsedConfiguration(input: {
  readonly repositoryRoot: SafeRoot;
  readonly configuration: string;
}): Promise<ts.ParsedCommandLine> {
  const configurationPath = path.join(input.repositoryRoot.path, input.configuration);
  const source = await safeReadFile(input.repositoryRoot, configurationPath);
  const read = ts.parseConfigFileTextToJson(configurationPath, source);
  if (read.error !== undefined) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(
    read.config,
    ts.sys,
    path.dirname(configurationPath),
    undefined,
    configurationPath,
  );
  if (parsed.errors.length > 0)
    throw new Error(diagnosticText(parsed.errors, input.repositoryRoot.path));
  await Promise.all(parsed.fileNames.map((file) => safeFile(input.repositoryRoot, file)));
  return parsed;
}

async function compilationSourceInputs(repositoryRoot: SafeRoot): Promise<TargetRcClosureFile[]> {
  const sources = new Map<string, string>();
  for (const configuration of TARGET_RC_TYPE_SCRIPT_CONFIGURATIONS) {
    const parsed = await parsedConfiguration({ repositoryRoot, configuration });
    for (const file of parsed.fileNames) {
      const relativePath = normalizedRelative(repositoryRoot.path, file);
      if (!sourceAllowed(relativePath)) {
        throw new Error(`legacy or non-target source configured: ${relativePath}`);
      }
      sources.set(relativePath, await safeReadFile(repositoryRoot, file));
    }
  }
  return [...sources.entries()]
    .map(([filePath, source]) => ({ path: filePath, sha256: sha256(source) }))
    .sort((left, right) => compare(left.path, right.path));
}

async function outputArtifacts(
  isolatedRoot: SafeRoot,
  directory: string,
): Promise<TargetRcEmittedArtifact[]> {
  const artifacts: TargetRcEmittedArtifact[] = [];
  const visit = async (current: string): Promise<void> => {
    await assertSafePath(isolatedRoot, current);
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      await assertSafePath(isolatedRoot, candidate);
      if (entry.isDirectory()) {
        await visit(candidate);
      } else if (entry.isFile()) {
        const content = await readFile(candidate);
        artifacts.push({
          path: normalizedRelative(isolatedRoot.path, candidate),
          bytes: content.byteLength,
          sha256: sha256(content),
        });
      } else {
        throw new UnsafePathError(
          `unsafe emitted artifact: ${normalizedRelative(isolatedRoot.path, candidate)}`,
        );
      }
    }
  };
  await visit(directory);
  return artifacts.sort((left, right) => compare(left.path, right.path));
}

async function assertNoIsolatedPathMarker(
  isolatedRoot: SafeRoot,
  artifacts: readonly TargetRcEmittedArtifact[],
): Promise<void> {
  const marker = path.basename(isolatedRoot.path);
  for (const artifact of artifacts) {
    if (!/\.(?:[cm]?js|css|html)$/i.test(artifact.path)) continue;
    const source = await safeReadFile(isolatedRoot, path.join(isolatedRoot.path, artifact.path));
    if (source.includes(marker)) {
      throw new Error(`isolated build path leaked into emitted artifact ${artifact.path}`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function viteChunkModuleIds(buildResult: unknown): string[] {
  const moduleIds = new Set<string>();
  let hasChunk = false;
  for (const output of Array.isArray(buildResult) ? buildResult : [buildResult]) {
    if (!isRecord(output) || !Array.isArray(output.output)) {
      throw new Error('Vite build did not return chunk module provenance');
    }
    for (const chunk of output.output) {
      if (!isRecord(chunk) || chunk.type !== 'chunk') continue;
      if (!isRecord(chunk.modules)) {
        throw new Error('Vite output chunk is missing module provenance');
      }
      hasChunk = true;
      for (const moduleId of Object.keys(chunk.modules)) moduleIds.add(moduleId);
    }
  }
  if (!hasChunk) throw new Error('Vite build did not return output chunks');
  return [...moduleIds].sort(compare);
}

async function assertTargetRcViteInputProvenance(input: {
  readonly sourceRoot: SafeRoot;
  readonly isolatedRoot: SafeRoot;
  readonly buildResult: unknown;
}): Promise<void> {
  for (const moduleId of viteChunkModuleIds(input.buildResult)) {
    if (VITE_INTERNAL_MODULE_IDS.has(moduleId)) continue;
    if (
      moduleId.startsWith('\0') ||
      moduleId.startsWith('virtual:') ||
      moduleId.startsWith('vite:')
    ) {
      throw new Error(`unverified Vite virtual module: ${moduleId}`);
    }
    if (!path.isAbsolute(moduleId)) throw new Error(`unverified Vite module: ${moduleId}`);
    if (isInside(input.sourceRoot.path, moduleId)) {
      await safeFile(input.sourceRoot, moduleId);
      const relativePath = normalizedRelative(input.sourceRoot.path, moduleId);
      if (sourceAllowed(relativePath) || isExternalDependency(input.sourceRoot, moduleId)) continue;
      throw new Error(`legacy or non-target Vite input: ${relativePath}`);
    }
    if (isInside(input.isolatedRoot.path, moduleId)) {
      await safeFile(input.isolatedRoot, moduleId);
      const relativePath = normalizedRelative(input.isolatedRoot.path, moduleId);
      if (emittedAllowed(relativePath)) continue;
      throw new Error(`legacy or non-target isolated Vite input: ${relativePath}`);
    }
    throw new Error(`Vite input escapes approved roots: ${moduleId}`);
  }
}

async function emitTypeScriptProject(input: {
  readonly repositoryRoot: SafeRoot;
  readonly isolatedRoot: SafeRoot;
  readonly configuration: string;
  readonly outputDirectory: string;
  readonly manifests: readonly TargetPackageManifest[];
}): Promise<TargetRcEmittedArtifact[]> {
  const parsed = await parsedConfiguration(input);
  const outputDirectory = path.join(input.isolatedRoot.path, input.outputDirectory);
  const options: ts.CompilerOptions = {
    ...parsed.options,
    noEmit: false,
    noEmitOnError: true,
    outDir: outputDirectory,
    tsBuildInfoFile: path.join(
      input.isolatedRoot.path,
      '.tsbuildinfo',
      `${input.configuration.replaceAll(/[\\/]/g, '__')}.tsbuildinfo`,
    ),
  };
  const host = compilerHostWithIsolatedPackages({
    options,
    manifests: input.manifests,
    repositoryRoot: input.repositoryRoot,
    isolatedRoot: input.isolatedRoot,
  });
  const program = ts.createProgram({ rootNames: parsed.fileNames, options, host });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0)
    throw new Error(diagnosticText(diagnostics, input.repositoryRoot.path));
  const emitted = program.emit();
  if (emitted.emitSkipped) {
    throw new Error(`Target RC TypeScript emit skipped for ${input.configuration}`);
  }
  return outputArtifacts(input.isolatedRoot, outputDirectory);
}

async function validateTypeScriptProject(input: {
  readonly repositoryRoot: SafeRoot;
  readonly isolatedRoot: SafeRoot;
  readonly configuration: string;
  readonly manifests: readonly TargetPackageManifest[];
}): Promise<void> {
  const parsed = await parsedConfiguration(input);
  const options: ts.CompilerOptions = {
    ...parsed.options,
    noEmit: true,
    noEmitOnError: true,
    tsBuildInfoFile: path.join(
      input.isolatedRoot.path,
      '.tsbuildinfo',
      `${input.configuration.replaceAll(/[\\/]/g, '__')}.tsbuildinfo`,
    ),
  };
  const host = compilerHostWithIsolatedPackages({
    options,
    manifests: input.manifests,
    repositoryRoot: input.repositoryRoot,
    isolatedRoot: input.isolatedRoot,
  });
  const program = ts.createProgram({ rootNames: parsed.fileNames, options, host });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0)
    throw new Error(diagnosticText(diagnostics, input.repositoryRoot.path));
}

function propertyName(node: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text;
  }
  return undefined;
}

function isApprovedTargetRcHtmlHook(node: ts.Node, hook: string): boolean {
  if (hook !== 'generateBundle') return false;
  for (
    let current: ts.Node | undefined = node.parent;
    current !== undefined;
    current = current.parent
  ) {
    if (ts.isFunctionDeclaration(current)) return current.name?.text === 'targetRcHtmlPlugin';
  }
  return false;
}

function assertTargetRcViteConfigurationContract(source: string): void {
  const script = ts.createSourceFile(
    'apps/desktop-renderer/vite.target-rc.config.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (node: ts.Node): void => {
    if (ts.isMethodDeclaration(node) || ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (
        name !== undefined &&
        VITE_PLUGIN_HOOK_NAMES.has(name) &&
        !isApprovedTargetRcHtmlHook(node, name)
      ) {
        throw new Error(`unauthorized Target RC Vite plugin hook: ${name}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(script);
  if (sha256(source) !== TARGET_RC_VITE_CONFIGURATION_SHA256) {
    throw new Error('Target RC Vite configuration differs from the approved contract');
  }
}

function flattenVitePluginOptions(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(flattenVitePluginOptions);
  if (value === undefined || value === null || value === false) return [];
  return [value];
}

function assertTargetRcVitePluginContract(plugins: unknown): void {
  const actual = flattenVitePluginOptions(plugins).map((plugin) => {
    if (!isRecord(plugin) || typeof plugin.name !== 'string') {
      throw new Error('Target RC Vite plugin contract contains an unverified plugin');
    }
    if (Object.getOwnPropertySymbols(plugin).length > 0) {
      throw new Error(`Target RC Vite plugin contract contains symbols: ${plugin.name}`);
    }
    return {
      name: plugin.name,
      properties: Object.getOwnPropertyNames(plugin).sort(compare),
    };
  });
  if (JSON.stringify(actual) !== JSON.stringify(TARGET_RC_VITE_PLUGIN_CONTRACT)) {
    throw new Error('Target RC Vite plugin contract differs from the approved contract');
  }
}

async function configurationInputs(repositoryRoot: SafeRoot): Promise<TargetRcClosureFile[]> {
  const pending = [...TARGET_RC_TYPE_SCRIPT_CONFIGURATIONS];
  const visited = new Set<string>();
  const configurations = new Map<string, string>();
  while (pending.length > 0) {
    const relativePath = pending.pop();
    if (relativePath === undefined || visited.has(relativePath)) continue;
    visited.add(relativePath);
    const absolute = path.join(repositoryRoot.path, relativePath);
    const source = await safeReadFile(repositoryRoot, absolute);
    configurations.set(relativePath, source);
    const parsed = ts.parseConfigFileTextToJson(absolute, source);
    if (parsed.error !== undefined) {
      throw new Error(ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n'));
    }
    const extendsValue =
      parsed.config !== null && typeof parsed.config === 'object' && !Array.isArray(parsed.config)
        ? (parsed.config as Record<string, unknown>).extends
        : undefined;
    const inherited =
      typeof extendsValue === 'string'
        ? [extendsValue]
        : Array.isArray(extendsValue) && extendsValue.every((value) => typeof value === 'string')
          ? extendsValue
          : extendsValue === undefined
            ? []
            : null;
    if (inherited === null) {
      throw new Error(`Invalid inherited tsconfig in ${relativePath}`);
    }
    for (const inheritedConfiguration of inherited) {
      if (!inheritedConfiguration.startsWith('.')) {
        throw new Error(
          `Non-local inherited tsconfig is unsupported: ${relativePath} -> ${inheritedConfiguration}`,
        );
      }
      const candidate = path.resolve(path.dirname(absolute), inheritedConfiguration);
      const withExtension = path.extname(candidate) === '' ? `${candidate}.json` : candidate;
      pending.push(normalizedRelative(repositoryRoot.path, withExtension));
    }
  }
  const viteConfiguration = 'apps/desktop-renderer/vite.target-rc.config.ts';
  const viteSource = await safeReadFile(
    repositoryRoot,
    path.join(repositoryRoot.path, viteConfiguration),
  );
  assertTargetRcViteConfigurationContract(viteSource);
  for (const { specifier, violation } of importSpecifiers(viteConfiguration, viteSource)) {
    if (
      violation !== undefined ||
      specifier === null ||
      !TARGET_RC_VITE_CONFIGURATION_IMPORTS.has(specifier)
    ) {
      throw new Error(`Unsupported Vite configuration import in ${viteConfiguration}`);
    }
  }
  configurations.set(viteConfiguration, viteSource);
  return [...configurations.entries()]
    .map(([filePath, source]) => ({ path: filePath, sha256: sha256(source) }))
    .sort((left, right) => compare(left.path, right.path));
}

async function evidenceInputs(
  repositoryRoot: SafeRoot,
  configurations: readonly TargetRcClosureFile[],
  compilationSources: readonly TargetRcClosureFile[],
): Promise<TargetRcClosureFile[]> {
  const inputHashes = new Map<string, string>();
  for (const configuration of configurations) {
    inputHashes.set(
      configuration.path,
      sha256(
        await safeReadFile(repositoryRoot, path.join(repositoryRoot.path, configuration.path)),
      ),
    );
  }
  for (const relativePath of TARGET_RC_PACKAGE_MANIFESTS) {
    inputHashes.set(
      relativePath,
      sha256(await safeReadFile(repositoryRoot, path.join(repositoryRoot.path, relativePath))),
    );
  }
  for (const source of compilationSources) {
    inputHashes.set(source.path, source.sha256);
  }
  return [...inputHashes.entries()]
    .map(([filePath, fileSha256]) => ({ path: filePath, sha256: fileSha256 }))
    .sort((left, right) => compare(left.path, right.path));
}

function assertCleanSourcePreflight(preflight: SourcePreflightReport): void {
  if (preflight.violations.length > 0) {
    throw new Error(`Target RC source preflight failed:\n${preflight.violations.join('\n')}`);
  }
}

async function targetRcVerificationSnapshot(
  repositoryRoot: SafeRoot,
  entrypoints: readonly string[],
): Promise<TargetRcVerificationSnapshot> {
  const preflight = await sourcePreflight(repositoryRoot, entrypoints);
  assertCleanSourcePreflight(preflight);
  const configurations = await configurationInputs(repositoryRoot);
  const compilationSources = await compilationSourceInputs(repositoryRoot);
  const inputs = await evidenceInputs(repositoryRoot, configurations, compilationSources);
  return {
    sourceClosure: preflight.files,
    configurations,
    inputs,
  };
}

function snapshotMatches(
  first: TargetRcVerificationSnapshot,
  second: TargetRcVerificationSnapshot,
): boolean {
  return (
    JSON.stringify(first.sourceClosure) === JSON.stringify(second.sourceClosure) &&
    JSON.stringify(first.configurations) === JSON.stringify(second.configurations) &&
    JSON.stringify(first.inputs) === JSON.stringify(second.inputs)
  );
}

function assertTargetRcVerificationSnapshotMatches(
  first: TargetRcVerificationSnapshot,
  second: TargetRcVerificationSnapshot,
): void {
  if (!snapshotMatches(first, second)) {
    throw new Error('Target RC source closure or inputs changed during isolated build');
  }
}

async function installedPackageVersion(
  repositoryRoot: SafeRoot,
  packageName: string,
): Promise<string> {
  const require = createRequire(path.join(repositoryRoot.path, 'package.json'));
  let current = path.dirname(require.resolve(packageName));
  for (;;) {
    const candidate = path.join(current, 'package.json');
    try {
      const source = await safeReadFile(repositoryRoot, candidate);
      const parsed: unknown = JSON.parse(source);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        (parsed as Record<string, unknown>).name === packageName &&
        typeof (parsed as Record<string, unknown>).version === 'string'
      ) {
        return (parsed as Record<string, string>).version;
      }
    } catch (cause) {
      if (cause instanceof UnsafePathError) throw cause;
    }
    const parent = path.dirname(current);
    if (parent === current)
      throw new Error(`Unable to determine installed version for ${packageName}`);
    current = parent;
  }
}

async function toolchain(repositoryRoot: SafeRoot): Promise<TargetRcToolchain> {
  return Object.freeze({
    node: process.version,
    typescript: ts.version,
    vite: viteVersion,
    plugins: [
      {
        name: '@vitejs/plugin-react',
        version: await installedPackageVersion(repositoryRoot, '@vitejs/plugin-react'),
      },
      { name: 'rolldown', version: await installedPackageVersion(repositoryRoot, 'rolldown') },
    ].sort((left, right) => compare(left.name, right.name)),
  });
}

export async function withTargetRcIsolatedBuild<T>(
  repositoryRoot: string,
  operation: (build: TargetRcIsolatedBuild) => Promise<T> | T,
  options: TargetRcIsolatedBuildOptions = {},
): Promise<T> {
  const sourceRoot = await safeRoot(repositoryRoot);
  for (const target of Object.values(TARGET_WORKSPACE_PACKAGES)) {
    await assertSafeTree(sourceRoot, path.join(sourceRoot.path, target.sourceRoot));
  }
  await assertSafeTree(sourceRoot, path.join(sourceRoot.path, 'apps/desktop-main/src/target'));
  await assertSafeTree(sourceRoot, path.join(sourceRoot.path, 'apps/desktop-renderer/src/target'));
  const sourceEntrypoints = [...(options.sourceEntrypoints ?? TARGET_RC_ENTRYPOINTS)].sort(compare);
  const startSnapshot = await targetRcVerificationSnapshot(sourceRoot, sourceEntrypoints);
  const { configurations, inputs } = startSnapshot;
  const manifests = await targetPackageManifests(sourceRoot);
  const activeToolchain = await toolchain(sourceRoot);
  const isolatedDirectory = await mkdtemp(path.join(tmpdir(), 'lucid-fin-target-rc-'));
  try {
    const isolatedRoot = await safeRoot(isolatedDirectory);
    const contracts = await emitTypeScriptProject({
      repositoryRoot: sourceRoot,
      isolatedRoot,
      configuration: 'packages/target-contracts/tsconfig.json',
      outputDirectory: 'packages/target-contracts/dist',
      manifests,
    });
    const storage = await emitTypeScriptProject({
      repositoryRoot: sourceRoot,
      isolatedRoot,
      configuration: 'packages/target-storage/tsconfig.json',
      outputDirectory: 'packages/target-storage/dist',
      manifests,
    });
    const runtime = await emitTypeScriptProject({
      repositoryRoot: sourceRoot,
      isolatedRoot,
      configuration: 'packages/target-runtime/tsconfig.json',
      outputDirectory: 'packages/target-runtime/dist',
      manifests,
    });
    const main = await emitTypeScriptProject({
      repositoryRoot: sourceRoot,
      isolatedRoot,
      configuration: 'apps/desktop-main/tsconfig.target-rc.json',
      outputDirectory: 'apps/desktop-main/dist-target-rc',
      manifests,
    });
    const preload = await emitTypeScriptProject({
      repositoryRoot: sourceRoot,
      isolatedRoot,
      configuration: 'apps/desktop-main/tsconfig.target-rc-preload.json',
      outputDirectory: 'apps/desktop-main/dist-target-rc',
      manifests,
    });
    await validateTypeScriptProject({
      repositoryRoot: sourceRoot,
      isolatedRoot,
      configuration: 'apps/desktop-renderer/tsconfig.target-rc.json',
      manifests,
    });
    const aliases = manifests
      .flatMap((manifest) =>
        targetPackageRuntimeSpecifiers(manifest).flatMap((specifier) => {
          const runtimeTarget = emittedPackageTarget(isolatedRoot, manifest, specifier, 'import');
          return runtimeTarget === null ? [] : [{ find: specifier, replacement: runtimeTarget }];
        }),
      )
      .sort(
        (left, right) => right.find.length - left.find.length || compare(left.find, right.find),
      );
    const rendererDirectory = path.join(isolatedRoot.path, 'apps/desktop-renderer/dist-target-rc');
    const rendererRoot = path.join(sourceRoot.path, 'apps/desktop-renderer');
    const viteConfigurationPath = path.join(rendererRoot, 'vite.target-rc.config.ts');
    assertTargetRcViteConfigurationContract(await safeReadFile(sourceRoot, viteConfigurationPath));
    const loadedViteConfiguration = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      viteConfigurationPath,
      rendererRoot,
      'silent',
    );
    if (loadedViteConfiguration === null) {
      throw new Error('Target RC Vite configuration could not be loaded');
    }
    assertTargetRcVitePluginContract(loadedViteConfiguration.config.plugins);
    const viteResult = await viteBuild(
      mergeConfig(loadedViteConfiguration.config, {
        configFile: false,
        root: rendererRoot,
        logLevel: 'silent',
        resolve: {
          alias: aliases,
          dedupe: targetExternalRuntimeDependencies(manifests),
        },
        build: {
          emptyOutDir: true,
          outDir: rendererDirectory,
          write: true,
          // Rolldown renders module-region labels relative to cwd. Binding it to the isolated tree
          // keeps the random temporary-directory suffix out of the emitted renderer bundle.
          rollupOptions: { cwd: isolatedRoot.path },
        },
      }),
    );
    await assertTargetRcViteInputProvenance({
      sourceRoot,
      isolatedRoot,
      buildResult: viteResult,
    });
    const renderer = await outputArtifacts(isolatedRoot, rendererDirectory);
    await assertNoIsolatedPathMarker(isolatedRoot, renderer);
    await options.beforeFinalSourceVerification?.();
    const endSnapshot = await targetRcVerificationSnapshot(sourceRoot, sourceEntrypoints);
    assertTargetRcVerificationSnapshotMatches(startSnapshot, endSnapshot);
    const result = await operation(
      Object.freeze({
        isolatedRoot: isolatedRoot.path,
        configurations,
        inputs,
        toolchain: activeToolchain,
        packages: Object.freeze({ contracts, storage, runtime }),
        main,
        preload,
        renderer,
      }),
    );
    const finalSnapshot = await targetRcVerificationSnapshot(sourceRoot, sourceEntrypoints);
    assertTargetRcVerificationSnapshotMatches(startSnapshot, finalSnapshot);
    return result;
  } finally {
    await rm(isolatedDirectory, { force: true, recursive: true });
  }
}

export async function auditTargetRcEmittedClosure(
  options: TargetRcEmittedClosureOptions,
): Promise<TargetRcClosureReport> {
  const repositoryRoot = await safeRoot(options.repositoryRoot);
  const isolatedRoot = await safeRoot(options.isolatedRoot);
  const runtimeEntrypoints = [...options.entrypoints].sort(compare);
  const emittedAuditRoots = [
    ...new Set([
      ...options.entrypoints,
      ...(options.emittedArtifacts ?? [])
        .map((artifact) => artifact.path)
        .filter((artifactPath) =>
          RUNTIME_EXTENSIONS.some((extension) => path.extname(artifactPath) === extension),
        ),
    ]),
  ].sort(compare);
  const sourceEntrypoints = [...(options.sourceEntrypoints ?? TARGET_RC_ENTRYPOINTS)].sort(compare);
  let manifests: TargetPackageManifest[];
  try {
    manifests = await targetPackageManifests(repositoryRoot);
  } catch (cause) {
    return emptyReport({
      entrypoints: sourceEntrypoints,
      runtimeEntrypoints,
      emittedAuditRoots,
      inputs: options.inputs,
      toolchain: options.toolchain,
      violations: [cause instanceof Error ? cause.message : String(cause)],
    });
  }
  const pending = emittedAuditRoots.map((entrypoint) =>
    path.resolve(isolatedRoot.path, entrypoint),
  );
  const visited = new Set<string>();
  const externalSpecifiers = new Set<string>();
  const files: TargetRcClosureFile[] = [];
  const violations: string[] = [];

  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || visited.has(file)) continue;
    visited.add(file);
    try {
      await safeFile(isolatedRoot, file);
    } catch (cause) {
      violations.push(
        cause instanceof UnsafePathError
          ? cause.message
          : `emitted artifact is missing: ${normalizedRelative(isolatedRoot.path, file)}`,
      );
      continue;
    }
    const relativePath = normalizedRelative(isolatedRoot.path, file);
    if (!emittedAllowed(relativePath)) {
      violations.push(`legacy or non-target emitted artifact reached: ${relativePath}`);
      continue;
    }
    const source = await safeReadFile(isolatedRoot, file);
    files.push({ path: relativePath, sha256: sha256(source) });
    for (const { specifier, kind, violation } of emittedReferences(file, source)) {
      try {
        if (violation !== undefined) {
          violations.push(`${violation} from ${relativePath}`);
          continue;
        }
        if (specifier === null) {
          violations.push(`non-literal dynamic ${kind} from ${relativePath}`);
          continue;
        }
        if (kind === 'asset') {
          const candidate = emittedAssetPath(isolatedRoot, file, specifier);
          if (candidate === null) continue;
          const resolved = await resolveRuntimeFile(isolatedRoot, candidate);
          if (resolved === null) {
            violations.push(`unresolved emitted asset ${specifier} from ${relativePath}`);
          } else {
            pending.push(resolved);
          }
          continue;
        }
        if (isLocalFileSpecifier(specifier)) {
          violations.push(`local file emitted import ${specifier} from ${relativePath}`);
          continue;
        }
        if (specifier.startsWith('.')) {
          const resolved = await resolveRuntimeFile(
            isolatedRoot,
            path.resolve(path.dirname(file), specifier),
          );
          if (resolved === null) {
            violations.push(`unresolved emitted import ${specifier} from ${relativePath}`);
          } else {
            pending.push(resolved);
          }
          continue;
        }
        if (specifier.startsWith('@lucid-fin/')) {
          const packageName = targetWorkspaceSpecifier(specifier);
          if (packageName === null) {
            violations.push(`legacy workspace package import ${specifier} from ${relativePath}`);
            continue;
          }
          const resolved = emittedPackageTarget(
            isolatedRoot,
            packageManifestFor(manifests, packageName),
            specifier,
            kind,
          );
          if (resolved === null) {
            violations.push(`unresolved target package ${kind} ${specifier} from ${relativePath}`);
          } else if (!(await safePathIsFile(isolatedRoot, resolved))) {
            violations.push(`target package export is missing: ${specifier} from ${relativePath}`);
          } else {
            pending.push(resolved);
          }
          continue;
        }
        externalSpecifiers.add(specifier);
      } catch (cause) {
        violations.push(cause instanceof Error ? cause.message : String(cause));
      }
    }
  }

  files.sort((left, right) => compare(left.path, right.path));
  const sortedViolations = [...new Set(violations)].sort(compare);
  const canonicalFiles = files.map(({ path: filePath, sha256: fileSha256 }) => ({
    path: filePath,
    sha256: fileSha256,
  }));
  return Object.freeze({
    schema: TARGET_RC_CLOSURE_SCHEMA,
    entrypoints: sourceEntrypoints,
    runtimeEntrypoints,
    emittedAuditRoots,
    files: canonicalFiles,
    externalSpecifiers: [...externalSpecifiers].sort(compare),
    inputs: [...(options.inputs ?? [])].sort((left, right) => compare(left.path, right.path)),
    toolchain: options.toolchain ?? fallbackToolchain(),
    closureSha256: sha256(JSON.stringify(canonicalFiles)),
    violations: sortedViolations,
    ok: sortedViolations.length === 0,
  });
}

export async function checkTargetOnlyRc(
  options: TargetRcClosureOptions = {},
): Promise<TargetRcClosureReport> {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? repositoryRootFromModule());
  const entrypoints = [...(options.entrypoints ?? TARGET_RC_ENTRYPOINTS)].sort(compare);
  const sourceViolations = await targetRcSourcePreflightViolations(repositoryRoot, entrypoints);
  if (sourceViolations.length > 0)
    return emptyReport({ entrypoints, violations: sourceViolations });
  try {
    return await withTargetRcIsolatedBuild(
      repositoryRoot,
      (build) =>
        auditTargetRcEmittedClosure({
          repositoryRoot,
          isolatedRoot: build.isolatedRoot,
          entrypoints: TARGET_RC_RUNTIME_ENTRYPOINTS,
          emittedArtifacts: targetRcEmittedArtifacts(build),
          sourceEntrypoints: entrypoints,
          inputs: build.inputs,
          toolchain: build.toolchain,
        }),
      {
        sourceEntrypoints: entrypoints,
        beforeFinalSourceVerification: options.beforeFinalSourceVerification,
      },
    );
  } catch (cause) {
    return emptyReport({
      entrypoints,
      violations: [cause instanceof Error ? cause.message : String(cause)],
    });
  }
}

function isExecutedDirectly(
  moduleUrl: string = import.meta.url,
  argv: readonly string[] = process.argv,
): boolean {
  const script = argv[1];
  return script !== undefined && path.resolve(script) === path.resolve(fileURLToPath(moduleUrl));
}

if (isExecutedDirectly()) {
  void checkTargetOnlyRc()
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (!report.ok) process.exitCode = 1;
    })
    .catch((cause: unknown) => {
      const message = cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
