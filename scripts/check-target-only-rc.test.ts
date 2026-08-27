import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditTargetRcEmittedClosure,
  checkTargetOnlyRc,
  TARGET_RC_ENTRYPOINTS,
  TARGET_RC_RUNTIME_ENTRYPOINTS,
  targetRcSourcePreflightViolations,
} from './check-target-only-rc.js';
import { createTargetRcTestFixture } from './target-rc-test-fixture.js';

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  while (temporaryRoots.length > 0) {
    await rm(temporaryRoots.pop()!, { force: true, recursive: true });
  }
});

async function fixture(
  source: string,
  entrypoint: string = 'apps/desktop-main/src/target/electron-entry.ts',
): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'lucid-fin-target-rc-'));
  const entry = path.join(root, entrypoint);
  await mkdir(path.dirname(entry), { recursive: true });
  await Promise.all([
    mkdir(path.join(root, 'apps/desktop-main'), { recursive: true }),
    mkdir(path.join(root, 'apps/desktop-renderer'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(entry, source),
    writeFile(
      path.join(root, 'apps/desktop-main/tsconfig.target-rc.json'),
      JSON.stringify({
        compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' },
        include: ['src/target/**/*.ts'],
      }),
    ),
    writeFile(
      path.join(root, 'apps/desktop-renderer/tsconfig.target-rc.json'),
      JSON.stringify({
        compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler' },
        include: ['src/target-entry.tsx', 'src/target/**/*.ts', 'src/target/**/*.tsx'],
      }),
    ),
  ]);
  temporaryRoots.push(root);
  return root;
}

async function emittedFixture(input: {
  readonly entry: string;
  readonly runtime: string;
  readonly staleRuntime?: string;
}): Promise<{ readonly root: string; readonly isolatedRoot: string }> {
  const root = await fixture("import '@lucid-fin/target-runtime';\n");
  const isolatedRoot = await mkdtemp(path.join(tmpdir(), 'lucid-fin-target-rc-emitted-'));
  temporaryRoots.push(isolatedRoot);
  await mkdir(path.join(root, 'packages/target-contracts'), { recursive: true });
  await mkdir(path.join(root, 'packages/target-storage'), { recursive: true });
  await mkdir(path.join(root, 'packages/target-runtime'), { recursive: true });
  await writeFile(
    path.join(root, 'packages/target-contracts/package.json'),
    JSON.stringify({ name: '@lucid-fin/target-contracts', type: 'module', main: 'dist/index.js' }),
  );
  await writeFile(
    path.join(root, 'packages/target-storage/package.json'),
    JSON.stringify({ name: '@lucid-fin/target-storage', type: 'module', main: 'dist/index.js' }),
  );
  await writeFile(
    path.join(root, 'packages/target-runtime/package.json'),
    JSON.stringify({ name: '@lucid-fin/target-runtime', type: 'module', main: 'dist/index.js' }),
  );
  if (input.staleRuntime !== undefined) {
    await mkdir(path.join(root, 'packages/target-runtime/dist'), { recursive: true });
    await writeFile(path.join(root, 'packages/target-runtime/dist/index.js'), input.staleRuntime);
  }
  await mkdir(path.join(isolatedRoot, 'apps/desktop-main/dist-target-rc/target'), {
    recursive: true,
  });
  await mkdir(path.join(isolatedRoot, 'packages/target-runtime/dist'), { recursive: true });
  await writeFile(
    path.join(isolatedRoot, 'apps/desktop-main/dist-target-rc/target/electron-entry.js'),
    input.entry,
  );
  await writeFile(path.join(isolatedRoot, 'packages/target-runtime/dist/index.js'), input.runtime);
  return { root, isolatedRoot };
}

async function checkedReport(
  repositoryRoot: string,
): Promise<Awaited<ReturnType<typeof checkTargetOnlyRc>>> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      '--import',
      'tsx',
      '-e',
      `import { checkTargetOnlyRc } from './scripts/check-target-only-rc.ts';
const report = await checkTargetOnlyRc({ repositoryRoot: process.argv[1] });
process.stdout.write(JSON.stringify(report));`,
      repositoryRoot,
    ],
    { cwd: process.cwd() },
  );
  return JSON.parse(stdout) as Awaited<ReturnType<typeof checkTargetOnlyRc>>;
}

async function checkedInReport(): Promise<Awaited<ReturnType<typeof checkTargetOnlyRc>>> {
  return checkedReport(process.cwd());
}

type UnsafeVitePluginHook = 'transform' | 'renderChunk' | 'generateBundle' | 'load' | 'virtual';

const unsafeVitePluginHookImplementation: Record<UnsafeVitePluginHook, string> = {
  transform: 'transform(code) { return `${code}\\nexport const injectedLegacy = true;`; }',
  renderChunk: "renderChunk(code) { return { code: code + '\\nconst injectedLegacy = true;' }; }",
  generateBundle:
    "generateBundle() { this.emitFile({ type: 'asset', fileName: 'legacy.js', source: 'export const injectedLegacy = true;' }); }",
  load: "load() { return 'export const injectedLegacy = true;'; }",
  virtual: [
    "resolveId(id) { return id === '@target/legacy-virtual' ? '\\0target-rc-legacy-virtual' : null; },",
    "load(id) { return id === '\\0target-rc-legacy-virtual' ? 'export const injectedLegacy = true;' : null; }",
  ].join('\n    '),
};

