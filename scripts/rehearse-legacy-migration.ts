import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../packages/target-contracts/src/index.js';
import { hashCanonical } from '../packages/target-storage/src/internal/hashes.js';
import { loadCanonicalBuiltInSkillPack } from '../packages/target-storage/src/kernel/artifacts.js';
import { openConfiguredDatabase } from '../packages/target-storage/src/kernel/database.js';
import {
  createLegacySkillRowClassifier,
  LegacySkillMigrationBundleV1Schema,
  validateLegacySkillMigrationPlan,
} from '../packages/target-storage/src/migration/legacy-skill-migration.js';
import {
  parseLegacyBrowserStateSnapshot,
  toRendererSkillsExport,
} from '../packages/target-storage/src/migration/legacy-browser-state.js';
import {
  buildLegacyBrowserStateMigrationEvidence,
  createLegacySqliteChatMirrorSummary,
  type LegacyBrowserStateMigrationEvidence,
} from '../packages/target-storage/src/migration/legacy-browser-state-migration.js';
import { I0_LEGACY_SOURCE_SCHEMAS } from '../packages/target-storage/src/migration/legacy-source-schema.js';
import { preflightLegacyInputs } from '../packages/target-storage/src/migration/legacy-preflight.js';
import { buildLegacyMigrationPlan } from '../packages/target-storage/src/migration/legacy-migration-plan.js';
import { buildLegacyMigrationReadinessReport } from '../packages/target-storage/src/migration/migration-readiness.js';
import { classifyLegacyPhaseOne } from '../packages/target-storage/src/migration/phase-one-classification.js';
import { createLegacyFfprobe } from '../packages/target-storage/src/migration/media-technical-inspector.js';
import { rehearseDisposableLegacyMigration } from '../packages/target-storage/src/migration/legacy-migration-rehearsal.js';

