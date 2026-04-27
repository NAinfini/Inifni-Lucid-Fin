import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface IpcHandleRegistration {
  entry: string;
  file: string;
  line: number;
  channel: string;
}

export interface CheckIpcMigrationAllowlistOptions {
  repoRoot: string;
  sourceRoot: string;
  allowlistPath: string;
}

export interface CheckIpcMigrationAllowlistResult {
  ok: boolean;
  registrations: IpcHandleRegistration[];
  unapproved: IpcHandleRegistration[];
  staleAllowlistEntries: string[];
}

const IPC_HANDLE_PATTERN = /ipcMain\.handle\s*\(\s*(`[^`]*`|'[^']*'|"[^"]*"|[A-Za-z_$][\w$]*)/g;

function toRepoPath(repoRoot: string, filePath: string): string {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/');
}

function normalizeChannel(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function lineNumberAt(source: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function stripCommentsPreservingOffsets(source: string): string {
  const chars = [...source];
  let state: 'normal' | 'single' | 'double' | 'template' | 'lineComment' | 'blockComment' =
    'normal';
  let escaped = false;

  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i] ?? '';
    const next = chars[i + 1] ?? '';

    if (state === 'lineComment') {
      if (char === '\n' || char === '\r') {
        state = 'normal';
      } else {
        chars[i] = ' ';
      }
      continue;
    }

    if (state === 'blockComment') {
      if (char === '*' && next === '/') {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i += 1;
        state = 'normal';
      } else if (char !== '\n' && char !== '\r') {
        chars[i] = ' ';
      }
      continue;
    }

    if (state === 'single' || state === 'double' || state === 'template') {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (
        (state === 'single' && char === "'") ||
        (state === 'double' && char === '"') ||
        (state === 'template' && char === '`')
      ) {
        state = 'normal';
      }
      continue;
    }

    if (char === '/' && next === '/') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i += 1;
      state = 'lineComment';
      continue;
    }

    if (char === '/' && next === '*') {
      chars[i] = ' ';
      chars[i + 1] = ' ';
      i += 1;
      state = 'blockComment';
      continue;
    }

    if (char === "'") state = 'single';
    else if (char === '"') state = 'double';
    else if (char === '`') state = 'template';
  }

  return chars.join('');
}

async function listSourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(fullPath)));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.cts'))) {
      files.push(fullPath);
    }
  }
  return files;
}

async function findRegistrations(
  repoRoot: string,
  sourceRoot: string,
): Promise<IpcHandleRegistration[]> {
  const absoluteSourceRoot = path.join(repoRoot, sourceRoot);
  const files = await listSourceFiles(absoluteSourceRoot);
  const registrations: IpcHandleRegistration[] = [];

  for (const filePath of files) {
    const source = await readFile(filePath, 'utf-8');
    const searchableSource = stripCommentsPreservingOffsets(source);
    const relativeFile = toRepoPath(repoRoot, filePath);
    IPC_HANDLE_PATTERN.lastIndex = 0;
    for (let match: RegExpExecArray | null; (match = IPC_HANDLE_PATTERN.exec(searchableSource)); ) {
      const channel = normalizeChannel(match[1] ?? '');
      const line = lineNumberAt(source, match.index);
      registrations.push({
        entry: `${relativeFile} :: ${channel}`,
        file: relativeFile,
        line,
        channel,
      });
    }
  }

  registrations.sort((a, b) => a.entry.localeCompare(b.entry));
  return registrations;
}

async function readAllowlist(repoRoot: string, allowlistPath: string): Promise<Set<string>> {
  const raw = await readFile(path.join(repoRoot, allowlistPath), 'utf-8');
  const entries = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  return new Set(entries);
}

export async function checkIpcMigrationAllowlist(
  options: CheckIpcMigrationAllowlistOptions,
): Promise<CheckIpcMigrationAllowlistResult> {
  const registrations = await findRegistrations(options.repoRoot, options.sourceRoot);
  const allowlist = await readAllowlist(options.repoRoot, options.allowlistPath);
  const actualEntries = new Set(registrations.map((registration) => registration.entry));
  const unapproved = registrations.filter((registration) => !allowlist.has(registration.entry));
  const staleAllowlistEntries = [...allowlist].filter((entry) => !actualEntries.has(entry)).sort();

  return {
    ok: unapproved.length === 0 && staleAllowlistEntries.length === 0,
    registrations,
    unapproved,
    staleAllowlistEntries,
  };
}

async function main(): Promise<void> {
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), '../..');
  const allowlistPath = 'apps/desktop-main/src/ipc/ipc-migration-allowlist.txt';
  if (process.argv.includes('--write')) {
    const registrations = await findRegistrations(repoRoot, 'apps/desktop-main/src');
    const output = [
      '# Raw ipcMain.handle registrations that still need typed registrar migration.',
      '# Format: <repo-relative path> :: <channel literal or reviewed dynamic expression>',
      '# Generated with: npx tsx scripts/check-ipc-migration-allowlist.ts --write',
      '',
      ...registrations.map((registration) => registration.entry),
      '',
    ].join('\n');
    const absoluteAllowlistPath = path.join(repoRoot, allowlistPath);
    await mkdir(path.dirname(absoluteAllowlistPath), { recursive: true });
    await writeFile(absoluteAllowlistPath, output, 'utf-8');
    console.log(
      `check-ipc-migration-allowlist: wrote ${registrations.length} entries to ${allowlistPath}.`,
    );
    return;
  }

  const result = await checkIpcMigrationAllowlist({
    repoRoot,
    sourceRoot: 'apps/desktop-main/src',
    allowlistPath,
  });

  if (result.ok) {
    console.log(
      `check-ipc-migration-allowlist: OK - ${result.registrations.length} raw ipcMain.handle registrations are allowlisted.`,
    );
    return;
  }

  if (result.unapproved.length > 0) {
    console.error('Unapproved raw ipcMain.handle registrations:');
    for (const item of result.unapproved) {
      console.error(`- ${item.entry} (line ${item.line})`);
    }
  }

  if (result.staleAllowlistEntries.length > 0) {
    console.error('Stale IPC migration allowlist entries:');
    for (const entry of result.staleAllowlistEntries) {
      console.error(`- ${entry}`);
    }
  }

  process.exitCode = 1;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('check-ipc-migration-allowlist: crashed', error);
    process.exit(2);
  });
}