async function targetRcViteConfig(input: {
  readonly alias?: string;
  readonly hook?: UnsafeVitePluginHook;
}): Promise<string> {
  let source = await readFile(
    path.join(process.cwd(), 'apps/desktop-renderer/vite.target-rc.config.ts'),
    'utf8',
  );
  if (input.hook !== undefined) {
    const plugin = [
      'function targetRcUnsafePlugin(): Plugin {',
      '  return {',
      `    name: ${JSON.stringify(`target-rc-unsafe-${input.hook}`)},`,
      `    ${unsafeVitePluginHookImplementation[input.hook]}`,
      '  };',
      '}',
      '',
    ].join('\n');
    source = source.replace(
      'export default defineConfig({',
      `${plugin}export default defineConfig({`,
    );
    source = source.replace(
      'plugins: [react(), targetRcHtmlPlugin()],',
      'plugins: [react(), targetRcHtmlPlugin(), targetRcUnsafePlugin()],',
    );
  }
  if (input.alias !== undefined) {
    source = source.replace(
      '  build: {',
      `  resolve: { alias: { ${JSON.stringify(input.alias)}: fileURLToPath(new URL('./src/legacy.ts', import.meta.url)) } },\n  build: {`,
    );
  }
  return source;
}

async function checkedAfterPostEmitSourceDrift(
  root: string,
  source: string,
): Promise<Awaited<ReturnType<typeof checkTargetOnlyRc>>> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      '--import',
      'tsx',
      '-e',
      `import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkTargetOnlyRc } from './scripts/check-target-only-rc.ts';
const root = process.argv[1];
const source = process.argv[2];
const report = await checkTargetOnlyRc({
  repositoryRoot: root,
  beforeFinalSourceVerification: () =>
    writeFile(
      path.join(root, 'apps/desktop-main/src/target/electron-entry.ts'),
      source,
    ),
});
process.stdout.write(JSON.stringify(report));`,
      root,
      source,
    ],
    { cwd: process.cwd() },
  );
  return JSON.parse(stdout) as Awaited<ReturnType<typeof checkTargetOnlyRc>>;
}

