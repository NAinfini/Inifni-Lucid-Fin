import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LegacySkillContentV1Schema,
  canonicalJson,
} from '../packages/target-contracts/src/index.js';
import { createHostCatalogProvisioning } from '../packages/target-storage/src/host/index.js';
import { getTargetStoreDatabase } from '../packages/target-storage/src/internal/database-access.js';
import {
  createTargetStore,
  openTargetStore,
  type TargetStore,
} from '../packages/target-storage/src/kernel/store.js';
import { buildBuiltInLegacySkills } from './legacy-skill-pack.js';
import {
  legacySkillDatabaseFingerprint,
  migrateLegacySkills,
  type LegacySkillMigrationBundleV1,
} from './migrate-legacy-skills.js';

const NOW = '2026-08-23T00:00:00.000Z';
const directories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...directories].map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
      directories.delete(directory);
    }),
  );
});

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function representativeBundle(): Promise<LegacySkillMigrationBundleV1> {
  const builtIns = await buildBuiltInLegacySkills();
  const sources = builtIns.map((document) =>
    LegacySkillContentV1Schema.parse(JSON.parse(document.content)),
  );
  const preset = sources.find(({ source }) => source.kind === 'preset')!;
  const processPrompts = sources.filter(({ source }) => source.kind === 'process_prompt');
  const promptTemplate = sources.find(({ source }) => source.kind === 'prompt_template')!;
  const rendererSkill = sources.find(({ source }) => source.kind === 'renderer_skill')!;
  const rendererPayload = {
    builtInCustoms: {
      [rendererSkill.source.logicalKey]: 'Private migrated renderer override.',
    },
    builtInNames: {},
    customSkills: [
      {
        id: 'user-continuity-skill',
        name: 'Continuity notes',
        category: 'user',
        customContent: 'Preserve wardrobe and prop continuity between adjacent shots.',
        source: 'user' as const,
        createdAt: 1,
      },
    ],
  };
  const rawJson = canonicalJson(rendererPayload);
  const databaseRows = {
    presetOverrides: [
      {
        id: `override:${preset.source.logicalKey}`,
        presetId: preset.source.logicalKey,
        category: 'camera',
        name: 'Private preset override',
        description: 'Private preset description',
        prompt: 'Private preset instruction',
        params: [],
        defaults: {},
        isUser: false,
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    customShotTemplates: [
      {
        id: 'custom-shot-template',
        name: 'Private shot template',
        description: 'Private shot template instruction',
        tracks: { camera: { entries: [] } },
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    processPromptOverrides: processPrompts.map((envelope, index) => ({
      id: index + 1,
      processKey: envelope.source.logicalKey,
      name: `Process prompt ${index + 1}`,
      description: `Imported process prompt ${index + 1}`,
      defaultValue: envelope.effectiveInstruction,
      customValue: index === 0 ? 'Private process prompt override' : null,
      createdAt: 1,
      updatedAt: index === 0 ? 2 : 1,
    })),
    promptTemplateOverrides: [
      {
        code: promptTemplate.source.logicalKey,
        customValue: 'Private prompt template override',
      },
    ],
  };
  return {
    schema: 'lucid-fin.legacy-skill-migration-bundle/v1',
    cutoverAt: NOW,
    databaseFingerprint: legacySkillDatabaseFingerprint(databaseRows),
    rendererExport: {
      storageKey: 'lucid-skills-v2',
      rawJson,
      rawHash: sha256(rawJson),
    },
    ...databaseRows,
  };
}

function catalogSnapshot(store: TargetStore) {
  const database = getTargetStoreDatabase(store);
  return {
    skills: database
      .prepare(
        `SELECT id, version, content_hash, provenance, trust, project_id,
                created_by_confirmation_id, created_at
         FROM skills ORDER BY id, version`,
      )
      .all(),
    effectiveVersions: database
      .prepare(
        `SELECT skill_id, skill_version, changed_at
         FROM skill_effective_versions ORDER BY skill_id`,
      )
      .all(),
    quarantines: database
      .prepare(
        `SELECT skill_id, skill_version, reason
         FROM skill_quarantines ORDER BY skill_id, skill_version`,
      )
      .all(),
    enablementCount: database.prepare('SELECT COUNT(*) AS count FROM skill_enablements').get(),
    foreignKeyFindings: database.prepare('PRAGMA foreign_key_check').all(),
  };
}

describe('Legacy Skill disposable target SQLite rehearsal', () => {
  it('applies, reopens, and reruns the complete catalog without changing persisted state', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-legacy-skills-sqlite-'));
    directories.add(directory);
    const databasePath = join(directory, 'target.sqlite');
    const bundle = await representativeBundle();
    const sourceFingerprint = sha256(canonicalJson(bundle));
    const dryRun = await migrateLegacySkills({ mode: 'dry-run', bundle });
    let store = await createTargetStore(databasePath);

    try {
      const first = await migrateLegacySkills({
        mode: 'apply',
        bundle,
        host: createHostCatalogProvisioning(store),
        expectedReportHash: dryRun.reportHash,
      });
      expect(first.counts).toMatchObject({
        builtIn: 287,
        dynamic: 6,
        total: 293,
        quarantined: 41,
      });
      expect(first.entries.every(({ registration }) => registration === 'inserted')).toBe(true);
      expect(JSON.stringify(first)).not.toContain('Private');
      const firstSnapshot = catalogSnapshot(store);
      expect(firstSnapshot.skills).toHaveLength(first.counts.total);
      expect(firstSnapshot.quarantines).toHaveLength(first.counts.quarantined);
      expect(firstSnapshot.enablementCount).toEqual({ count: 0 });
      expect(firstSnapshot.foreignKeyFindings).toEqual([]);

      store.close();
      store = await openTargetStore(databasePath);
      expect(catalogSnapshot(store)).toEqual(firstSnapshot);

      const second = await migrateLegacySkills({
        mode: 'apply',
        bundle,
        host: createHostCatalogProvisioning(store),
        expectedReportHash: dryRun.reportHash,
      });
      expect(second.reportHash).toBe(first.reportHash);
      expect(second.sourceFingerprint).toBe(first.sourceFingerprint);
      expect(second.entries.every(({ registration }) => registration === 'unchanged')).toBe(true);
      expect(catalogSnapshot(store)).toEqual(firstSnapshot);
      expect(sha256(canonicalJson(bundle))).toBe(sourceFingerprint);
    } finally {
      store.close();
    }
  });
});
