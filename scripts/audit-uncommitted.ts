/**
 * Audit uncommitted changes and produce a staging plan.
 *
 * DRY-RUN ONLY — this script never calls `git add` or `git commit`.
 * It reads the current working tree state and outputs a Markdown report
 * grouping changes into logical commit batches with proposed messages.
 *
 * Usage:
 *   npx tsx scripts/audit-uncommitted.ts            # Markdown report to stdout
 *   npx tsx scripts/audit-uncommitted.ts --json      # Machine-readable JSON
 *   npx tsx scripts/audit-uncommitted.ts > plan.md   # Save to file
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..');

/** Files that should never be committed without explicit review. */
const DANGEROUS_PATTERNS = [
  /\.env($|\.)/,
  /credentials/i,
  /secret/i,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /\.jks$/,
  /\.keystore$/,
];

/** Extensions that indicate large binary files. */
const BINARY_EXTENSIONS = [
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.dmg',
  '.msi',
  '.zip',
  '.tar',
  '.gz',
  '.7z',
  '.rar',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.tiff',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GitStatus = 'modified' | 'untracked' | 'deleted' | 'renamed' | 'added';

interface FileEntry {
  path: string;
  status: GitStatus;
  package: string;
  changeType: ChangeType;
  flags: string[];
}

type ChangeType = 'build' | 'contract' | 'backend' | 'renderer' | 'test' | 'docs' | 'script';

interface CommitGroup {
  order: number;
  label: string;
  commitType: string;
  scope: string;
  description: string;
  files: FileEntry[];
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function run(cmd: string): string {
  return execSync(cmd, {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    timeout: 30_000,
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function getStatusEntries(): FileEntry[] {
  // --porcelain=v1 gives machine-parseable output: XY <path>
  const raw = run('git status --porcelain');
  if (!raw) return [];

  const lines = raw.split('\n').filter(Boolean);
  const entries: FileEntry[] = [];

  for (const line of lines) {
    const statusCode = line.slice(0, 2).trim();
    // Handle renames: "R  old -> new"
    let filePath: string;
    if (statusCode.startsWith('R')) {
      const parts = line.slice(3).split(' -> ');
      filePath = (parts[1] ?? parts[0]).trim();
    } else {
      filePath = line.slice(3).trim();
    }

    const status = parseStatus(statusCode);
    const pkg = inferPackage(filePath);
    const changeType = inferChangeType(filePath);
    const flags = detectFlags(filePath);

    entries.push({ path: filePath, status, package: pkg, changeType, flags });
  }

  return entries;
}

function parseStatus(code: string): GitStatus {
  if (code === '??') return 'untracked';
  if (code.includes('D')) return 'deleted';
  if (code.includes('R')) return 'renamed';
  if (code.includes('A')) return 'added';
  return 'modified';
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function inferPackage(filePath: string): string {
  if (filePath.startsWith('apps/desktop-main/')) return 'desktop-main';
  if (filePath.startsWith('apps/desktop-renderer/')) return 'desktop-renderer';

  const pkgMatch = filePath.match(/^packages\/([^/]+)\//);
  if (pkgMatch) return pkgMatch[1];

  if (filePath.startsWith('scripts/')) return 'scripts';
  if (filePath.startsWith('.trellis/')) return 'trellis';

  // Root-level files
  return 'root';
}

function inferChangeType(filePath: string): ChangeType {
  const lower = filePath.toLowerCase();

  // Test files
  if (
    lower.includes('.test.') ||
    lower.includes('.spec.') ||
    lower.includes('__tests__') ||
    lower.includes('test-utils')
  ) {
    return 'test';
  }

  // Documentation
  if (
    lower.endsWith('.md') ||
    lower.startsWith('docs/') ||
    lower === 'changelog.md' ||
    lower === 'contributing.md' ||
    lower === 'readme.md' ||
    lower === 'readme.zh-cn.md'
  ) {
    return 'docs';
  }

  // Build/config
  if (
    lower.endsWith('tsconfig.json') ||
    lower.endsWith('package.json') ||
    lower.endsWith('.eslintrc') ||
    lower.endsWith('eslint.config.js') ||
    lower.endsWith('vite.config.ts') ||
    lower.endsWith('.prettierrc') ||
    lower.endsWith('.prettierignore') ||
    lower.endsWith('.gitignore') ||
    lower.includes('vitest.config')
  ) {
    return 'build';
  }

  // Scripts
  if (lower.startsWith('scripts/')) return 'script';

  // Contracts/types
  if (
    lower.includes('contracts') ||
    lower.includes('/types') ||
    lower.endsWith('.d.ts')
  ) {
    return 'contract';
  }

  // Renderer
  if (lower.includes('desktop-renderer')) return 'renderer';

  // Backend (desktop-main + packages)
  if (lower.includes('desktop-main') || lower.startsWith('packages/')) {
    return 'backend';
  }

  return 'docs'; // fallback for root-level files
}

function detectFlags(filePath: string): string[] {
  const flags: string[] = [];

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(filePath)) {
      flags.push('DANGEROUS');
      break;
    }
  }

  const ext = filePath.slice(filePath.lastIndexOf('.'));
  if (BINARY_EXTENSIONS.includes(ext.toLowerCase())) {
    flags.push('BINARY');
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Grouping logic
// ---------------------------------------------------------------------------

/**
 * Derive a sub-domain from a file path for finer-grained grouping.
 *
 * Examples:
 *   "apps/desktop-main/src/ipc/handlers/backup.handlers.ts" -> "ipc"
 *   "apps/desktop-main/src/bootstrap/init-app.ts" -> "bootstrap"
 *   "packages/storage/src/backup.ts" -> "storage"
 */
function inferDomain(entry: FileEntry): string {
  const parts = entry.path.split('/');

  if (entry.package === 'desktop-main') {
    // apps/desktop-main/src/<domain>/...
    const srcIdx = parts.indexOf('src');
    if (srcIdx >= 0 && srcIdx + 1 < parts.length) {
      const next = parts[srcIdx + 1];
      // If it's a direct file in src/, use the filename stem
      if (next.includes('.')) {
        return next.replace(/\.[^.]+$/, '');
      }
      return next; // e.g. "ipc", "bootstrap", "services"
    }
  }

  if (entry.package === 'desktop-renderer') {
    const srcIdx = parts.indexOf('src');
    if (srcIdx >= 0 && srcIdx + 1 < parts.length) {
      const next = parts[srcIdx + 1];
      if (next.includes('.')) {
        return next.replace(/\.[^.]+$/, '');
      }
      return next; // e.g. "components", "pages", "lib", "utils"
    }
  }

  // For packages, the package name IS the domain
  return entry.package;
}

function buildGroups(entries: FileEntry[]): CommitGroup[] {
  const groups: CommitGroup[] = [];

  // --- 1. Build/config ---
  const buildFiles = entries.filter((e) => e.changeType === 'build');
  if (buildFiles.length > 0) {
    groups.push({
      order: 1,
      label: 'Build & Configuration',
      commitType: 'chore',
      scope: 'build',
      description: 'update build configuration and tooling',
      files: buildFiles,
    });
  }

  // --- 2. Scripts ---
  const scriptFiles = entries.filter((e) => e.changeType === 'script');
  if (scriptFiles.length > 0) {
    groups.push({
      order: 1,
      label: 'Scripts & Tooling',
      commitType: 'chore',
      scope: 'scripts',
      description: summarizeScripts(scriptFiles),
      files: scriptFiles,
    });
  }

  // --- 3. Contract/type changes ---
  const contractFiles = entries.filter((e) => e.changeType === 'contract');
  if (contractFiles.length > 0) {
    groups.push({
      order: 2,
      label: 'Contracts & Types',
      commitType: 'feat',
      scope: 'contracts',
      description: 'add/update IPC contracts and type definitions',
      files: contractFiles,
    });
  }

  // --- 4. Backend changes grouped by domain ---
  const backendFiles = entries.filter((e) => e.changeType === 'backend');
  const backendByDomain = groupBy(backendFiles, inferDomain);

  for (const [domain, files] of Object.entries(backendByDomain)) {
    groups.push({
      order: 3,
      label: `Backend: ${domain}`,
      commitType: inferCommitType(files),
      scope: domain,
      description: summarizeBackendDomain(domain, files),
      files,
    });
  }

  // --- 5. Renderer changes grouped by domain ---
  const rendererFiles = entries.filter((e) => e.changeType === 'renderer');
  const rendererByDomain = groupBy(rendererFiles, inferDomain);

  for (const [domain, files] of Object.entries(rendererByDomain)) {
    groups.push({
      order: 4,
      label: `Renderer: ${domain}`,
      commitType: inferCommitType(files),
      scope: domain,
      description: summarizeRendererDomain(domain, files),
      files,
    });
  }

  // --- 6. Test changes (standalone test files not already included) ---
  const testFiles = entries.filter((e) => e.changeType === 'test');
  if (testFiles.length > 0) {
    const testByPkg = groupBy(testFiles, (e) => e.package);
    for (const [pkg, files] of Object.entries(testByPkg)) {
      groups.push({
        order: 5,
        label: `Tests: ${pkg}`,
        commitType: 'test',
        scope: pkg,
        description: `add tests for ${pkg}`,
        files,
      });
    }
  }

  // --- 7. Documentation ---
  const docFiles = entries.filter((e) => e.changeType === 'docs');
  if (docFiles.length > 0) {
    groups.push({
      order: 6,
      label: 'Documentation',
      commitType: 'docs',
      scope: 'docs',
      description: 'update documentation and changelogs',
      files: docFiles,
    });
  }

  // Sort by order
  groups.sort((a, b) => a.order - b.order);

  return groups;
}

// ---------------------------------------------------------------------------
// Summarizers
// ---------------------------------------------------------------------------

function inferCommitType(files: FileEntry[]): string {
  const hasNew = files.some((f) => f.status === 'untracked' || f.status === 'added');
  const hasMod = files.some((f) => f.status === 'modified');

  // If all files contain "handler" or "service" and are modifications, it's a fix
  const allHandlersOrServices = files.every(
    (f) => f.path.includes('handler') || f.path.includes('service'),
  );
  if (allHandlersOrServices && !hasNew) return 'fix';

  if (hasNew && !hasMod) return 'feat';
  if (hasNew && hasMod) return 'feat';
  return 'fix';
}

function summarizeScripts(files: FileEntry[]): string {
  const names = files.map((f) => {
    const parts = f.path.split('/');
    return parts[parts.length - 1].replace(/\.ts$/, '');
  });
  return `add ${names.join(', ')} scripts`;
}

function summarizeBackendDomain(domain: string, files: FileEntry[]): string {
  const hasNew = files.some((f) => f.status === 'untracked' || f.status === 'added');
  const verb = hasNew ? 'add' : 'update';
  return `${verb} ${domain} module`;
}

function summarizeRendererDomain(domain: string, files: FileEntry[]): string {
  const hasNew = files.some((f) => f.status === 'untracked' || f.status === 'added');
  const verb = hasNew ? 'add' : 'update';
  return `${verb} ${domain} UI`;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    (result[key] ??= []).push(item);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Output — Markdown
// ---------------------------------------------------------------------------

function renderMarkdown(entries: FileEntry[], groups: CommitGroup[]): string {
  const lines: string[] = [];

  lines.push('# Uncommitted Changes Audit');
  lines.push('');
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push(`> Total files: ${entries.length}`);
  lines.push(
    `> Modified: ${entries.filter((e) => e.status === 'modified').length}` +
      ` | Untracked: ${entries.filter((e) => e.status === 'untracked').length}` +
      ` | Deleted: ${entries.filter((e) => e.status === 'deleted').length}`,
  );
  lines.push('');

  // Dangerous files warning
  const dangerous = entries.filter((e) => e.flags.includes('DANGEROUS'));
  if (dangerous.length > 0) {
    lines.push('## Warnings');
    lines.push('');
    lines.push('The following files may contain sensitive data and should be reviewed carefully:');
    lines.push('');
    for (const f of dangerous) {
      lines.push(`- **${f.path}** (${f.flags.join(', ')})`);
    }
    lines.push('');
  }

  // Binary files
  const binaries = entries.filter((e) => e.flags.includes('BINARY'));
  if (binaries.length > 0) {
    lines.push('## Binary Files');
    lines.push('');
    lines.push('These binary files should be reviewed for necessity and size:');
    lines.push('');
    for (const f of binaries) {
      lines.push(`- ${f.path}`);
    }
    lines.push('');
  }

  // Package distribution
  lines.push('## Change Distribution by Package');
  lines.push('');
  const byPkg = groupBy(entries, (e) => e.package);
  lines.push('| Package | Files | Modified | New |');
  lines.push('|---------|-------|----------|-----|');
  for (const [pkg, files] of Object.entries(byPkg).sort((a, b) => b[1].length - a[1].length)) {
    const mod = files.filter((f) => f.status === 'modified').length;
    const newF = files.filter((f) => f.status === 'untracked' || f.status === 'added').length;
    lines.push(`| ${pkg} | ${files.length} | ${mod} | ${newF} |`);
  }
  lines.push('');

  // Proposed commit groups
  lines.push('## Proposed Commit Plan');
  lines.push('');
  lines.push(`Total groups: ${groups.length}`);
  lines.push('');

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const num = i + 1;

    lines.push(`### Group ${num}: ${g.label}`);
    lines.push('');
    lines.push(`**Proposed commit message:**`);
    lines.push('```');
    lines.push(`${g.commitType}(${g.scope}): ${g.description}`);
    lines.push('```');
    lines.push('');
    lines.push(`**Files (${g.files.length}):**`);
    lines.push('');
    for (const f of g.files) {
      const statusBadge = f.status === 'untracked' ? ' (new)' : f.status === 'modified' ? ' (mod)' : ` (${f.status})`;
      const flagStr = f.flags.length > 0 ? ` [${f.flags.join(', ')}]` : '';
      lines.push(`- \`${f.path}\`${statusBadge}${flagStr}`);
    }
    lines.push('');
  }

  // Git commands (for reference only)
  lines.push('## Suggested Git Commands');
  lines.push('');
  lines.push('> Copy-paste reference. Review each group before executing.');
  lines.push('');

  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const num = i + 1;

    lines.push(`### Group ${num}: ${g.label}`);
    lines.push('```bash');
    lines.push(`git add \\`);
    for (let j = 0; j < g.files.length; j++) {
      const suffix = j < g.files.length - 1 ? ' \\' : '';
      lines.push(`  "${g.files[j].path}"${suffix}`);
    }
    lines.push(`git commit -m "${g.commitType}(${g.scope}): ${g.description}"`);
    lines.push('```');
    lines.push('');
  }

  lines.push('---');
  lines.push('*This is a DRY-RUN report. No files were staged or committed.*');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Output — JSON
// ---------------------------------------------------------------------------

interface JsonReport {
  generated: string;
  summary: {
    totalFiles: number;
    modified: number;
    untracked: number;
    deleted: number;
    dangerous: string[];
    binaries: string[];
  };
  distribution: Record<string, number>;
  groups: Array<{
    order: number;
    label: string;
    commitMessage: string;
    files: Array<{ path: string; status: GitStatus; flags: string[] }>;
  }>;
}

function renderJson(entries: FileEntry[], groups: CommitGroup[]): string {
  const report: JsonReport = {
    generated: new Date().toISOString(),
    summary: {
      totalFiles: entries.length,
      modified: entries.filter((e) => e.status === 'modified').length,
      untracked: entries.filter((e) => e.status === 'untracked').length,
      deleted: entries.filter((e) => e.status === 'deleted').length,
      dangerous: entries.filter((e) => e.flags.includes('DANGEROUS')).map((e) => e.path),
      binaries: entries.filter((e) => e.flags.includes('BINARY')).map((e) => e.path),
    },
    distribution: {},
    groups: [],
  };

  const byPkg = groupBy(entries, (e) => e.package);
  for (const [pkg, files] of Object.entries(byPkg)) {
    report.distribution[pkg] = files.length;
  }

  for (const g of groups) {
    report.groups.push({
      order: g.order,
      label: g.label,
      commitMessage: `${g.commitType}(${g.scope}): ${g.description}`,
      files: g.files.map((f) => ({ path: f.path, status: f.status, flags: f.flags })),
    });
  }

  return JSON.stringify(report, null, 2);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const jsonMode = process.argv.includes('--json');

  const entries = getStatusEntries();

  if (entries.length === 0) {
    console.log(jsonMode ? '{"message":"No uncommitted changes found."}' : 'No uncommitted changes found.');
    return;
  }

  const groups = buildGroups(entries);

  if (jsonMode) {
    console.log(renderJson(entries, groups));
  } else {
    console.log(renderMarkdown(entries, groups));
  }
}

main();
