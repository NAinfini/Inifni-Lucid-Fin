import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertTargetRcSourcePreflight,
  auditTargetRcEmittedClosure,
  TARGET_RC_RUNTIME_ENTRYPOINTS,
  targetRcEmittedArtifacts,
  withTargetRcIsolatedBuild,
  type TargetRcClosureFile,
  type TargetRcClosureReport,
  type TargetRcEmittedArtifact,
  type TargetRcToolchain,
} from './check-target-only-rc.js';

export const TARGET_RC_BUILD_SCHEMA = 'lucid-fin.target-rc-build/v3';

export type TargetRcBuildArtifact = TargetRcEmittedArtifact;

export interface TargetRcBuildOptions {
  readonly beforeFinalSourceVerification?: () => Promise<void> | void;
}

export interface TargetRcBuildMetadata {
  readonly schema: typeof TARGET_RC_BUILD_SCHEMA;
  readonly closure: {
    readonly sha256: string;
    readonly files: readonly TargetRcClosureFile[];
    readonly runtimeEntrypoints: readonly string[];
    readonly emittedAuditRoots: readonly string[];
  };
  readonly configurations: readonly TargetRcClosureFile[];
  readonly inputs: readonly TargetRcClosureFile[];
  readonly inputSha256: string;
  readonly toolchain: TargetRcToolchain;
  readonly packages: {
    readonly contracts: readonly TargetRcBuildArtifact[];
    readonly storage: readonly TargetRcBuildArtifact[];
    readonly runtime: readonly TargetRcBuildArtifact[];
  };
  readonly main: readonly TargetRcBuildArtifact[];
  readonly preload: readonly TargetRcBuildArtifact[];
  readonly renderer: readonly TargetRcBuildArtifact[];
  readonly metadataSha256: string;
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

function canonicalFiles(files: readonly TargetRcClosureFile[]): TargetRcClosureFile[] {
  return [...files].sort((left, right) => compare(left.path, right.path));
}

function canonicalArtifacts(artifacts: readonly TargetRcBuildArtifact[]): TargetRcBuildArtifact[] {
  return [...artifacts].sort((left, right) => compare(left.path, right.path));
}

export function targetRcBuildMetadata(input: {
  readonly closure: TargetRcClosureReport;
  readonly configurations: readonly TargetRcClosureFile[];
  readonly inputs: readonly TargetRcClosureFile[];
  readonly packages: {
    readonly contracts: readonly TargetRcBuildArtifact[];
    readonly storage: readonly TargetRcBuildArtifact[];
    readonly runtime: readonly TargetRcBuildArtifact[];
  };
  readonly main: readonly TargetRcBuildArtifact[];
  readonly preload: readonly TargetRcBuildArtifact[];
  readonly renderer: readonly TargetRcBuildArtifact[];
  readonly toolchain: TargetRcToolchain;
}): TargetRcBuildMetadata {
  if (!input.closure.ok) {
    throw new Error(
      `Target RC emitted closure check failed:\n${input.closure.violations.join('\n')}`,
    );
  }
  const closure = {
    sha256: input.closure.closureSha256,
    files: canonicalFiles(input.closure.files),
    runtimeEntrypoints: [...input.closure.runtimeEntrypoints].sort(compare),
    emittedAuditRoots: [...input.closure.emittedAuditRoots].sort(compare),
  };
  const configurations = canonicalFiles(input.configurations);
  const inputs = canonicalFiles(input.inputs);
  const packages = {
    contracts: canonicalArtifacts(input.packages.contracts),
    storage: canonicalArtifacts(input.packages.storage),
    runtime: canonicalArtifacts(input.packages.runtime),
  };
  const main = canonicalArtifacts(input.main);
  const preload = canonicalArtifacts(input.preload);
  const renderer = canonicalArtifacts(input.renderer);
  const toolchain = input.toolchain;
  const inputSha256 = sha256(JSON.stringify({ closure, configurations, inputs, toolchain }));
  const unsigned = {
    schema: TARGET_RC_BUILD_SCHEMA,
    closure,
    configurations,
    inputs,
    inputSha256,
    toolchain,
    packages,
    main,
    preload,
    renderer,
  } as const;
  return Object.freeze({
    ...unsigned,
    metadataSha256: sha256(JSON.stringify(unsigned)),
  });
}

/**
 * Clean-emits the target RC only into a temporary directory, verifies the real emitted package
 * exports, and deletes that directory before returning its deterministic evidence. It never packs,
 * installs, launches Electron, or writes a release artifact.
 */
export async function buildTargetRc(
  repositoryRoot: string = repositoryRootFromModule(),
  options: TargetRcBuildOptions = {},
): Promise<TargetRcBuildMetadata> {
  const root = path.resolve(repositoryRoot);
  await assertTargetRcSourcePreflight(root);
  return withTargetRcIsolatedBuild(
    root,
    async (build) => {
      const closure = await auditTargetRcEmittedClosure({
        repositoryRoot: root,
        isolatedRoot: build.isolatedRoot,
        entrypoints: TARGET_RC_RUNTIME_ENTRYPOINTS,
        emittedArtifacts: targetRcEmittedArtifacts(build),
        inputs: build.inputs,
        toolchain: build.toolchain,
      });
      return targetRcBuildMetadata({
        closure,
        configurations: build.configurations,
        inputs: build.inputs,
        toolchain: build.toolchain,
        packages: build.packages,
        main: build.main,
        preload: build.preload,
        renderer: build.renderer,
      });
    },
    { beforeFinalSourceVerification: options.beforeFinalSourceVerification },
  );
}

function isExecutedDirectly(
  moduleUrl: string = import.meta.url,
  argv: readonly string[] = process.argv,
): boolean {
  const script = argv[1];
  return script !== undefined && path.resolve(script) === path.resolve(fileURLToPath(moduleUrl));
}

if (isExecutedDirectly()) {
  void buildTargetRc()
    .then((metadata) => {
      process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
    })
    .catch((cause: unknown) => {
      const message = cause instanceof Error ? (cause.stack ?? cause.message) : String(cause);
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    });
}