function flagValue(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? undefined : process.argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

async function jsonFile(name: string): Promise<unknown> {
  return JSON.parse(await readFile(resolve(flagValue(name)), 'utf8')) as unknown;
}

function sourcePaths() {
  return {
    mainDatabasePath: resolve(flagValue('--main')),
    promptsDatabasePath: resolve(flagValue('--prompts')),
    assetsRoot: resolve(flagValue('--assets')),
  };
}

export async function validateCanonicalLegacySkillMigrationPlan(input: {
  readonly skillBundle: unknown;
  readonly skillPlan: unknown;
}) {
  const builtInPack = await loadCanonicalBuiltInSkillPack();
  return validateLegacySkillMigrationPlan(input.skillPlan, {
    builtInDocuments: builtInPack.skills,
    sourceBundle: input.skillBundle,
  });
}

export async function buildLegacyMigrationDryRunReport(input: {
  readonly paths: ReturnType<typeof sourcePaths>;
  readonly skillBundle: unknown;
  readonly skillPlan: unknown;
  readonly browserState: unknown;
}) {
  const skillPlan = await validateCanonicalLegacySkillMigrationPlan(input);
  const skillBundle = LegacySkillMigrationBundleV1Schema.parse(input.skillBundle);
  const browserState = parseLegacyBrowserStateSnapshot(input.browserState);
  if (
    canonicalJson(toRendererSkillsExport(browserState)) !==
    canonicalJson(skillBundle.rendererExport)
  ) {
    throw new TypeError('Legacy browser Skill export differs from the migration Skill bundle');
  }
  const preflight = await preflightLegacyInputs(input.paths);
  let phaseOne: ReturnType<typeof classifyLegacyPhaseOne> | null = null;
  let readiness: ReturnType<typeof buildLegacyMigrationReadinessReport> | null = null;
  let plan: ReturnType<typeof buildLegacyMigrationPlan> | null = null;
  let browserStateEvidence: LegacyBrowserStateMigrationEvidence | null = null;
  if (preflight.media.status === 'checked') {
    const main = openConfiguredDatabase(input.paths.mainDatabasePath, true);
    const prompts = openConfiguredDatabase(input.paths.promptsDatabasePath, true);
    try {
      phaseOne = classifyLegacyPhaseOne(
        { main, prompts },
        I0_LEGACY_SOURCE_SCHEMAS,
        preflight.media.report,
        { root: { classifyLegacySkillRows: createLegacySkillRowClassifier(skillPlan) } },
      );
      readiness = buildLegacyMigrationReadinessReport({ preflight, phaseOne });
      browserStateEvidence = buildLegacyBrowserStateMigrationEvidence({
        snapshot: browserState,
        rendererExport: skillBundle.rendererExport,
        sqliteMirror: createLegacySqliteChatMirrorSummary(main),
      });
      if (readiness.ok && browserStateEvidence.ok) {
        plan = buildLegacyMigrationPlan({ readiness, phaseOne });
      }
    } finally {
      prompts.close();
      main.close();
    }
  }
  const withoutFingerprint = {
    schema: 'lucid-fin.legacy-migration-dry-run/v1' as const,
    validatedThrough: 'classification_plan' as const,
    status:
      plan === null
        ? ('blocked_before_materialization' as const)
        : ('ready_for_disposable_rehearsal' as const),
    preflight,
    phaseOne,
    readiness,
    plan,
    skillPlan,
    browserStateEvidence,
    ok: plan !== null,
  };
  return {
    ...withoutFingerprint,
    fingerprint: hashCanonical(withoutFingerprint),
  };
}

async function main(): Promise<void> {
  if (process.argv.includes('--apply') || process.argv.includes('--cutover')) {
    throw new Error('This command has no apply or cutover mode');
  }
  const dryRun = process.argv.includes('--dry-run');
  const rehearse = process.argv.includes('--rehearse');
  if (dryRun === rehearse || !process.argv.includes('--confirm-disposable-copy')) {
    throw new Error(
      'Usage: tsx scripts/rehearse-legacy-migration.ts --dry-run|--rehearse --confirm-disposable-copy --main <sqlite> --prompts <sqlite> --assets <dir> --skill-bundle <json> --skill-plan <json> --browser-state <json> [--target <absent-dir> --readiness <json> --plan <json> --ffprobe <exe>]. Dry-run validates read-only preflight, browser state, classification, readiness, and the frozen plan; only rehearsal performs typed materialization and reconciliation.',
    );
  }
  const paths = sourcePaths();
  const skillBundle = await jsonFile('--skill-bundle');
  const skillPlan = await jsonFile('--skill-plan');
  const browserState = await jsonFile('--browser-state');
  if (dryRun) {
    process.stdout.write(
      `${canonicalJson(await buildLegacyMigrationDryRunReport({ paths, skillBundle, skillPlan, browserState }))}\n`,
    );
    return;
  }
  const builtInPack = await loadCanonicalBuiltInSkillPack();
  const canonicalSkillBundle = LegacySkillMigrationBundleV1Schema.parse(skillBundle);
  const canonicalBrowserState = parseLegacyBrowserStateSnapshot(browserState);
  if (
    canonicalJson(toRendererSkillsExport(canonicalBrowserState)) !==
    canonicalJson(canonicalSkillBundle.rendererExport)
  ) {
    throw new TypeError('Legacy browser Skill export differs from the migration Skill bundle');
  }
  const canonicalSkillPlan = validateLegacySkillMigrationPlan(skillPlan, {
    builtInDocuments: builtInPack.skills,
    sourceBundle: canonicalSkillBundle,
  });
  const ffprobeIndex = process.argv.indexOf('--ffprobe');
  const ffprobePath = ffprobeIndex < 0 ? undefined : flagValue('--ffprobe');
  const report = await rehearseDisposableLegacyMigration({
    paths: {
      ...paths,
    },
    targetRootPath: resolve(flagValue('--target')),
    readiness: (await jsonFile('--readiness')) as Parameters<
      typeof rehearseDisposableLegacyMigration
    >[0]['readiness'],
    plan: (await jsonFile('--plan')) as Parameters<
      typeof rehearseDisposableLegacyMigration
    >[0]['plan'],
    skillBundle: canonicalSkillBundle,
    builtInSkills: builtInPack.skills,
    skillPlan: canonicalSkillPlan,
    browserState: canonicalBrowserState,
    ...(ffprobePath === undefined
      ? {}
      : { probeAudioVisual: createLegacyFfprobe(resolve(ffprobePath)) }),
  });
  process.stdout.write(`${canonicalJson(report)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
