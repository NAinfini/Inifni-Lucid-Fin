import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface TargetRcTestFixture {
  readonly root: string;
  cleanup(): Promise<void>;
}

const baseTsconfig = JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'NodeNext',
    moduleResolution: 'nodenext',
    strict: true,
    skipLibCheck: true,
    declaration: true,
    sourceMap: false,
  },
});

export async function createTargetRcTestFixture(): Promise<TargetRcTestFixture> {
  const root = await mkdtemp(path.join(tmpdir(), 'lucid-fin-target-rc-race-'));
  const workspaceRoot = process.cwd();
  const viteConfig = await readFile(
    path.join(workspaceRoot, 'apps/desktop-renderer/vite.target-rc.config.ts'),
    'utf8',
  );
  const viteModule = pathToFileURL(
    path.join(workspaceRoot, 'node_modules/vite/dist/node/index.js'),
  ).href;
  const reactModule = pathToFileURL(
    path.join(workspaceRoot, 'node_modules/@vitejs/plugin-react/dist/index.js'),
  ).href;
  const write = async (relativePath: string, source: string): Promise<void> => {
    const file = path.join(root, relativePath);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source);
  };
  const writeJson = (relativePath: string, value: Record<string, unknown>): Promise<void> =>
    write(relativePath, `${JSON.stringify(value, null, 2)}\n`);

  await Promise.all([
    writeJson('package.json', { name: 'target-rc-race-fixture' }),
    write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n'),
    write('pnpm-lock.yaml', 'lockfileVersion: 9\n'),
    write('tsconfig.base.json', baseTsconfig),
    writeJson('node_modules/@vitejs/plugin-react/package.json', {
      name: '@vitejs/plugin-react',
      version: '0.0.0',
      type: 'module',
      exports: './index.js',
    }),
    write(
      'node_modules/@vitejs/plugin-react/index.js',
      `export { default } from ${JSON.stringify(reactModule)};\n`,
    ),
    writeJson('node_modules/vite/package.json', {
      name: 'vite',
      version: '0.0.0',
      type: 'module',
      exports: './index.js',
    }),
    write('node_modules/vite/index.js', `export * from ${JSON.stringify(viteModule)};\n`),
    writeJson('node_modules/rolldown/package.json', {
      name: 'rolldown',
      version: '0.0.0',
      main: 'index.js',
    }),
    write('node_modules/rolldown/index.js', 'module.exports = {};\n'),
    writeJson('packages/target-contracts/package.json', {
      name: '@lucid-fin/target-contracts',
      main: 'dist/index.js',
      types: 'dist/index.d.ts',
    }),
    writeJson('packages/target-storage/package.json', {
      name: '@lucid-fin/target-storage',
      main: 'dist/kernel/index.js',
      types: 'dist/kernel/index.d.ts',
      exports: {
        '.': { types: './dist/kernel/index.d.ts', import: './dist/kernel/index.js' },
      },
    }),
    writeJson('packages/target-runtime/package.json', {
      name: '@lucid-fin/target-runtime',
      main: 'dist/index.js',
      types: 'dist/index.d.ts',
      exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    }),
    writeJson('apps/desktop-main/package.json', { name: '@lucid-fin/desktop-main' }),
    writeJson('apps/desktop-renderer/package.json', { name: '@lucid-fin/desktop-renderer' }),
    write(
      'packages/target-contracts/tsconfig.json',
      JSON.stringify({
        extends: '../../tsconfig.base.json',
        compilerOptions: { composite: true, rootDir: 'src', outDir: 'dist' },
        include: ['src'],
      }),
    ),
    write(
      'packages/target-storage/tsconfig.json',
      JSON.stringify({
        extends: '../../tsconfig.base.json',
        compilerOptions: { composite: true, rootDir: 'src', outDir: 'dist' },
        include: ['src'],
      }),
    ),
    write(
      'packages/target-runtime/tsconfig.json',
      JSON.stringify({
        extends: '../../tsconfig.base.json',
        compilerOptions: { composite: true, rootDir: 'src', outDir: 'dist' },
        include: ['src'],
      }),
    ),
    write(
      'apps/desktop-main/tsconfig.target-rc.json',
      JSON.stringify({
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          composite: false,
          declaration: false,
          declarationMap: false,
          incremental: false,
          rootDir: 'src',
          outDir: 'dist-target-rc',
        },
        include: ['src/target/**/*.ts'],
      }),
    ),
    write(
      'apps/desktop-main/tsconfig.target-rc-preload.json',
      JSON.stringify({
        extends: '../../tsconfig.base.json',
        compilerOptions: {
          composite: false,
          declaration: false,
          declarationMap: false,
          incremental: false,
          rootDir: 'src',
          outDir: 'dist-target-rc',
        },
        include: ['src/target/preload.generated.cts'],
      }),
    ),
    write(
      'apps/desktop-renderer/tsconfig.json',
      JSON.stringify({
        extends: '../../tsconfig.base.json',
        compilerOptions: { jsx: 'react-jsx', module: 'ESNext', moduleResolution: 'bundler' },
        include: ['src'],
      }),
    ),
    write(
      'apps/desktop-renderer/tsconfig.target-rc.json',
      JSON.stringify({
        extends: './tsconfig.json',
        compilerOptions: {
          composite: false,
          declaration: false,
          declarationMap: false,
          incremental: false,
          noEmit: true,
        },
        include: ['src/target-entry.tsx', 'src/target/**/*.ts', 'src/target/**/*.tsx'],
      }),
    ),
    write('apps/desktop-renderer/vite.target-rc.config.ts', viteConfig),
    write('packages/target-contracts/src/index.ts', 'export interface TargetContract {}\n'),
    write('packages/target-storage/src/kernel/index.ts', 'export {};\n'),
    write('packages/target-runtime/src/index.ts', 'export {};\n'),
    write('apps/desktop-main/src/target/electron-entry.ts', 'export {};\n'),
    write('apps/desktop-main/src/target/preload.generated.cts', 'export {};\n'),
    write('apps/desktop-renderer/src/target-entry.tsx', 'export const target = true;\n'),
    write('apps/desktop-renderer/src/target/.gitkeep', ''),
  ]);

  return {
    root,
    cleanup: () => rm(root, { force: true, recursive: true }),
  };
}
