import {
  CapabilityCatalogSnapshotV1Schema,
  SkillDocumentSchema,
  capabilityCatalogHashInput,
  parseCanonical,
  skillCatalogDigestInput,
  canonicalJson,
  type CapabilityCatalogSnapshotV1,
  type SkillDocument,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../kernel/errors.js';
import { capabilityCatalogIntegrityError } from './capability-catalog-integrity.js';
import { hashUtf8 } from './hashes.js';

interface SkillRow {
  id: string | null;
  version: string | null;
  name: string | null;
  description: string | null;
  content_text: string | null;
  content_hash: string | null;
  provenance: SkillDocument['provenance'] | null;
  trust: SkillDocument['trust'] | null;
  project_id: string | null;
  created_at: string | null;
}

interface EnabledSkillRow extends SkillRow {
  enabled_skill_id: string;
  enabled_skill_version: string;
  effective_version: string | null;
  quarantine_id: string | null;
}

function corrupt(message: string, cause?: unknown): StorageError {
  return new StorageError('CORRUPT_DATA', message, cause === undefined ? undefined : { cause });
}

function skillFromRow(row: SkillRow, identity: string): SkillDocument {
  let skill: SkillDocument;
  try {
    skill = parseCanonical(SkillDocumentSchema, {
      skillId: row.id,
      version: row.version,
      name: row.name,
      description: row.description,
      content: row.content_text,
      contentHash: row.content_hash,
      provenance: row.provenance,
      trust: row.trust,
      createdAt: row.created_at,
    });
  } catch (cause) {
    throw corrupt(`Stored Skill ${identity} is invalid`, cause);
  }
  if (
    hashUtf8(skill.content) !== skill.contentHash ||
    (skill.provenance === 'project') !== (row.project_id !== null)
  ) {
    throw corrupt(`Stored Skill ${identity} content or ownership is invalid`);
  }
  return skill;
}

function parseBaseCatalog(input: CapabilityCatalogSnapshotV1): CapabilityCatalogSnapshotV1 {
  let base: CapabilityCatalogSnapshotV1;
  try {
    base = parseCanonical(CapabilityCatalogSnapshotV1Schema, input);
  } catch (cause) {
    throw new StorageError('INVALID_REQUEST', 'Root capability base is invalid', { cause });
  }
  const integrityError = capabilityCatalogIntegrityError(base);
  if (base.parentCatalogHash !== null || base.skills.length !== 0 || integrityError !== undefined) {
    throw new StorageError(
      'INVALID_REQUEST',
      integrityError ?? 'Root capability base must be the frozen tool-only root catalog',
    );
  }
  return base;
}

function currentEligibleSkills(database: DatabaseSync, projectId: string): SkillDocument[] {
  const rows = database
    .prepare(
      `SELECT enablement.skill_id AS enabled_skill_id,
              enablement.skill_version AS enabled_skill_version,
              skill.id, skill.version, skill.name, skill.description, skill.content_text,
              skill.content_hash, skill.provenance, skill.trust, skill.project_id,
              skill.created_at, effective.skill_version AS effective_version,
              quarantine.skill_id AS quarantine_id
       FROM skill_enablements AS enablement
       LEFT JOIN skills AS skill
         ON skill.id = enablement.skill_id AND skill.version = enablement.skill_version
       LEFT JOIN skill_effective_versions AS effective
         ON effective.skill_id = enablement.skill_id
       LEFT JOIN skill_quarantines AS quarantine
         ON quarantine.skill_id = enablement.skill_id
        AND quarantine.skill_version = enablement.skill_version
       WHERE enablement.project_id = ? AND enablement.enabled = 1
       ORDER BY enablement.skill_id, enablement.skill_version`,
    )
    .all(projectId) as unknown as EnabledSkillRow[];
  if (rows.length > 500) {
    throw corrupt(`Project ${projectId} has more than 500 enabled Skills`);
  }
  return rows.map((row) => {
    const identity = `${row.enabled_skill_id}@${row.enabled_skill_version}`;
    if (
      row.id !== row.enabled_skill_id ||
      row.version !== row.enabled_skill_version ||
      row.effective_version !== row.enabled_skill_version ||
      row.quarantine_id !== null ||
      row.trust === 'unreviewed' ||
      (row.project_id !== null && row.project_id !== projectId)
    ) {
      throw corrupt(`Enabled Skill ${identity} is not eligible for Project ${projectId}`);
    }
    return skillFromRow(row, identity);
  });
}

export function buildRootCapabilityCatalog(
  database: DatabaseSync,
  input: { readonly projectId: string; readonly baseCatalog: CapabilityCatalogSnapshotV1 },
): CapabilityCatalogSnapshotV1 {
  const project = database
    .prepare('SELECT lifecycle FROM projects WHERE id = ?')
    .get(input.projectId) as unknown as
    { lifecycle: 'active' | 'archived' | 'deleted' } | undefined;
  if (project === undefined) {
    throw new StorageError('NOT_FOUND', `Project ${input.projectId} was not found`);
  }
  if (project.lifecycle !== 'active') {
    throw new StorageError('INVALID_REQUEST', `Project ${input.projectId} is not active`);
  }
  const base = parseBaseCatalog(input.baseCatalog);
  const skills = currentEligibleSkills(database, input.projectId);
  const withoutHash = {
    version: base.version,
    parserPolicyVersion: base.parserPolicyVersion,
    parentCatalogHash: null,
    toolCatalogDigest: base.toolCatalogDigest,
    skillCatalogDigest: hashUtf8(skillCatalogDigestInput(skills)),
    capabilityIndexDigest: base.capabilityIndexDigest,
    tools: base.tools,
    skills,
    capabilityIndex: base.capabilityIndex,
  } as const;
  return parseCanonical(CapabilityCatalogSnapshotV1Schema, {
    ...withoutHash,
    catalogHash: hashUtf8(capabilityCatalogHashInput(withoutHash)),
  });
}

export function assertFrozenSkillRows(
  database: DatabaseSync,
  projectId: string,
  catalog: CapabilityCatalogSnapshotV1,
): void {
  const integrityError = capabilityCatalogIntegrityError(catalog);
  if (integrityError !== undefined) throw corrupt(integrityError);
  for (const frozen of catalog.skills) {
    const identity = `${frozen.skillId}@${frozen.version}`;
    const row = database
      .prepare(
        `SELECT id, version, name, description, content_text, content_hash, provenance, trust,
                project_id, created_at
         FROM skills WHERE id = ? AND version = ?`,
      )
      .get(frozen.skillId, frozen.version) as unknown as SkillRow | undefined;
    if (row === undefined || (row.project_id !== null && row.project_id !== projectId)) {
      throw corrupt(`Frozen Skill ${identity} is missing or belongs to another Project`);
    }
    if (canonicalJson(skillFromRow(row, identity)) !== canonicalJson(frozen)) {
      throw corrupt(`Frozen Skill ${identity} differs from its immutable row`);
    }
  }
}