describe('target-only RC closure check', () => {
  it('proves the checked-in RC entry closure does not reach Legacy sources', async () => {
    const report = await checkedInReport();
    expect(report.entrypoints).toEqual([...TARGET_RC_ENTRYPOINTS].sort());
    expect(report.ok, report.violations.join('\n')).toBe(true);
    expect(report.runtimeEntrypoints).toEqual([...TARGET_RC_RUNTIME_ENTRYPOINTS].sort());
    expect(report.emittedAuditRoots).toEqual(
      expect.arrayContaining([...TARGET_RC_RUNTIME_ENTRYPOINTS]),
    );
    expect(report.emittedAuditRoots).toContain('packages/target-contracts/dist/canonical.js');
    expect(report.files).toContainEqual(
      expect.objectContaining({
        path: 'apps/desktop-main/dist-target-rc/target/electron-entry.js',
      }),
    );
    expect(report.files).toContainEqual(
      expect.objectContaining({ path: 'apps/desktop-renderer/dist-target-rc/index.html' }),
    );
    expect(report.violations).toEqual([]);
  }, 120_000);

  it('rejects a target entry that reaches a Legacy application source', async () => {
    const root = await fixture("import '../electron.ts';\n");
    await writeFile(path.join(root, 'apps/desktop-main/src/electron.ts'), 'export {};\n');

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-main/src/target/electron-entry.ts'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'legacy or non-target source reached: apps/desktop-main/src/electron.ts',
    ]);
  });

  it('rejects a Legacy stylesheet reached through a target source CSS import', async () => {
    const root = await fixture("import './target.css';\n");
    await writeFile(
      path.join(root, 'apps/desktop-main/src/target/target.css'),
      '@import "../legacy.css";',
    );
    await writeFile(path.join(root, 'apps/desktop-main/src/legacy.css'), '');

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-main/src/target/electron-entry.ts'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'legacy or non-target source reached: apps/desktop-main/src/legacy.css',
    ]);
  });

  it('rejects a Legacy workspace package import even when no local file is resolved', async () => {
    const root = await fixture("import '@lucid-fin/contracts';\n");

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-main/src/target/electron-entry.ts'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'legacy workspace package import @lucid-fin/contracts from apps/desktop-main/src/target/electron-entry.ts',
    ]);
  });

  it('rejects a Legacy source reached through a triple-slash path reference', async () => {
    const root = await fixture('/// <reference path="../legacy.d.ts" />\nexport {};\n');
    await writeFile(path.join(root, 'apps/desktop-main/src/legacy.d.ts'), 'export {};\n');

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-main/src/target/electron-entry.ts'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'legacy or non-target source reached: apps/desktop-main/src/legacy.d.ts',
    ]);
  });

  it('rejects a Legacy workspace package reached through a triple-slash type reference', async () => {
    const root = await fixture('/// <reference types="@lucid-fin/contracts" />\nexport {};\n');

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-main/src/target/electron-entry.ts'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'legacy workspace package type reference @lucid-fin/contracts from apps/desktop-main/src/target/electron-entry.ts',
    ]);
  });

  it('rejects a Legacy workspace package named by a triple-slash lib reference', async () => {
    const root = await fixture('/// <reference lib="@lucid-fin/contracts" />\nexport {};\n');

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-main/src/target/electron-entry.ts'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'legacy workspace package lib reference @lucid-fin/contracts from apps/desktop-main/src/target/electron-entry.ts',
    ]);
  });

  it('rejects a Legacy workspace package named by target RC compilerOptions.types', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      await writeFile(
        path.join(fixture.root, 'packages/target-contracts/tsconfig.json'),
        JSON.stringify({
          extends: '../../tsconfig.base.json',
          compilerOptions: {
            composite: true,
            rootDir: 'src',
            outDir: 'dist',
            types: ['@lucid-fin/contracts'],
          },
          include: ['src'],
        }),
      );

      await expect(targetRcSourcePreflightViolations(fixture.root)).resolves.toEqual([
        'legacy workspace package type reference @lucid-fin/contracts from packages/target-contracts/tsconfig.json',
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects a type-only import whose tsconfig paths mapping reaches Legacy source', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      await Promise.all([
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/tsconfig.json'),
          JSON.stringify({
            extends: '../../tsconfig.base.json',
            compilerOptions: {
              composite: true,
              jsx: 'react-jsx',
              module: 'ESNext',
              moduleResolution: 'bundler',
              outDir: 'dist',
              rootDir: 'src',
              baseUrl: '.',
              paths: { '@target/legacy': ['src/legacy.ts'] },
            },
            include: ['src'],
          }),
        ),
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/src/target-entry.tsx'),
          "import type { Legacy } from '@target/legacy';\nexport type Target = Legacy;\n",
        ),
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/src/legacy.ts'),
          'export interface Legacy {}\n',
        ),
      ]);

      await expect(targetRcSourcePreflightViolations(fixture.root)).resolves.toEqual([
        'legacy or non-target source reached: apps/desktop-renderer/src/legacy.ts',
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects a runtime import whose tsconfig paths mapping reaches Legacy source', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      await Promise.all([
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/tsconfig.json'),
          JSON.stringify({
            extends: '../../tsconfig.base.json',
            compilerOptions: {
              composite: true,
              jsx: 'react-jsx',
              module: 'ESNext',
              moduleResolution: 'bundler',
              outDir: 'dist',
              rootDir: 'src',
              baseUrl: '.',
              paths: { '@target/legacy': ['src/legacy.ts'] },
            },
            include: ['src'],
          }),
        ),
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/src/target-entry.tsx'),
          "import { legacy } from '@target/legacy';\nexport const target = legacy;\n",
        ),
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/src/legacy.ts'),
          'export const legacy = true;\n',
        ),
      ]);

      await expect(targetRcSourcePreflightViolations(fixture.root)).resolves.toEqual([
        'legacy or non-target source reached: apps/desktop-renderer/src/legacy.ts',
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects a type-only Legacy import from an otherwise unreachable target tsconfig rootName', async () => {
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

      const report = await checkedReport(fixture.root);

      expect(report.ok).toBe(false);
      expect(report.violations).toEqual([
        'legacy workspace package import @lucid-fin/contracts from apps/desktop-main/src/target/unreachable.ts',
      ]);
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it('rejects a Legacy ambient declaration discovered through compilerOptions.typeRoots', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      await mkdir(path.join(fixture.root, 'legacy-types/legacy'), { recursive: true });
      await Promise.all([
        writeFile(
          path.join(fixture.root, 'packages/target-contracts/tsconfig.json'),
          JSON.stringify({
            extends: '../../tsconfig.base.json',
            compilerOptions: {
              composite: true,
              rootDir: 'src',
              outDir: 'dist',
              typeRoots: ['../../legacy-types'],
            },
            include: ['src'],
          }),
        ),
        writeFile(
          path.join(fixture.root, 'legacy-types/legacy/index.d.ts'),
          'declare const legacy: boolean;\n',
        ),
      ]);

      await expect(targetRcSourcePreflightViolations(fixture.root)).resolves.toEqual([
        'legacy or non-target source reached: legacy-types/legacy/index.d.ts',
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('audits imports reached through a target compilerOptions.typeRoots declaration', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      await mkdir(path.join(fixture.root, 'packages/target-contracts/src/types/ambient'), {
        recursive: true,
      });
      await Promise.all([
        writeFile(
          path.join(fixture.root, 'packages/target-contracts/tsconfig.json'),
          JSON.stringify({
            extends: '../../tsconfig.base.json',
            compilerOptions: {
              composite: true,
              rootDir: 'src',
              outDir: 'dist',
              typeRoots: ['./src/types'],
            },
            include: ['src'],
          }),
        ),
        writeFile(
          path.join(fixture.root, 'packages/target-contracts/src/types/ambient/index.d.ts'),
          "import type { LegacyContract } from '@lucid-fin/contracts';\nexport type Ambient = LegacyContract;\n",
        ),
      ]);

      await expect(targetRcSourcePreflightViolations(fixture.root)).resolves.toEqual([
        'legacy workspace package import @lucid-fin/contracts from packages/target-contracts/src/types/ambient/index.d.ts',
      ]);
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects renderer import.meta glob and resolve calls before Vite can hide their provenance', async () => {
    const root = await fixture(
      [
        "const legacyModules = import.meta.glob('../legacy/**/*.ts');",
        "const legacyResolution = import.meta.resolve('@lucid-fin/contracts');",
        'void legacyModules;',
        'void legacyResolution;',
      ].join('\n'),
      'apps/desktop-renderer/src/target-entry.tsx',
    );

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-renderer/src/target-entry.tsx'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'unsupported import.meta.glob call from apps/desktop-renderer/src/target-entry.tsx',
      'unsupported import.meta.resolve call from apps/desktop-renderer/src/target-entry.tsx',
    ]);
  });

  it('rejects a Legacy renderer asset referenced by Vite new URL', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      await Promise.all([
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/src/target-entry.tsx'),
          "export const legacyAsset = new URL('./legacy.svg', import.meta.url);\n",
        ),
        writeFile(path.join(fixture.root, 'apps/desktop-renderer/src/legacy.svg'), '<svg />\n'),
      ]);

      const report = await checkedReport(fixture.root);

      expect(report.ok).toBe(false);
      expect(report.violations).toEqual([
        'legacy or non-target source reached: apps/desktop-renderer/src/legacy.svg',
      ]);
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it('rejects a renderer Worker capability before it can load a Legacy asset', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      await Promise.all([
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/src/target-entry.tsx'),
          "new SharedWorker(new URL('./legacy-worker.ts', import.meta.url));\n",
        ),
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/src/legacy-worker.ts'),
          'export {};\n',
        ),
      ]);

      const report = await checkedReport(fixture.root);

      expect(report.ok).toBe(false);
      expect(report.violations).toContain(
        'unsupported dynamic code capability SharedWorker from apps/desktop-renderer/src/target-entry.tsx',
      );
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it('rejects a non-literal Vite new URL asset reference', async () => {
    const root = await fixture(
      [
        "const asset = './target.svg';",
        'export const targetAsset = new URL(asset, import.meta.url);',
      ].join('\n'),
      'apps/desktop-renderer/src/target-entry.tsx',
    );

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-renderer/src/target-entry.tsx'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'non-literal Vite asset URL from apps/desktop-renderer/src/target-entry.tsx',
    ]);
  });

  it('rejects Vite URL constructor aliases and non-direct import.meta.url bases', async () => {
    const root = await fixture(
      [
        'const Url = URL;',
        'const base = import.meta.url;',
        "export const targetAsset = new Url('./target.svg', base);",
      ].join('\n'),
      'apps/desktop-renderer/src/target-entry.tsx',
    );

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-renderer/src/target-entry.tsx'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'unsupported Vite asset URL constructor reference from apps/desktop-renderer/src/target-entry.tsx',
    ]);
  });

  it('rejects a Vite URL base alias without relying on constructor dataflow', async () => {
    const root = await fixture(
      [
        'const base = import.meta.url;',
        "export const targetAsset = new URL('./target.svg', base);",
      ].join('\n'),
      'apps/desktop-renderer/src/target-entry.tsx',
    );

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-renderer/src/target-entry.tsx'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'unsupported Vite asset URL base from apps/desktop-renderer/src/target-entry.tsx',
    ]);
  });

  it('rejects a globalThis URL asset that reaches Legacy renderer source', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      await Promise.all([
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/src/target-entry.tsx'),
          "export const legacyAsset = new globalThis.URL('./legacy.svg', import.meta.url);\n",
        ),
        writeFile(path.join(fixture.root, 'apps/desktop-renderer/src/legacy.svg'), '<svg />\n'),
      ]);

      const report = await checkedReport(fixture.root);

      expect(report.ok).toBe(false);
      expect(report.violations).toEqual([
        'legacy or non-target source reached: apps/desktop-renderer/src/legacy.svg',
      ]);
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it('rejects a data URL Worker before it can load Legacy code', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      await writeFile(
        path.join(fixture.root, 'apps/desktop-renderer/src/target-entry.tsx'),
        "new Worker(new URL('data:text/javascript,import(\"@lucid-fin/contracts\")', import.meta.url), { type: 'module' });\n",
      );

      const report = await checkedReport(fixture.root);

      expect(report.ok).toBe(false);
      expect(report.violations).toContain(
        'unsupported dynamic code capability Worker from apps/desktop-renderer/src/target-entry.tsx',
      );
      expect(report.violations).toContain(
        'non-local Vite asset URL from apps/desktop-renderer/src/target-entry.tsx',
      );
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it('rejects document.createElement script capabilities', async () => {
    const root = await fixture(
      "const script = document.createElement('script');\nvoid script;\n",
      'apps/desktop-renderer/src/target-entry.tsx',
    );

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-renderer/src/target-entry.tsx'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'unsupported dynamic code capability createElement from apps/desktop-renderer/src/target-entry.tsx',
    ]);
  });

  it('rejects document.write and globalThis.document aliases', async () => {
    const root = await fixture(
      [
        'document.write(\'<script src="./legacy.js"></script>\');',
        'const doc = globalThis.document;',
        'doc.writeln(\'<script src="./legacy.js"></script>\');',
      ].join('\n'),
      'apps/desktop-renderer/src/target-entry.tsx',
    );

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-renderer/src/target-entry.tsx'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'unsupported dynamic code capability document.write from apps/desktop-renderer/src/target-entry.tsx',
      'unsupported dynamic code capability document.writeln from apps/desktop-renderer/src/target-entry.tsx',
    ]);
  });

  it.each([
    ['direct timer', 'setTimeout(\'eval("globalThis.direct = 1")\', 0);', 'setTimeout'],
    [
      'global member timer',
      'globalThis[\'setInterval\'](`eval("globalThis.member = 1")`, 0);',
      'setInterval',
    ],
    [
      'simple timer and string aliases',
      [
        "const prefix = 'ev';",
        'const code = prefix + \'al("globalThis.alias = 1")\';',
        'const later = window.setTimeout;',
        'later(code, 0);',
      ].join('\n'),
      'setTimeout',
    ],
    [
      'destructured timer alias',
      [
        'const { setInterval: repeat } = globalThis;',
        'repeat(\'eval("globalThis.destructured = 1")\', 0);',
      ].join('\n'),
      'setInterval',
    ],
    [
      'string or function callback',
      [
        'const callback: string | (() => void) = \'eval("globalThis.union = 1")\';',
        'setTimeout(callback, 0);',
      ].join('\n'),
      'setTimeout',
    ],
  ])('rejects %s string execution', async (_label, source, capability) => {
    const root = await fixture(source, 'apps/desktop-renderer/src/target-entry.tsx');

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-renderer/src/target-entry.tsx'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      `unsupported dynamic code string timer ${capability} from apps/desktop-renderer/src/target-entry.tsx`,
    ]);
  });

  it('allows timer callbacks that are syntactically functions', async () => {
    const targetFixture = await createTargetRcTestFixture();
    try {
      await writeFile(
        path.join(targetFixture.root, 'apps/desktop-renderer/src/target-entry.tsx'),
        [
          'export const delay = (milliseconds: number) =>',
          '  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));',
          'export const schedule = () => setInterval(() => undefined, 10);',
        ].join('\n'),
      );

      const report = await checkedReport(targetFixture.root);

      expect(report.ok).toBe(true);
      expect(report.violations).toEqual([]);
    } finally {
      await targetFixture.cleanup();
    }
  });

  it('rejects a Vite alias that bundles a Legacy renderer source', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      await Promise.all([
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/src/target-entry.tsx'),
          "import { legacy } from '@target/legacy';\nexport const target = legacy;\n",
        ),
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/src/target/legacy-alias.d.ts'),
          "declare module '@target/legacy' { export const legacy: boolean; }\n",
        ),
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/src/legacy.ts'),
          'export const legacy = true;\n',
        ),
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/vite.target-rc.config.ts'),
          await targetRcViteConfig({ alias: '@target/legacy' }),
        ),
      ]);

      const report = await checkedReport(fixture.root);

      expect(report.ok).toBe(false);
      expect(report.violations).toEqual([
        'unresolved source import @target/legacy from apps/desktop-renderer/src/target-entry.tsx',
      ]);
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it('rejects a Vite virtual module that would inject Legacy renderer source', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      await Promise.all([
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/src/target-entry.tsx'),
          "import { legacy } from '@target/legacy-virtual';\nexport const target = legacy;\n",
        ),
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/src/target/legacy-virtual.d.ts'),
          "declare module '@target/legacy-virtual' { export const legacy: boolean; }\n",
        ),
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/src/legacy.ts'),
          'export const legacy = true;\n',
        ),
        writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/vite.target-rc.config.ts'),
          await targetRcViteConfig({ hook: 'virtual' }),
        ),
      ]);

      const report = await checkedReport(fixture.root);

      expect(report.ok).toBe(false);
      expect(report.violations).toEqual([
        'unresolved source import @target/legacy-virtual from apps/desktop-renderer/src/target-entry.tsx',
      ]);
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it.each(['transform', 'renderChunk', 'generateBundle', 'load'] as const)(
    'rejects an unauthorized Vite %s hook before it can inject output',
    async (hook) => {
      const fixture = await createTargetRcTestFixture();
      try {
        await writeFile(
          path.join(fixture.root, 'apps/desktop-renderer/vite.target-rc.config.ts'),
          await targetRcViteConfig({ hook }),
        );

        const report = await checkedReport(fixture.root);

        expect(report.ok).toBe(false);
        expect(report.violations).toEqual([`unauthorized Target RC Vite plugin hook: ${hook}`]);
      } finally {
        await fixture.cleanup();
      }
    },
    30_000,
  );

  it('rejects variable dynamic import and require before either can load Legacy code', async () => {
    const root = await fixture(
      [
        "const legacyImport = '@lucid-fin/contracts';",
        'void import(legacyImport);',
        "const legacyRequire = '@lucid-fin/contracts';",
        'require(legacyRequire);',
      ].join('\n'),
    );

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-main/src/target/electron-entry.ts'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'non-literal dynamic import from apps/desktop-main/src/target/electron-entry.ts',
      'non-literal dynamic require from apps/desktop-main/src/target/electron-entry.ts',
    ]);
  });

  it('rejects dynamic CommonJS, VM, and eval loader capabilities', async () => {
    const root = await fixture(
      [
        "import { createRequire } from 'node:module';",
        "import vm from 'node:vm';",
        'const load = createRequire(import.meta.url);',
        "void load('@lucid-fin/contracts');",
        "void module.require('@lucid-fin/contracts');",
        "void require.resolve('@lucid-fin/contracts');",
        'void eval(\'import("@lucid-fin/contracts")\');',
        "void Function('specifier', 'return import(specifier)');",
        'void vm;',
      ].join('\n'),
    );

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-main/src/target/electron-entry.ts'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'unsupported dynamic loader capability Function from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader capability createRequire from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader capability eval from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader capability require from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader capability require.resolve from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader module node:module from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader module node:vm from apps/desktop-main/src/target/electron-entry.ts',
    ]);
  });

  it('rejects global, property, element, and destructured dynamic loader capabilities', async () => {
    const root = await fixture(
      [
        'const Factory = Function;',
        "const globalFactory = new globalThis['Fun' + 'ction']('specifier', 'return import(specifier)');",
        'const g = (globalThis as typeof globalThis);',
        "const aliasFactory = new g.Function('specifier', 'return import(specifier)');",
        'const run = g.eval;',
        'void run(\'import("@lucid-fin/contracts")\');',
        'function loadLegacy(parameterGlobal = globalThis) {',
        "  return new parameterGlobal.Function('specifier', 'return import(specifier)');",
        '}',
        'const parameterFactory = loadLegacy();',
        "const key = 'Function';",
        'const table = globalThis as Record<string, unknown>;',
        'const directDynamicFactory = globalThis[key];',
        'const aliasedDynamicFactory = table[key];',
        'const directSelfGlobalFactory = (globalThis as unknown as { global: Record<string, unknown> }).global[key];',
        'const nodeGlobal = (globalThis as unknown as { global: Record<string, unknown> }).global;',
        'const propertyDerivedFactory = nodeGlobal[key];',
        'const { global: boundGlobal } = globalThis as unknown as { global: Record<string, unknown> };',
        'const bindingDerivedFactory = boundGlobal[key];',
        'let assignmentDerivedGlobal: Record<string, unknown>;',
        '({ global: assignmentDerivedGlobal } = globalThis as unknown as { global: Record<string, unknown> });',
        'const assignmentDerivedFactory = assignmentDerivedGlobal[key];',
        'const { [key]: destructuredDynamicFactory } = globalThis as Record<string, unknown>;',
        "const moduleKey = 'require';",
        'const moduleTable = module;',
        'const dynamicModuleLoader = moduleTable[moduleKey];',
        "const reflectedFactory = Reflect.get(globalThis, 'Function');",
        "const reflectKey = 'get';",
        'const dynamicallyReflectedFactory = Reflect[reflectKey](globalThis, key);',
        'const directGlobalReflectFactory = (globalThis as unknown as { Reflect: Record<string, unknown> }).Reflect[reflectKey];',
        'const { get: reflectGet } = Reflect;',
        'const { [reflectKey]: dynamicallyDestructuredReflectGet } = Reflect;',
        "const destructuredReflectedFactory = reflectGet(globalThis, 'Function');",
        "const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Function')?.value;",
        'const descriptorAlias = Object.getOwnPropertyDescriptor;',
        'const { getOwnPropertyDescriptor: destructuredDescriptor } = Object;',
        "const globalDescriptor = globalThis.Object.getOwnPropertyDescriptor(globalThis, 'Function')?.value;",
        'const ObjectAlias = Object;',
        'void ObjectAlias.getOwnPropertyDescriptors(globalThis);',
        'const ObjectFromGlobal = globalThis.Object;',
        'void ObjectFromGlobal.getOwnPropertyDescriptors(globalThis);',
        'const directGlobalObjectFactory = (globalThis as unknown as { Object: Record<string, unknown> }).Object[reflectKey];',
        'const descriptorCollectionAlias = Object.getOwnPropertyDescriptors;',
        'void descriptorCollectionAlias({});',
        'void Object.assign({}, globalThis);',
        'void Reflect.ownKeys(globalThis);',
        'const reflectGetAlias = Reflect.get;',
        'const globalReflectGetAlias = globalThis.Reflect.get;',
        'let assignedFactory: FunctionConstructor;',
        '({ Function: assignedFactory } = globalThis as Record<string, FunctionConstructor>);',
        'let computedAssignedFactory: FunctionConstructor;',
        '({ [key]: computedAssignedFactory } = globalThis as Record<string, FunctionConstructor>);',
        "const vm = process.getBuiltinModule('node:vm');",
        "const builtinKey = 'getBuiltinModule';",
        'const processTable = process as Record<string, (name: string) => unknown>;',
        'const dynamicBuiltinModule = processTable[builtinKey];',
        'const directGlobalBuiltinModule = (globalThis as unknown as { process: Record<string, unknown> }).process[builtinKey];',
        'const { process: boundProcess } = globalThis as unknown as { process: Record<string, unknown> };',
        'const bindingBuiltinModule = boundProcess[builtinKey];',
        'void vm.runInThisContext(\'import("@lucid-fin/contracts")\');',
        'void vm.runInNewContext(\'import("@lucid-fin/contracts")\');',
        'void vm.runInContext(\'import("@lucid-fin/contracts")\');',
        'void vm.compileFunction(\'return import("@lucid-fin/contracts")\', []);',
        'void new vm.Script(\'import("@lucid-fin/contracts")\');',
        "const execute = globalThis['ev' + 'al'];",
        'void execute(\'import("@lucid-fin/contracts")\');',
        'const { require: load } = module;',
        "void load('@lucid-fin/contracts');",
        'const nodeModule = module;',
        "const moduleLoad = nodeModule['require'];",
        "void moduleLoad('@lucid-fin/contracts');",
        'const globalRef = globalThis;',
        'const doc = globalRef.document;',
        'doc.write(\'<script src="./legacy.js"></script>\');',
        "const resolve = require['re' + 'solve'];",
        "void resolve('@lucid-fin/contracts');",
        'const makeRequire = createRequire;',
        'void Factory;',
        'void globalFactory;',
        'void aliasFactory;',
        'void parameterFactory;',
        'void directDynamicFactory;',
        'void aliasedDynamicFactory;',
        'void directSelfGlobalFactory;',
        'void propertyDerivedFactory;',
        'void bindingDerivedFactory;',
        'void assignmentDerivedFactory;',
        'void destructuredDynamicFactory;',
        'void dynamicModuleLoader;',
        'void reflectedFactory;',
        'void dynamicallyReflectedFactory;',
        'void directGlobalReflectFactory;',
        'void destructuredReflectedFactory;',
        'void dynamicallyDestructuredReflectGet;',
        'void descriptor;',
        'void descriptorAlias;',
        'void destructuredDescriptor;',
        'void globalDescriptor;',
        'void directGlobalObjectFactory;',
        'void descriptorCollectionAlias;',
        'void reflectGetAlias;',
        'void globalReflectGetAlias;',
        'void assignedFactory;',
        'void computedAssignedFactory;',
        'void dynamicBuiltinModule;',
        'void directGlobalBuiltinModule;',
        'void bindingBuiltinModule;',
        'void vm;',
        'void makeRequire;',
      ].join('\n'),
    );

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-main/src/target/electron-entry.ts'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'unsupported dynamic code capability document.write from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader capability Function from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader capability Object.getOwnPropertyDescriptor from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader capability Reflect.get from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader capability createRequire from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader capability eval from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader capability process.getBuiltinModule from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader capability require from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader capability require.resolve from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader capability vm.Script from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader capability vm.compileFunction from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader capability vm.runInContext from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader capability vm.runInNewContext from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader capability vm.runInThisContext from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader computed Object access from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader computed Reflect access from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader computed global access from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader computed module access from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader computed process access from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader reflective Object.assign access on global object from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader reflective Object.getOwnPropertyDescriptors access on global object from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader reflective Reflect.ownKeys access on global object from apps/desktop-main/src/target/electron-entry.ts',
      'unsupported dynamic loader reflective member reference Object.getOwnPropertyDescriptors from apps/desktop-main/src/target/electron-entry.ts',
    ]);
  });

  it('rejects a new Function that could hide a Legacy ESM dynamic import', async () => {
    const root = await fixture(
      [
        "const load = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<unknown>;",
        "void load('@lucid-fin/contracts');",
      ].join('\n'),
    );

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-main/src/target/electron-entry.ts'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'unsupported dynamic loader capability Function from apps/desktop-main/src/target/electron-entry.ts',
    ]);
  });

  it('rejects a static local-file URL instead of treating it as an external package', async () => {
    const root = await fixture("import 'file:///Legacy/electron.ts';\n");

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-main/src/target/electron-entry.ts'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'local file source import file:///Legacy/electron.ts from apps/desktop-main/src/target/electron-entry.ts',
    ]);
  });

  it('rejects a Legacy package reached only through the clean emitted package export', async () => {
    const { root, isolatedRoot } = await emittedFixture({
      entry: "import '@lucid-fin/target-runtime';\n",
      runtime: "import '@lucid-fin/contracts';\n",
    });

    const report = await auditTargetRcEmittedClosure({
      repositoryRoot: root,
      isolatedRoot,
      entrypoints: ['apps/desktop-main/dist-target-rc/target/electron-entry.js'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'legacy workspace package import @lucid-fin/contracts from packages/target-runtime/dist/index.js',
    ]);
  });

  it('audits every emitted runtime artifact, including an otherwise unreachable JavaScript output', async () => {
    const { root, isolatedRoot } = await emittedFixture({
      entry: 'export {};\n',
      runtime: 'export {};\n',
    });
    const unreachable = 'apps/desktop-main/dist-target-rc/target/unreachable.js';
    await writeFile(path.join(isolatedRoot, unreachable), "import '@lucid-fin/contracts';\n");

    const report = await auditTargetRcEmittedClosure({
      repositoryRoot: root,
      isolatedRoot,
      entrypoints: ['apps/desktop-main/dist-target-rc/target/electron-entry.js'],
      emittedArtifacts: [
        {
          path: 'apps/desktop-main/dist-target-rc/target/electron-entry.js',
          bytes: 0,
          sha256: '0'.repeat(64),
        },
        { path: unreachable, bytes: 0, sha256: '0'.repeat(64) },
      ],
    });

    expect(report.emittedAuditRoots).toContain(unreachable);
    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'legacy workspace package import @lucid-fin/contracts from apps/desktop-main/dist-target-rc/target/unreachable.js',
    ]);
  });

  it('rejects variable dynamic import and require in emitted JavaScript', async () => {
    const { root, isolatedRoot } = await emittedFixture({
      entry: [
        "const legacyImport = '@lucid-fin/contracts';",
        'void import(legacyImport);',
        "const legacyRequire = '@lucid-fin/contracts';",
        'require(legacyRequire);',
      ].join('\n'),
      runtime: 'export {};\n',
    });

    const report = await auditTargetRcEmittedClosure({
      repositoryRoot: root,
      isolatedRoot,
      entrypoints: ['apps/desktop-main/dist-target-rc/target/electron-entry.js'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'non-literal dynamic import from apps/desktop-main/dist-target-rc/target/electron-entry.js',
      'non-literal dynamic require from apps/desktop-main/dist-target-rc/target/electron-entry.js',
    ]);
  });

  it('rejects global dynamic-code loaders in emitted JavaScript', async () => {
    const { root, isolatedRoot } = await emittedFixture({
      entry: [
        "const load = new globalThis.Function('specifier', 'return import(specifier)');",
        "void load('@lucid-fin/contracts');",
        'void globalThis.eval(\'import("@lucid-fin/contracts")\');',
      ].join('\n'),
      runtime: 'export {};\n',
    });

    const report = await auditTargetRcEmittedClosure({
      repositoryRoot: root,
      isolatedRoot,
      entrypoints: ['apps/desktop-main/dist-target-rc/target/electron-entry.js'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'unsupported dynamic loader capability Function from apps/desktop-main/dist-target-rc/target/electron-entry.js',
      'unsupported dynamic loader capability eval from apps/desktop-main/dist-target-rc/target/electron-entry.js',
    ]);
  });

  it('rejects a static local-file URL in emitted JavaScript', async () => {
    const { root, isolatedRoot } = await emittedFixture({
      entry: "import 'file:///Legacy/electron.js';\n",
      runtime: 'export {};\n',
    });

    const report = await auditTargetRcEmittedClosure({
      repositoryRoot: root,
      isolatedRoot,
      entrypoints: ['apps/desktop-main/dist-target-rc/target/electron-entry.js'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'local file emitted import file:///Legacy/electron.js from apps/desktop-main/dist-target-rc/target/electron-entry.js',
    ]);
  });

  it('uses the clean isolated emit instead of a stale workspace dist export', async () => {
    const { root, isolatedRoot } = await emittedFixture({
      entry: "import '@lucid-fin/target-runtime';\n",
      runtime: 'export {};\n',
      staleRuntime: "import '@lucid-fin/contracts';\n",
    });

    const report = await auditTargetRcEmittedClosure({
      repositoryRoot: root,
      isolatedRoot,
      entrypoints: ['apps/desktop-main/dist-target-rc/target/electron-entry.js'],
    });

    expect(report.ok).toBe(true);
    expect(report.files.map(({ path: filePath }) => filePath)).toEqual([
      'apps/desktop-main/dist-target-rc/target/electron-entry.js',
      'packages/target-runtime/dist/index.js',
    ]);
  });

  it('rejects Legacy local script and stylesheet assets reached from emitted renderer HTML', async () => {
    const { root, isolatedRoot } = await emittedFixture({
      entry: 'export {};\n',
      runtime: 'export {};\n',
    });
    const rendererOutput = path.join(isolatedRoot, 'apps/desktop-renderer/dist-target-rc');
    await mkdir(path.join(rendererOutput, 'assets'), { recursive: true });
    await writeFile(
      path.join(rendererOutput, 'index.html'),
      [
        '<script type="module" src="../legacy-script.js"></script>',
        '<link rel="modulepreload" href="../legacy-module.js" />',
        '<link rel="stylesheet" href="./assets/target.css" />',
      ].join(''),
    );
    await writeFile(
      path.join(rendererOutput, 'assets/target.css'),
      '@import "../../legacy-import.css"; .badge { background: url("../../legacy-image.svg"); }',
    );
    await mkdir(path.join(isolatedRoot, 'apps/desktop-renderer'), { recursive: true });
    await Promise.all([
      writeFile(path.join(isolatedRoot, 'apps/desktop-renderer/legacy-script.js'), 'export {};\n'),
      writeFile(path.join(isolatedRoot, 'apps/desktop-renderer/legacy-module.js'), 'export {};\n'),
      writeFile(path.join(isolatedRoot, 'apps/desktop-renderer/legacy-import.css'), ''),
      writeFile(path.join(isolatedRoot, 'apps/desktop-renderer/legacy-image.svg'), '<svg />'),
    ]);

    const report = await auditTargetRcEmittedClosure({
      repositoryRoot: root,
      isolatedRoot,
      entrypoints: ['apps/desktop-renderer/dist-target-rc/index.html'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'legacy or non-target emitted artifact reached: apps/desktop-renderer/legacy-image.svg',
      'legacy or non-target emitted artifact reached: apps/desktop-renderer/legacy-import.css',
      'legacy or non-target emitted artifact reached: apps/desktop-renderer/legacy-module.js',
      'legacy or non-target emitted artifact reached: apps/desktop-renderer/legacy-script.js',
    ]);
  });

  it('rejects an inline emitted renderer script outside the approved asset graph', async () => {
    const { root, isolatedRoot } = await emittedFixture({
      entry: 'export {};\n',
      runtime: 'export {};\n',
    });
    const rendererOutput = path.join(isolatedRoot, 'apps/desktop-renderer/dist-target-rc');
    await mkdir(rendererOutput, { recursive: true });
    await writeFile(
      path.join(rendererOutput, 'index.html'),
      '<script>globalThis.legacyInjected = true;</script>',
    );

    const report = await auditTargetRcEmittedClosure({
      repositoryRoot: root,
      isolatedRoot,
      entrypoints: ['apps/desktop-renderer/dist-target-rc/index.html'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'inline emitted script from apps/desktop-renderer/dist-target-rc/index.html',
    ]);
  });

  it('rejects a target source path that is a junction to Legacy source', async () => {
    const root = await fixture('export {};\n');
    const targetDirectory = path.join(root, 'apps/desktop-main/src/target');
    const legacyDirectory = path.join(root, 'apps/desktop-main/src/legacy');
    await rm(targetDirectory, { force: true, recursive: true });
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(path.join(legacyDirectory, 'electron-entry.ts'), 'export {};\n');
    await symlink(legacyDirectory, targetDirectory, 'junction');

    const report = await checkTargetOnlyRc({
      repositoryRoot: root,
      entrypoints: ['apps/desktop-main/src/target/electron-entry.ts'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'unsafe path (symbolic link or junction): apps/desktop-main/src/target',
    ]);
  });

  it('rejects an emitted target artifact path that is a junction to Legacy output', async () => {
    const { root, isolatedRoot } = await emittedFixture({
      entry: 'export {};\n',
      runtime: 'export {};\n',
    });
    const targetDirectory = path.join(isolatedRoot, 'apps/desktop-main/dist-target-rc/target');
    const legacyDirectory = path.join(isolatedRoot, 'apps/desktop-main/legacy');
    await rm(targetDirectory, { force: true, recursive: true });
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(path.join(legacyDirectory, 'electron-entry.js'), 'export {};\n');
    await symlink(legacyDirectory, targetDirectory, 'junction');

    const report = await auditTargetRcEmittedClosure({
      repositoryRoot: root,
      isolatedRoot,
      entrypoints: ['apps/desktop-main/dist-target-rc/target/electron-entry.js'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'unsafe path (symbolic link or junction): apps/desktop-main/dist-target-rc/target',
    ]);
  });

  it('rejects a target package manifest junction before resolving its emitted export', async () => {
    const { root, isolatedRoot } = await emittedFixture({
      entry: "import '@lucid-fin/target-runtime';\n",
      runtime: 'export {};\n',
    });
    const targetPackage = path.join(root, 'packages/target-runtime');
    const legacyPackage = path.join(root, 'packages/legacy-runtime');
    await rm(targetPackage, { force: true, recursive: true });
    await mkdir(legacyPackage, { recursive: true });
    await writeFile(
      path.join(legacyPackage, 'package.json'),
      JSON.stringify({ name: '@lucid-fin/target-runtime', type: 'module', main: 'dist/index.js' }),
    );
    await symlink(legacyPackage, targetPackage, 'junction');

    const report = await auditTargetRcEmittedClosure({
      repositoryRoot: root,
      isolatedRoot,
      entrypoints: ['apps/desktop-main/dist-target-rc/target/electron-entry.js'],
    });

    expect(report.ok).toBe(false);
    expect(report.violations).toEqual([
      'unsafe path (symbolic link or junction): packages/target-runtime',
    ]);
  });

  it('rechecks source after emit before returning a clean report', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      const report = await checkedAfterPostEmitSourceDrift(
        fixture.root,
        "export type LegacyContract = import('@lucid-fin/contracts').LegacyContract;\n",
      );

      expect(report.ok).toBe(false);
      expect(report.violations).toEqual([
        expect.stringContaining(
          'legacy workspace package import @lucid-fin/contracts from apps/desktop-main/src/target/electron-entry.ts',
        ),
      ]);
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);

  it('rejects a post-emit source snapshot drift even when the changed source remains target-only', async () => {
    const fixture = await createTargetRcTestFixture();
    try {
      const report = await checkedAfterPostEmitSourceDrift(
        fixture.root,
        'export const changedAfterEmit = true;\n',
      );

      expect(report.ok).toBe(false);
      expect(report.violations).toEqual([
        'Target RC source closure or inputs changed during isolated build',
      ]);
    } finally {
      await fixture.cleanup();
    }
  }, 30_000);
});
