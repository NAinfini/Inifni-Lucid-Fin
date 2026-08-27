import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  TARGET_RC_BUILD_SCHEMA,
  buildTargetRc,
  targetRcBuildMetadata,
  type TargetRcBuildArtifact,
} from './build-target-rc.js';
import { TARGET_RC_CLOSURE_SCHEMA, type TargetRcClosureReport } from './check-target-only-rc.js';
import { createTargetRcTestFixture } from './target-rc-test-fixture.js';

const execFileAsync = promisify(execFile);

const closure: TargetRcClosureReport = {
  schema: TARGET_RC_CLOSURE_SCHEMA,
  entrypoints: ['apps/desktop-main/src/target/electron-entry.ts'],
  runtimeEntrypoints: ['apps/desktop-main/dist-target-rc/target/electron-entry.js'],
  emittedAuditRoots: ['apps/desktop-main/dist-target-rc/target/electron-entry.js'],
  files: [{ path: 'apps/desktop-main/src/target/electron-entry.ts', sha256: 'a'.repeat(64) }],
  externalSpecifiers: ['electron'],
  inputs: [{ path: 'pnpm-lock.yaml', sha256: 'f'.repeat(64) }],
  toolchain: {
    node: 'v26.5.1',
    typescript: '6.0.2',
    vite: '8.2.0',
    plugins: [{ name: '@vitejs/plugin-react', version: '6.0.5' }],
  },
  closureSha256: 'b'.repeat(64),
  violations: [],
  ok: true,
};

const artifact: TargetRcBuildArtifact = {
  path: 'apps/desktop-main/dist-target-rc/target/electron-entry.js',
  bytes: 12,
  sha256: 'c'.repeat(64),
};

async function buildAfterPostEmitSourceDrift(
  root: string,
  source: string,
): Promise<{ readonly ok: boolean; readonly message?: string }> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      '--import',
      'tsx',
      '-e',
      `import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildTargetRc } from './scripts/build-target-rc.ts';
const root = process.argv[1];
const source = process.argv[2];
try {
  await buildTargetRc(root, {
    beforeFinalSourceVerification: () =>
      writeFile(
        path.join(root, 'apps/desktop-main/src/target/electron-entry.ts'),
        source,
      ),
  });
  process.stdout.write(JSON.stringify({ ok: true }));
} catch (cause) {
  process.stdout.write(JSON.stringify({
    ok: false,
    message: cause instanceof Error ? cause.message : String(cause),
  }));
}`,
      root,
      source,
    ],
    { cwd: process.cwd() },
  );
  return JSON.parse(stdout) as { readonly ok: boolean; readonly message?: string };
}

