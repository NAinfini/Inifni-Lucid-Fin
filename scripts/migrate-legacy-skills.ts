import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../packages/target-contracts/src/index.js';
import type {
  HostCatalogProvisioning,
  SkillRegistrationInput,
} from '../packages/target-storage/src/host/index.js';
import {
  composeLegacySkillMigrationBundle,
  planLegacySkillMigration as planLegacySkillMigrationFromCatalog,
  reportLegacySkillMigration,
  type LegacySkillMigrationPlan,
  type LegacySkillMigrationReport,
} from '../packages/target-storage/src/migration/legacy-skill-migration.js';
import { buildBuiltInLegacySkills } from './legacy-skill-pack.js';

export {
  LegacySkillMigrationBundleV1Schema,
  LegacySkillMigrationPlanRowSchema,
  LegacySkillMigrationPlanSchema,
  composeLegacySkillMigrationBundle,
  createLegacySkillRowClassifier,
  legacySkillDatabaseFingerprint,
  reportLegacySkillMigration,
  validateLegacySkillMigrationPlan,
} from '../packages/target-storage/src/migration/legacy-skill-migration.js';
export type {
  LegacySkillMigrationBundleV1,
  LegacySkillMigrationPlan,
  LegacySkillMigrationPlanRow,
  LegacySkillMigrationReport,
  LegacySkillMigrationReportEntry,
} from '../packages/target-storage/src/migration/legacy-skill-migration.js';

/** Keeps the CLI's canonical catalog source separate from the pure planner. */
export async function planLegacySkillMigration(
  bundleValue: unknown,
): Promise<LegacySkillMigrationPlan> {
  return planLegacySkillMigrationFromCatalog(bundleValue, await buildBuiltInLegacySkills());
}

export async function migrateLegacySkills(options: {
  readonly mode: 'dry-run' | 'apply';
  readonly bundle: unknown;
  readonly host?: HostCatalogProvisioning;
  readonly expectedReportHash?: string;
}): Promise<LegacySkillMigrationReport> {
  const plan = await planLegacySkillMigration(options.bundle);
  const registrations: SkillRegistrationInput[] = plan.documents.map((document) => ({
    document,
    projectId: null,
  }));
  const planned = reportLegacySkillMigration({
    mode: options.mode,
    plan,
    registrations: plan.documents.map(() => 'planned'),
  });
  if (options.mode === 'dry-run') return planned;
  if (options.host === undefined) {
    throw new Error('Apply mode requires host provisioning authority');
  }
  if (options.expectedReportHash !== planned.reportHash) {
    throw new Error('Apply expectedReportHash does not match the exact dry-run report');
  }
  const result = options.host.registerSkillBatch({
    sourceFingerprint: createHash('sha256')
      .update(canonicalJson(registrations), 'utf8')
      .digest('hex'),
    entries: registrations,
  });
  return reportLegacySkillMigration({
    mode: options.mode,
    plan,
    registrations: result.results.map(({ status }) => status),
  });
}

async function main(): Promise<void> {
  if (process.argv.includes('--compose')) {
    const legacyDatabaseFlag = process.argv.indexOf('--legacy-database');
    const legacyPromptDatabaseFlag = process.argv.indexOf('--legacy-prompt-database');
    const rendererExportFlag = process.argv.indexOf('--renderer-export');
    const cutoverAtFlag = process.argv.indexOf('--cutover-at');
    const required = [
      process.argv[legacyDatabaseFlag + 1],
      process.argv[legacyPromptDatabaseFlag + 1],
      process.argv[rendererExportFlag + 1],
      process.argv[cutoverAtFlag + 1],
    ];
    if (
      legacyDatabaseFlag < 0 ||
      legacyPromptDatabaseFlag < 0 ||
      rendererExportFlag < 0 ||
      cutoverAtFlag < 0 ||
      required.some((value) => value === undefined)
    ) {
      throw new Error(
        'Compose requires --legacy-database, --legacy-prompt-database, --renderer-export, and --cutover-at',
      );
    }
    const rendererExport = JSON.parse(
      await readFile(resolve(process.argv[rendererExportFlag + 1]!), 'utf8'),
    ) as unknown;
    process.stdout.write(
      `${canonicalJson(
        composeLegacySkillMigrationBundle({
          legacyDatabasePath: process.argv[legacyDatabaseFlag + 1]!,
          legacyPromptDatabasePath: process.argv[legacyPromptDatabaseFlag + 1]!,
          rendererExport,
          cutoverAt: process.argv[cutoverAtFlag + 1]!,
        }),
      )}\n`,
    );
    return;
  }
  const mode = process.argv.includes('--apply')
    ? 'apply'
    : process.argv.includes('--plan')
      ? 'plan'
      : process.argv.includes('--dry-run')
        ? 'dry-run'
        : undefined;
  const bundleFlag = process.argv.indexOf('--bundle');
  const databaseFlag = process.argv.indexOf('--database');
  const expectedReportHashFlag = process.argv.indexOf('--expected-report-hash');
  if (mode === undefined || bundleFlag < 0 || process.argv[bundleFlag + 1] === undefined) {
    throw new Error(
      'Usage: tsx scripts/migrate-legacy-skills.ts --plan|--dry-run|--apply --bundle <json> [--database <sqlite> --expected-report-hash <sha256>]',
    );
  }
  const bundle = JSON.parse(
    await readFile(resolve(process.argv[bundleFlag + 1]!), 'utf8'),
  ) as unknown;
  if (mode === 'plan') {
    process.stdout.write(`${canonicalJson(await planLegacySkillMigration(bundle))}\n`);
    return;
  }
  if (mode === 'dry-run') {
    process.stdout.write(`${canonicalJson(await migrateLegacySkills({ mode, bundle }))}\n`);
    return;
  }
  if (databaseFlag < 0 || process.argv[databaseFlag + 1] === undefined) {
    throw new Error('Apply mode requires --database <sqlite>');
  }
  if (expectedReportHashFlag < 0 || process.argv[expectedReportHashFlag + 1] === undefined) {
    throw new Error('Apply mode requires --expected-report-hash <sha256> from dry-run');
  }
  const [{ openTargetStore }, { createHostCatalogProvisioning }] = await Promise.all([
    import('../packages/target-storage/src/kernel/store.js'),
    import('../packages/target-storage/src/host/index.js'),
  ]);
  const store = await openTargetStore(resolve(process.argv[databaseFlag + 1]!));
  try {
    const report = await migrateLegacySkills({
      mode,
      bundle,
      host: createHostCatalogProvisioning(store),
      expectedReportHash: process.argv[expectedReportHashFlag + 1],
    });
    process.stdout.write(`${canonicalJson(report)}\n`);
  } finally {
    store.close();
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
