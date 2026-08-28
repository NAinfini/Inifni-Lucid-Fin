import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { checkProductionClosure } from './check-production-closure.js';

const fixtures: string[] = [];

async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lucid-fin-production-closure-'));
  fixtures.push(root);
  await write(
    join(root, 'apps/desktop-main/package.json'),
    JSON.stringify({
      main: 'dist/electron.js',
      scripts: { build: 'tsc -p tsconfig.preload.json' },
    }),
  );
  await write(
    join(root, 'apps/desktop-main/electron-builder.json'),
    JSON.stringify({
      files: ['dist/**/*'],
      extraResources: [{ from: '../desktop-renderer/dist', to: 'renderer' }],
    }),
  );
  await write(join(root, 'apps/desktop-main/tsconfig.json'), JSON.stringify({ include: ['src'] }));
  await write(
    join(root, 'apps/desktop-main/tsconfig.preload.json'),
    JSON.stringify({ include: ['src/preload.cts'] }),
  );
  await write(join(root, 'apps/desktop-main/src/electron.ts'), "import './electron-host.js';\n");
  await write(join(root, 'apps/desktop-main/src/electron-host.ts'), 'export {};\n');
  await write(join(root, 'apps/desktop-main/src/preload.cts'), 'export {};\n');
  await write(
    join(root, 'apps/desktop-renderer/index.html'),
    '<script type="module" src="/src/main.tsx"></script>',
  );
  await write(join(root, 'apps/desktop-renderer/src/main.tsx'), 'export {};\n');
  return root;
}

function packageDirectoryName(): string {
  if (process.platform === 'darwin') return 'mac';
  const prefix = process.platform === 'win32' ? 'win' : 'linux';
  return `${prefix}-unpacked`;
}

function pickleString(value: string): Buffer {
  const text = Buffer.from(value, 'utf8');
  const payloadSize = 4 + text.length + ((4 - (text.length % 4)) % 4);
  const pickle = Buffer.alloc(4 + payloadSize);
  pickle.writeUInt32LE(payloadSize, 0);
  pickle.writeUInt32LE(text.length, 4);
  text.copy(pickle, 8);
  return pickle;
}

function asar(files: Readonly<Record<string, string>>): Buffer {
  const tree: { files: Record<string, unknown> } = { files: {} };
  let offset = 0;
  for (const [path, content] of Object.entries(files)) {
    const segments = path.split('/');
    let current = tree.files;
    for (const segment of segments.slice(0, -1)) {
      const next = current[segment];
      if (next === undefined) current[segment] = { files: {} };
      current = (current[segment] as { files: Record<string, unknown> }).files;
    }
    current[segments.at(-1)!] = {
      offset: String(offset),
      size: Buffer.byteLength(content),
    };
    offset += Buffer.byteLength(content);
  }
  const header = pickleString(JSON.stringify(tree));
  const size = Buffer.alloc(8);
  size.writeUInt32LE(4, 0);
  size.writeUInt32LE(header.length, 4);
  return Buffer.concat([
    size,
    header,
    ...Object.values(files).map((content) => Buffer.from(content)),
  ]);
}

async function writePackagedFixture(
  root: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  const resources = join(root, 'apps/desktop-main/release', packageDirectoryName(), 'resources');
  await mkdir(resources, { recursive: true });
  await writeFile(join(resources, 'app.asar'), asar(files));
  await write(
    join(resources, 'renderer/index.html'),
    '<script type="module" src="./assets/main.js"></script>',
  );
  await write(join(resources, 'renderer/assets/main.js'), 'export {};\n');
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe('checkProductionClosure', () => {
  it('accepts the single canonical source closure', async () => {
    const root = await fixture();

    await expect(checkProductionClosure({ repositoryRoot: root })).resolves.toMatchObject({
      ok: true,
      violations: [],
    });
  });

  it('rejects a disabled path imported by the formal main entry', async () => {
    const root = await fixture();
    await write(join(root, 'apps/desktop-main/src/electron.ts'), "import './legacy/entry.js';\n");
    await write(join(root, 'apps/desktop-main/src/legacy/entry.ts'), 'export {};\n');

    const result = await checkProductionClosure({ repositoryRoot: root });

    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ kind: 'forbidden', location: 'apps/desktop-main/src/electron.ts' }),
    );
  });

  it('rejects a second Target/RC build entry', async () => {
    const root = await fixture();
    await write(
      join(root, 'apps/desktop-main/package.json'),
      JSON.stringify({
        main: 'dist/electron.js',
        scripts: { build: 'tsc -p tsconfig.target-rc.json' },
      }),
    );

    const result = await checkProductionClosure({ repositoryRoot: root });

    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ kind: 'forbidden', location: 'apps/desktop-main/package.json' }),
    );
  });

  it('requires canonical built assets whenever a build directory exists', async () => {
    const root = await fixture();
    await write(join(root, 'apps/desktop-main/dist/electron.js'), 'export {};\n');

    const result = await checkProductionClosure({ repositoryRoot: root });

    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ kind: 'missing', location: 'apps/desktop-main/dist/preload.cjs' }),
    );
  });

  it('fails --require-package when the current platform package is absent', async () => {
    const root = await fixture();

    const result = await checkProductionClosure({ repositoryRoot: root, requirePackage: true });

    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(expect.objectContaining({ kind: 'package' }));
  });

  it('checks formal assets inside the current platform package', async () => {
    const root = await fixture();
    await writePackagedFixture(root, {
      'package.json': JSON.stringify({ main: 'dist/electron.js' }),
      'dist/electron.js': 'export {};\n',
    });

    const result = await checkProductionClosure({ repositoryRoot: root, requirePackage: true });

    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual(
      expect.objectContaining({ kind: 'missing', message: 'is missing dist/preload.cjs' }),
    );
  });
});
