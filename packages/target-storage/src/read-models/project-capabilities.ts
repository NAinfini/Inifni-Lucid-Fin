import {
  EntityIdSchema,
  ProjectCapabilitiesV1Schema,
  parseCanonical,
  type ProjectCapabilitiesV1,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { TargetStorageError } from '../kernel/errors.js';
import type { TargetStore } from '../kernel/store.js';

const UNREVIEWED_QUARANTINE_REASON = 'Unreviewed Skill content is not runtime-eligible';

interface ProviderRow {
  readonly id: string;
  readonly display_name: string;
  readonly provider_kind: string;
  readonly model: string;
  readonly status: string;
  readonly revision: number;
}

interface SkillRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly content_hash: string;
  readonly provenance: string;
  readonly trust: string;
  readonly quarantine_reason: string | null;
  readonly plugin_package_id: string | null;
  readonly plugin_package_version: string | null;
  readonly plugin_manifest_hash: string | null;
}

function corrupt(message: string, cause?: unknown): TargetStorageError {
  return new TargetStorageError(
    'CORRUPT_DATA',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function requireProject(database: DatabaseSync, projectIdValue: string): string {
  const projectId = parseCanonical(EntityIdSchema, projectIdValue);
  if (database.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId) === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Project was not found: ${projectId}`);
  }
  return projectId;
}

function projectCapabilities(
  database: DatabaseSync,
  projectIdValue: string,
): ProjectCapabilitiesV1 {
  const projectId = requireProject(database, projectIdValue);
  const providers = database
    .prepare(
      `SELECT id, display_name, provider_kind, model, status, revision
       FROM provider_profiles
       ORDER BY id`,
    )
    .all() as unknown as ProviderRow[];
  const skills = database
    .prepare(
      `SELECT skill.id, skill.name, skill.description, skill.version, skill.content_hash,
              skill.provenance, skill.trust, quarantine.reason AS quarantine_reason,
              plugin_skill.package_id AS plugin_package_id,
              plugin_skill.package_version AS plugin_package_version,
              plugin_package.manifest_hash AS plugin_manifest_hash
       FROM skill_effective_versions AS effective
       JOIN skills AS skill
         ON skill.id = effective.skill_id AND skill.version = effective.skill_version
       LEFT JOIN skill_quarantines AS quarantine
         ON quarantine.skill_id = skill.id AND quarantine.skill_version = skill.version
       LEFT JOIN plugin_package_skills AS plugin_skill
         ON plugin_skill.skill_id = skill.id AND plugin_skill.skill_version = skill.version
       LEFT JOIN plugin_installations AS installation
         ON installation.package_id = plugin_skill.package_id
        AND installation.package_version = plugin_skill.package_version
        AND installation.state = 'installed'
       LEFT JOIN plugin_packages AS plugin_package
         ON plugin_package.package_id = installation.package_id
        AND plugin_package.package_version = installation.package_version
        AND plugin_package.manifest_hash = installation.manifest_hash
       WHERE (skill.project_id IS NULL OR skill.project_id = ?)
         AND (plugin_skill.package_id IS NULL OR installation.package_id IS NOT NULL)
       ORDER BY skill.id, skill.version`,
    )
    .all(projectId) as unknown as SkillRow[];
  if (providers.length > 500 || skills.length > 500) {
    throw corrupt(`Project ${projectId} capability index exceeds its public bound`);
  }
  try {
    return parseCanonical(ProjectCapabilitiesV1Schema, {
      projectId,
      providers: providers.map((provider) => ({
        id: provider.id,
        displayName: provider.display_name,
        providerKind: provider.provider_kind,
        model: provider.model,
        status: provider.status,
        revision: provider.revision,
      })),
      skills: skills.map((skill) => {
        const quarantined = skill.trust === 'unreviewed' || skill.quarantine_reason !== null;
        if (
          (skill.plugin_package_id === null) !== (skill.plugin_package_version === null) ||
          (skill.plugin_package_id === null) !== (skill.plugin_manifest_hash === null)
        ) {
          throw corrupt(
            `Project ${projectId} Skill ${skill.id}@${skill.version} Plugin data is invalid`,
          );
        }
        return {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          version: skill.version,
          contentHash: skill.content_hash,
          provenance: skill.provenance,
          trust: skill.trust,
          eligibility: quarantined ? 'quarantined' : 'available',
          quarantineReason:
            skill.quarantine_reason ??
            (skill.trust === 'unreviewed' ? UNREVIEWED_QUARANTINE_REASON : null),
          pluginPackage:
            skill.plugin_package_id === null
              ? null
              : {
                  packageId: skill.plugin_package_id,
                  version: skill.plugin_package_version,
                  manifestHash: skill.plugin_manifest_hash,
                },
        };
      }),
    });
  } catch (cause) {
    throw corrupt(`Project ${projectId} capability index is invalid`, cause);
  }
}

export interface ProjectCapabilitiesReadModel {
  readonly get: (projectId: string) => ProjectCapabilitiesV1;
}

export function createProjectCapabilitiesReadModel(
  store: TargetStore,
): ProjectCapabilitiesReadModel {
  return Object.freeze({
    get(projectId: string) {
      return projectCapabilities(getTargetStoreDatabase(store), projectId);
    },
  });
}