describe('target RC build metadata', () => {
  it('is deterministic and binds emitted closure, all inputs, and isolated output hashes', () => {
    const input = {
      closure,
      configurations: [
        { path: 'apps/desktop-main/tsconfig.target-rc.json', sha256: 'd'.repeat(64) },
      ],
      inputs: [
        { path: 'pnpm-lock.yaml', sha256: 'f'.repeat(64) },
        { path: 'tsconfig.base.json', sha256: 'e'.repeat(64) },
      ],
      packages: { contracts: [artifact], storage: [], runtime: [] },
      main: [artifact],
      preload: [],
      renderer: [{ ...artifact, path: 'assets/target-entry.js' }],
      toolchain: closure.toolchain,
    };
    const first = targetRcBuildMetadata(input);
    const second = targetRcBuildMetadata(input);

    expect(first).toEqual(second);
    expect(first.schema).toBe(TARGET_RC_BUILD_SCHEMA);
    expect(first.inputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(first.metadataSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refuses to mint build metadata when the static target closure is not clean', () => {
    expect(() =>
      targetRcBuildMetadata({
        closure: { ...closure, ok: false, violations: ['legacy source reached'] },
        configurations: [],
        inputs: [],
        packages: { contracts: [], storage: [], runtime: [] },
        main: [],
        preload: [],
        renderer: [],
        toolchain: closure.toolchain,
      }),
    ).toThrow('Target RC emitted closure check failed');
  });

  it('refuses to mint metadata when a type-only Legacy workspace import would erase at emit', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lucid-fin-target-rc-type-only-'));
    try {
      await Promise.all([
        mkdir(path.join(root, 'apps/desktop-main/src/target'), { recursive: true }),
        mkdir(path.join(root, 'apps/desktop-renderer/src'), { recursive: true }),
      ]);
      await Promise.all([
        writeFile(
          path.join(root, 'apps/desktop-main/src/target/electron-entry.ts'),
          "export type LegacyContract = import('@lucid-fin/contracts').LegacyContract;\n",
        ),
        writeFile(
          path.join(root, 'apps/desktop-main/src/target/preload.generated.cts'),
          'export {};\n',
        ),
        writeFile(path.join(root, 'apps/desktop-renderer/src/target-entry.tsx'), 'export {};\n'),
        writeFile(
          path.join(root, 'apps/desktop-main/tsconfig.target-rc.json'),
          JSON.stringify({
            compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' },
            include: ['src/target/**/*.ts'],
          }),
        ),
      ]);

      await expect(buildTargetRc(root)).rejects.toThrow(
        'legacy workspace package import @lucid-fin/contracts from apps/desktop-main/src/target/electron-entry.ts',
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it('refuses to mint metadata for an unreachable target tsconfig rootName with a type-only Legacy import', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      await mkdir(path.join(fixture.root, 'node_modules/@lucid-fin/contracts'), {
        recursive: true,
      });
      await Promise.all([
        writeFile(
          path.join(fixture.root, 'apps/desktop-main/src/target/unreachable.ts'),
          "import type { Legacy } from '@lucid-fin/contracts';\nexport type Unreachable = Legacy;\n",
        ),
        writeFile(
          path.join(fixture.root, 'node_modules/@lucid-fin/contracts/package.json'),
          JSON.stringify({
            name: '@lucid-fin/contracts',
            type: 'module',
            exports: { '.': { types: './index.d.ts', import: './index.js' } },
          }),
        ),
        writeFile(
          path.join(fixture.root, 'node_modules/@lucid-fin/contracts/index.d.ts'),
          'export interface Legacy {}\n',
        ),
        writeFile(
          path.join(fixture.root, 'node_modules/@lucid-fin/contracts/index.js'),
          'export {};\n',
        ),
      ]);

      await expect(buildTargetRc(fixture.root)).rejects.toThrow(
        'legacy workspace package import @lucid-fin/contracts from apps/desktop-main/src/target/unreachable.ts',
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([
    [
      'globalThis.Function',
      [
        'const g = globalThis;',
        "const load = new g.Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;",
        "void load('@lucid-fin/contracts');",
      ].join('\n'),
      'unsupported dynamic loader capability Function from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'globalThis.eval',
      'void globalThis.eval(\'import("@lucid-fin/contracts")\');\n',
      'unsupported dynamic loader capability eval from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a parameter default alias',
      [
        'function loadLegacy(g = globalThis) {',
        "  return new g.Function('specifier', 'return import(specifier)');",
        '}',
        "void loadLegacy()('@lucid-fin/contracts');",
      ].join('\n'),
      'unsupported dynamic loader capability Function from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a computed global property alias',
      [
        "const key = 'Function';",
        'const Factory = globalThis[key] as FunctionConstructor;',
        "void new Factory('specifier', 'return import(specifier)');",
      ].join('\n'),
      'unsupported dynamic loader computed global access from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a computed global object alias',
      [
        "const key = 'Function';",
        'const table = globalThis as Record<string, unknown>;',
        'const Factory = table[key] as FunctionConstructor;',
        "void new Factory('specifier', 'return import(specifier)');",
      ].join('\n'),
      'unsupported dynamic loader computed global access from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a property-derived global alias',
      [
        'const nodeGlobal = (globalThis as unknown as { global: Record<string, unknown> }).global;',
        "const key = 'Function';",
        'const Factory = nodeGlobal[key] as FunctionConstructor;',
        "void new Factory('specifier', 'return import(specifier)');",
      ].join('\n'),
      'unsupported dynamic loader computed global access from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a direct self-global computed alias',
      [
        "const key = 'Function';",
        'const Factory = (globalThis as unknown as { global: Record<string, FunctionConstructor> }).global[key];',
        "void new Factory('specifier', 'return import(specifier)');",
      ].join('\n'),
      'unsupported dynamic loader computed global access from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a direct global Object computed alias',
      [
        "const key = 'getOwnPropertyDescriptor';",
        'const descriptor = (globalThis as unknown as { Object: Record<string, unknown> }).Object[key];',
        'void descriptor;',
      ].join('\n'),
      'unsupported dynamic loader computed Object access from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a direct global Reflect computed alias',
      [
        "const key = 'get';",
        'const get = (globalThis as unknown as { Reflect: Record<string, unknown> }).Reflect[key];',
        'void get;',
      ].join('\n'),
      'unsupported dynamic loader computed Reflect access from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a direct global process computed alias',
      [
        "const key = 'getBuiltinModule';",
        'const getBuiltinModule = (globalThis as unknown as { process: Record<string, unknown> }).process[key];',
        'void getBuiltinModule;',
      ].join('\n'),
      'unsupported dynamic loader computed process access from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a computed global object binding',
      [
        "const key = 'Function';",
        'const { [key]: Factory } = globalThis as Record<string, FunctionConstructor>;',
        "void new Factory('specifier', 'return import(specifier)');",
      ].join('\n'),
      'unsupported dynamic loader computed global access from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'an object-assignment dynamic loader alias',
      [
        'let Factory: FunctionConstructor;',
        '({ Function: Factory } = globalThis as Record<string, FunctionConstructor>);',
        "void new Factory('specifier', 'return import(specifier)');",
      ].join('\n'),
      'unsupported dynamic loader capability Function from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a computed global object assignment',
      [
        "const key = 'Function';",
        'let Factory: FunctionConstructor;',
        '({ [key]: Factory } = globalThis as Record<string, FunctionConstructor>);',
        "void new Factory('specifier', 'return import(specifier)');",
      ].join('\n'),
      'unsupported dynamic loader computed global access from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'Reflect.get',
      [
        "const Factory = Reflect.get(globalThis, 'Function') as FunctionConstructor;",
        "void new Factory('specifier', 'return import(specifier)');",
      ].join('\n'),
      'unsupported dynamic loader capability Reflect.get from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a destructured Reflect.get alias',
      [
        'const { get: reflectGet } = Reflect;',
        "const Factory = reflectGet(globalThis, 'Function') as FunctionConstructor;",
        "void new Factory('specifier', 'return import(specifier)');",
      ].join('\n'),
      'unsupported dynamic loader capability Reflect.get from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a computed Reflect object binding',
      [
        "const key = 'get';",
        'const { [key]: reflectGet } = Reflect;',
        "const Factory = reflectGet(globalThis, 'Function') as FunctionConstructor;",
        "void new Factory('specifier', 'return import(specifier)');",
      ].join('\n'),
      'unsupported dynamic loader computed Reflect access from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'Object.getOwnPropertyDescriptor on globalThis',
      [
        "const Factory = Object.getOwnPropertyDescriptor(globalThis, 'Function')!.value as FunctionConstructor;",
        "void new Factory('specifier', 'return import(specifier)');",
      ].join('\n'),
      'unsupported dynamic loader capability Object.getOwnPropertyDescriptor from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a descriptor method alias',
      [
        'const descriptor = Object.getOwnPropertyDescriptor;',
        "const Factory = descriptor(globalThis, 'Function')!.value as FunctionConstructor;",
        "void new Factory('specifier', 'return import(specifier)');",
      ].join('\n'),
      'unsupported dynamic loader capability Object.getOwnPropertyDescriptor from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a global-derived descriptor method',
      [
        "const Factory = globalThis.Object.getOwnPropertyDescriptor(globalThis, 'Function')!.value as FunctionConstructor;",
        "void new Factory('specifier', 'return import(specifier)');",
      ].join('\n'),
      'unsupported dynamic loader capability Object.getOwnPropertyDescriptor from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a global-derived Reflect.get alias',
      [
        'const get = globalThis.Reflect.get;',
        "const Factory = get(globalThis, 'Function') as FunctionConstructor;",
        "void new Factory('specifier', 'return import(specifier)');",
      ].join('\n'),
      'unsupported dynamic loader capability Reflect.get from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a plural descriptor method alias',
      ['const descriptors = Object.getOwnPropertyDescriptors;', 'void descriptors({});'].join('\n'),
      'unsupported dynamic loader reflective member reference Object.getOwnPropertyDescriptors from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a reflective call with a protected non-first argument',
      'void Object.assign({}, globalThis);\n',
      'unsupported dynamic loader reflective Object.assign access on global object from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'document.createElement script injection',
      "const script = document.createElement('script');\nvoid script;\n",
      'unsupported dynamic code capability createElement from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a global alias document.write loader',
      [
        'const globalRef = globalThis;',
        'const doc = globalRef.document;',
        'doc.write(\'<script src="./legacy.js"></script>\');',
      ].join('\n'),
      'unsupported dynamic code capability document.write from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'an aliased string timer',
      [
        "const code = 'ev' + 'al(\"globalThis.timerBypass = 1\")';",
        'const later = globalThis.setTimeout;',
        'later(code, 0);',
      ].join('\n'),
      'unsupported dynamic code string timer setTimeout from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a Blob URL Worker loader',
      [
        "const blob = new Blob(['import(\"@lucid-fin/contracts\")'], { type: 'text/javascript' });",
        'const workerUrl = URL.createObjectURL(blob);',
        "new Worker(workerUrl, { type: 'module' });",
      ].join('\n'),
      'unsupported dynamic code capability Worker from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'process.getBuiltinModule and vm.runInThisContext',
      [
        "const vm = process.getBuiltinModule('node:vm');",
        'void vm.runInThisContext(\'import("@lucid-fin/contracts")\');',
      ].join('\n'),
      'unsupported dynamic loader capability process.getBuiltinModule from apps/desktop-main/src/target/electron-entry.ts',
    ],
    [
      'a computed process builtin loader alias',
      [
        "const key = 'getBuiltinModule';",
        'const table = process as Record<string, (name: string) => unknown>;',
        'const getBuiltinModule = table[key];',
        "const vm = getBuiltinModule('node:vm') as { runInThisContext(code: string): unknown };",
        'void vm.runInThisContext(\'import("@lucid-fin/contracts")\');',
      ].join('\n'),
      'unsupported dynamic loader computed process access from apps/desktop-main/src/target/electron-entry.ts',
    ],
  ])(
    'refuses to mint metadata when %s could hide a Legacy ESM loader',
    async (_, source, message) => {
      const fixture = await createTargetRcTestFixture();
      try {
        await writeFile(
          path.join(fixture.root, 'apps/desktop-main/src/target/electron-entry.ts'),
          source,
        );

        await expect(buildTargetRc(fixture.root)).rejects.toThrow(message);
      } finally {
        await fixture.cleanup();
      }
    },
  );

  it('refuses a renderer globalThis URL Worker before it can load Legacy source', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      await Promise.all([
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/src/target-entry.tsx'),
          "new Worker(new globalThis.URL('./legacy.js', import.meta.url), { type: 'module' });\n",
        ),
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/src/legacy.js'),
          'export const legacy = true;\n',
        ),
      ]);

      await expect(buildTargetRc(fixture.root)).rejects.toThrow(
        'unsupported dynamic code capability Worker from apps/desktop-renderer/src/target-entry.tsx',
      );
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it('refuses a renderer globalThis URL that reaches Legacy source', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      await Promise.all([
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/src/target-entry.tsx'),
          "export const legacyAsset = new globalThis.URL('./legacy.svg', import.meta.url);\n",
        ),
        writeFile(path.join(fixture.root, 'apps/desktop-renderer/src/legacy.svg'), '<svg />\n'),
      ]);

      await expect(buildTargetRc(fixture.root)).rejects.toThrow(
        'legacy or non-target source reached: apps/desktop-renderer/src/legacy.svg',
      );
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it('refuses a renderer document.write script loader', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      await writeFile(
        path.join(fixture.root, 'apps/desktop-renderer/src/target-entry.tsx'),
        'document.write(\'<script src="./legacy.js"></script>\');\n',
      );

      await expect(buildTargetRc(fixture.root)).rejects.toThrow(
        'unsupported dynamic code capability document.write from apps/desktop-renderer/src/target-entry.tsx',
      );
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it('rechecks source after emit before it can mint build metadata', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      const result = await buildAfterPostEmitSourceDrift(
        fixture.root,
        "export type LegacyContract = import('@lucid-fin/contracts').LegacyContract;\n",
      );

      expect(result.ok).toBe(false);
      expect(result.message).toContain(
        'legacy workspace package import @lucid-fin/contracts from apps/desktop-main/src/target/electron-entry.ts',
      );
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it('rejects a post-emit source snapshot drift before it can mint build metadata', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      const result = await buildAfterPostEmitSourceDrift(
        fixture.root,
        'export const changedAfterEmit = true;\n',
      );

      expect(result.ok).toBe(false);
      expect(result.message).toContain(
        'Target RC source closure or inputs changed during isolated build',
      );
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);
});
