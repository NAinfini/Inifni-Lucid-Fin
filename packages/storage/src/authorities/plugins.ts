import {
  IsoTimestampSchema,
  PluginPackageApplyOutputV1Schema,
  PluginPackageAuditEventV1Schema,
  PluginPackageInstallationV1Schema,
  PluginPackageManifestV1Schema,
  PluginPackageQueryOutputV1Schema,
  PluginPackageViewV1Schema,
  WireSuccessV1Schema,
  canonicalJson,
  parseCanonical,
  parseRequestV1,
  pluginPackageAuditEventHashInput,
  pluginPackageManifestHashInput,
  type PluginPackageAuditEventV1,
  type PluginPackageInstallationV1,
  type PluginPackageManifestV1,
  type PluginPackageQueryOutputV1,
  type PluginPackageViewV1,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import {
  CommandContextSchema,
  executeWireMutation,
  type CommandContext,
} from '../internal/command.js';
import { getStoreDatabase } from '../internal/database-access.js';
import {
  resolveStorageEnvironment,
  type StorageEnvironment,
  type StorageEnvironmentOptions,
} from '../internal/environment.js';
import { hashUtf8 } from '../internal/hashes.js';
import {
  setEffectiveSkillVersionInTransaction,
  writeSkillRegistrationInTransaction,
} from '../internal/skill-registration.js';
import { StorageError } from '../kernel/errors.js';
import type { Store } from '../kernel/store.js';

type PluginQueryRequest = Extract<WireRequestV1, { readonly method: 'plugin.query' }>;
type PluginQuerySuccess = Extract<WireSuccessV1, { readonly method: 'plugin.query' }>;
type PluginApplyRequest = Extract<WireRequestV1, { readonly method: 'plugin.apply' }>;
type PluginApplySuccess = Extract<WireSuccessV1, { readonly method: 'plugin.apply' }>;

interface PluginPackageRow {
  readonly package_id: string;
  readonly package_version: string;
  readonly name: string;
  readonly description: string;
  readonly manifest_v1_json: string;
  readonly manifest_hash: string;
  readonly registered_at: string;
}

interface PluginPackageSkillRow {
  readonly skill_id: string;
  readonly skill_version: string;
  readonly ordinal: number;
}

interface PluginInstallationRow {
  readonly package_id: string;
  readonly package_version: string;
  readonly manifest_hash: string;
  readonly state: 'installed' | 'removed';
  readonly revision: number;
  readonly installed_at: string;
  readonly removed_at: string | null;
}

interface PluginAuditEventRow {
  readonly sequence: number;
  readonly id: string;
  readonly package_id: string;
  readonly package_version: string;
  readonly manifest_hash: string;
  readonly action: 'installed' | 'removed';
  readonly installation_revision: number;
  readonly previous_event_hash: string | null;
  readonly event_hash: string;
  readonly occurred_at: string;
}

export interface TrustedPluginCatalogPort {
  list(): readonly PluginPackageManifestV1[];
}

const emptyTrustedPluginCatalog: TrustedPluginCatalogPort = Object.freeze({
  list: () => Object.freeze([]),
});

function corrupt(message: string, cause?: unknown): StorageError {
  return new StorageError('CORRUPT_DATA', message, cause === undefined ? undefined : { cause });
}

function conflict(message: string): StorageError {
  return new StorageError('IDEMPOTENCY_CONFLICT', message);
}

function queryRequest(inputValue: PluginQueryRequest): PluginQueryRequest {
  const request = parseRequestV1(inputValue);
  if (request.method !== 'plugin.query') {
    throw new StorageError('INVALID_REQUEST', 'Expected plugin.query Wire request');
  }
  return request as PluginQueryRequest;
}

function applyRequest(inputValue: PluginApplyRequest): PluginApplyRequest {
  const request = parseRequestV1(inputValue);
  if (request.method !== 'plugin.apply') {
    throw new StorageError('INVALID_REQUEST', 'Expected plugin.apply Wire request');
  }
  return request as PluginApplyRequest;
}

function parseManifest(value: unknown, identity: string): PluginPackageManifestV1 {
  let manifest: PluginPackageManifestV1;
  try {
    manifest = parseCanonical(PluginPackageManifestV1Schema, value);
  } catch (cause) {
    throw corrupt(`Trusted Plugin package ${identity} is invalid`, cause);
  }
  if (hashUtf8(pluginPackageManifestHashInput(manifest)) !== manifest.manifestHash) {
    throw corrupt(`Trusted Plugin package ${identity} manifest hash does not match`);
  }
  return manifest;
}

function trustedCatalog(port: TrustedPluginCatalogPort): readonly PluginPackageManifestV1[] {
  let supplied: readonly PluginPackageManifestV1[];
  try {
    supplied = port.list();
  } catch (cause) {
    throw new StorageError('INVALID_REQUEST', 'Trusted Plugin catalog is unavailable', {
      cause,
    });
  }
  const manifests = supplied.map((value) => parseManifest(value, 'catalog entry'));
  if (manifests.length > 500) {
    throw new StorageError('INVALID_REQUEST', 'Trusted Plugin catalog exceeds 500 packages');
  }
  const identities = new Set<string>();
  for (const manifest of manifests) {
    const identity = `${manifest.packageId}\u0000${manifest.version}`;
    if (identities.has(identity)) {
      throw new StorageError('INVALID_REQUEST', `Trusted Plugin catalog duplicates ${identity}`);
    }
    identities.add(identity);
  }
  return Object.freeze(
    [...manifests].sort(
      (left, right) =>
        left.packageId.localeCompare(right.packageId) || left.version.localeCompare(right.version),
    ),
  );
}

function manifestFromRow(row: PluginPackageRow): PluginPackageManifestV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.manifest_v1_json);
  } catch (cause) {
    throw corrupt(
      `Stored Plugin package ${row.package_id}@${row.package_version} JSON is invalid`,
      cause,
    );
  }
  const manifest = parseManifest(parsed, `${row.package_id}@${row.package_version}`);
  if (
    manifest.packageId !== row.package_id ||
    manifest.version !== row.package_version ||
    manifest.name !== row.name ||
    manifest.description !== row.description ||
    manifest.manifestHash !== row.manifest_hash ||
    canonicalJson(manifest) !== row.manifest_v1_json
  ) {
    throw corrupt(
      `Stored Plugin package ${row.package_id}@${row.package_version} differs from its manifest`,
    );
  }
  return manifest;
}

function installationFromRow(row: PluginInstallationRow): PluginPackageInstallationV1 {
  try {
    return parseCanonical(PluginPackageInstallationV1Schema, {
      packageId: row.package_id,
      version: row.package_version,
      manifestHash: row.manifest_hash,
      state: row.state,
      revision: row.revision,
      installedAt: row.installed_at,
      removedAt: row.removed_at,
    });
  } catch (cause) {
    throw corrupt(`Stored Plugin installation ${row.package_id} is invalid`, cause);
  }
}

function auditEventFromRow(row: PluginAuditEventRow): PluginPackageAuditEventV1 {
  let event: PluginPackageAuditEventV1;
  try {
    event = parseCanonical(PluginPackageAuditEventV1Schema, {
      id: row.id,
      sequence: row.sequence,
      packageId: row.package_id,
      version: row.package_version,
      manifestHash: row.manifest_hash,
      action: row.action,
      installationRevision: row.installation_revision,
      previousEventHash: row.previous_event_hash,
      eventHash: row.event_hash,
      occurredAt: row.occurred_at,
    });
  } catch (cause) {
    throw corrupt(`Stored Plugin audit event ${row.id} is invalid`, cause);
  }
  if (hashUtf8(pluginPackageAuditEventHashInput(event)) !== event.eventHash) {
    throw corrupt(`Stored Plugin audit event ${event.id} hash does not match`);
  }
  return event;
}

function auditChain(database: DatabaseSync): readonly PluginPackageAuditEventV1[] {
  const rows = database
    .prepare(
      `SELECT sequence, id, package_id, package_version, manifest_hash, action,
              installation_revision, previous_event_hash, event_hash, occurred_at
       FROM plugin_audit_events ORDER BY sequence`,
    )
    .all() as unknown as PluginAuditEventRow[];
  let previousHash: string | null = null;
  return Object.freeze(
    rows.map((row, index) => {
      const event = auditEventFromRow(row);
      if (event.sequence !== index + 1 || event.previousEventHash !== previousHash) {
        throw corrupt(`Plugin audit chain diverges at sequence ${event.sequence}`);
      }
      previousHash = event.eventHash;
      return event;
    }),
  );
}

function packageRows(database: DatabaseSync): readonly PluginPackageRow[] {
  return database
    .prepare(
      `SELECT package_id, package_version, name, description, manifest_v1_json, manifest_hash,
              registered_at
       FROM plugin_packages ORDER BY package_id, package_version`,
    )
    .all() as unknown as PluginPackageRow[];
}

function packageManifest(
  database: DatabaseSync,
  packageId: string,
  version: string,
): PluginPackageManifestV1 {
  const row = database
    .prepare(
      `SELECT package_id, package_version, name, description, manifest_v1_json, manifest_hash,
              registered_at
       FROM plugin_packages WHERE package_id = ? AND package_version = ?`,
    )
    .get(packageId, version) as unknown as PluginPackageRow | undefined;
  if (row === undefined) {
    throw new StorageError('NOT_FOUND', `Plugin package ${packageId}@${version} was not found`);
  }
  return manifestFromRow(row);
}

function installationForPackage(
  database: DatabaseSync,
  packageId: string,
): PluginPackageInstallationV1 | undefined {
  const row = database
    .prepare(
      `SELECT package_id, package_version, manifest_hash, state, revision, installed_at, removed_at
       FROM plugin_installations WHERE package_id = ?`,
    )
    .get(packageId) as unknown as PluginInstallationRow | undefined;
  return row === undefined ? undefined : installationFromRow(row);
}

function packageMemberRows(
  database: DatabaseSync,
  manifest: PluginPackageManifestV1,
): readonly PluginPackageSkillRow[] {
  return database
    .prepare(
      `SELECT skill_id, skill_version, ordinal
       FROM plugin_package_skills
       WHERE package_id = ? AND package_version = ?
       ORDER BY ordinal`,
    )
    .all(manifest.packageId, manifest.version) as unknown as PluginPackageSkillRow[];
}

function ensurePluginSkillIdentityIsOwnedByPackage(
  database: DatabaseSync,
  manifest: PluginPackageManifestV1,
): void {
  for (const skill of manifest.skills) {
    const foreignOwner = database
      .prepare(
        `SELECT package_id
         FROM plugin_package_skills
         WHERE skill_id = ? AND package_id <> ?
         LIMIT 1`,
      )
      .get(skill.skillId, manifest.packageId) as unknown as { package_id: string } | undefined;
    if (foreignOwner !== undefined) {
      throw conflict(
        `Plugin Skill ${skill.skillId} is already owned by ${foreignOwner.package_id}`,
      );
    }
    const unownedSkill = database
      .prepare(
        `SELECT skill.version
         FROM skills AS skill
         WHERE skill.id = ?
           AND NOT EXISTS (
             SELECT 1 FROM plugin_package_skills AS member
             WHERE member.skill_id = skill.id AND member.skill_version = skill.version
           )
         LIMIT 1`,
      )
      .get(skill.skillId) as unknown as { version: string } | undefined;
    if (unownedSkill !== undefined) {
      throw conflict(
        `Plugin Skill ${skill.skillId} conflicts with an independently registered version`,
      );
    }
  }
}

function syncManifestInTransaction(
  database: DatabaseSync,
  manifest: PluginPackageManifestV1,
  registeredAt: string,
): void {
  if (!database.isTransaction) {
    throw new StorageError(
      'INVALID_REQUEST',
      'Plugin catalog synchronization requires a transaction',
    );
  }
  ensurePluginSkillIdentityIsOwnedByPackage(database, manifest);
  for (const skill of manifest.skills) {
    writeSkillRegistrationInTransaction(
      database,
      { document: skill, projectId: null },
      {
        createdByConfirmationId: null,
        effectiveAt: registeredAt,
        allowExactExisting: true,
        activateEffectiveVersion: false,
      },
    );
  }

  const canonicalManifest = canonicalJson(manifest);
  const existing = database
    .prepare(
      `SELECT package_id, package_version, name, description, manifest_v1_json, manifest_hash,
              registered_at
       FROM plugin_packages WHERE package_id = ? AND package_version = ?`,
    )
    .get(manifest.packageId, manifest.version) as unknown as PluginPackageRow | undefined;
  if (existing === undefined) {
    database
      .prepare(
        `INSERT INTO plugin_packages (
           package_id, package_version, name, description, manifest_v1_json, manifest_hash,
           registered_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        manifest.packageId,
        manifest.version,
        manifest.name,
        manifest.description,
        canonicalManifest,
        manifest.manifestHash,
        registeredAt,
      );
  } else if (canonicalJson(manifestFromRow(existing)) !== canonicalManifest) {
    throw conflict(
      `Plugin package ${manifest.packageId}@${manifest.version} conflicts with history`,
    );
  }

  const existingMembers = packageMemberRows(database, manifest);
  const expectedMembers = manifest.skills.map((skill, ordinal) => ({
    skill_id: skill.skillId,
    skill_version: skill.version,
    ordinal,
  }));
  if (existingMembers.length !== 0) {
    if (canonicalJson(existingMembers) !== canonicalJson(expectedMembers)) {
      throw corrupt(`Plugin package ${manifest.packageId}@${manifest.version} member rows differ`);
    }
    return;
  }
  const insertMember = database.prepare(
    `INSERT INTO plugin_package_skills (
       package_id, package_version, skill_id, skill_version, ordinal
     ) VALUES (?, ?, ?, ?, ?)`,
  );
  expectedMembers.forEach((member) =>
    insertMember.run(
      manifest.packageId,
      manifest.version,
      member.skill_id,
      member.skill_version,
      member.ordinal,
    ),
  );
}

function ensureManifestIsInstalledEligible(
  database: DatabaseSync,
  manifest: PluginPackageManifestV1,
  occurredAt: string,
): void {
  const members = packageMemberRows(database, manifest);
  if (members.length !== manifest.skills.length) {
    throw corrupt(`Plugin package ${manifest.packageId}@${manifest.version} member count differs`);
  }
  for (const [index, member] of members.entries()) {
    const skill = manifest.skills[index];
    if (
      skill === undefined ||
      member.skill_id !== skill.skillId ||
      member.skill_version !== skill.version ||
      member.ordinal !== index
    ) {
      throw corrupt(
        `Plugin package ${manifest.packageId}@${manifest.version} member order differs`,
      );
    }
    const conflictingEnablement = database
      .prepare(
        `SELECT project_id, skill_version
         FROM skill_enablements
         WHERE skill_id = ? AND enabled = 1 AND skill_version <> ?
         LIMIT 1`,
      )
      .get(member.skill_id, member.skill_version) as unknown as
      { project_id: string; skill_version: string } | undefined;
    if (conflictingEnablement !== undefined) {
      throw new StorageError(
        'INVALID_REQUEST',
        `Plugin Skill ${member.skill_id} conflicts with enabled ${conflictingEnablement.skill_version}`,
      );
    }
  }
  members.forEach((member) =>
    setEffectiveSkillVersionInTransaction(
      database,
      member.skill_id,
      member.skill_version,
      occurredAt,
    ),
  );
}

function appendAuditEventInTransaction(
  database: DatabaseSync,
  environment: StorageEnvironment,
  input: {
    readonly manifest: PluginPackageManifestV1;
    readonly action: PluginPackageAuditEventV1['action'];
    readonly installationRevision: number;
    readonly occurredAt: string;
  },
): PluginPackageAuditEventV1 {
  const chain = auditChain(database);
  const previous = chain.at(-1) ?? null;
  const eventBase = {
    id: environment.createId('plugin_audit_event'),
    sequence: (previous?.sequence ?? 0) + 1,
    packageId: input.manifest.packageId,
    version: input.manifest.version,
    manifestHash: input.manifest.manifestHash,
    action: input.action,
    installationRevision: input.installationRevision,
    previousEventHash: previous?.eventHash ?? null,
    occurredAt: input.occurredAt,
  } as const;
  const event = parseCanonical(PluginPackageAuditEventV1Schema, {
    ...eventBase,
    eventHash: hashUtf8(pluginPackageAuditEventHashInput(eventBase)),
  });
  database
    .prepare(
      `INSERT INTO plugin_audit_events (
         sequence, id, package_id, package_version, manifest_hash, action, installation_revision,
         previous_event_hash, event_hash, occurred_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event.sequence,
      event.id,
      event.packageId,
      event.version,
      event.manifestHash,
      event.action,
      event.installationRevision,
      event.previousEventHash,
      event.eventHash,
      event.occurredAt,
    );
  return event;
}

function installedManifestMatches(
  installation: PluginPackageInstallationV1,
  manifest: PluginPackageManifestV1,
): boolean {
  return (
    installation.packageId === manifest.packageId &&
    installation.version === manifest.version &&
    installation.manifestHash === manifest.manifestHash
  );
}

function installInTransaction(
  database: DatabaseSync,
  environment: StorageEnvironment,
  request: PluginApplyRequest,
  manifest: PluginPackageManifestV1,
  occurredAt: string,
) {
  const current = installationForPackage(database, manifest.packageId);
  if (current === undefined) {
    if (request.input.expectedInstallationRevision !== null) {
      throw new StorageError(
        'REVISION_CONFLICT',
        `Plugin package ${manifest.packageId} has not been installed`,
      );
    }
    ensureManifestIsInstalledEligible(database, manifest, occurredAt);
    database
      .prepare(
        `INSERT INTO plugin_installations (
           package_id, package_version, manifest_hash, state, revision, installed_at, removed_at,
           updated_at
         ) VALUES (?, ?, ?, 'installed', 0, ?, NULL, ?)`,
      )
      .run(manifest.packageId, manifest.version, manifest.manifestHash, occurredAt, occurredAt);
    const installation = installationForPackage(database, manifest.packageId);
    if (installation === undefined)
      throw corrupt(`Plugin installation ${manifest.packageId} vanished`);
    const auditEvent = appendAuditEventInTransaction(database, environment, {
      manifest,
      action: 'installed',
      installationRevision: installation.revision,
      occurredAt,
    });
    return { installation, auditEvent };
  }
  if (request.input.expectedInstallationRevision !== current.revision) {
    throw new StorageError(
      'REVISION_CONFLICT',
      `Plugin installation ${manifest.packageId} revision changed`,
    );
  }
  if (current.state === 'installed') {
    if (!installedManifestMatches(current, manifest)) {
      throw new StorageError(
        'INVALID_REQUEST',
        `Remove installed Plugin package ${manifest.packageId} before selecting another version`,
      );
    }
    return { installation: current, auditEvent: null };
  }
  ensureManifestIsInstalledEligible(database, manifest, occurredAt);
  database
    .prepare(
      `UPDATE plugin_installations
       SET package_version = ?, manifest_hash = ?, state = 'installed', revision = ?,
           installed_at = ?, removed_at = NULL, updated_at = ?
       WHERE package_id = ? AND revision = ? AND state = 'removed'`,
    )
    .run(
      manifest.version,
      manifest.manifestHash,
      current.revision + 1,
      occurredAt,
      occurredAt,
      manifest.packageId,
      current.revision,
    );
  const installation = installationForPackage(database, manifest.packageId);
  if (installation === undefined || installation.state !== 'installed') {
    throw new StorageError(
      'REVISION_CONFLICT',
      `Plugin installation ${manifest.packageId} changed`,
    );
  }
  const auditEvent = appendAuditEventInTransaction(database, environment, {
    manifest,
    action: 'installed',
    installationRevision: installation.revision,
    occurredAt,
  });
  return { installation, auditEvent };
}

function assertNoEnabledMembersInTransaction(
  database: DatabaseSync,
  manifest: PluginPackageManifestV1,
): void {
  const enabled = database
    .prepare(
      `SELECT enablement.project_id, enablement.skill_id, enablement.skill_version
       FROM skill_enablements AS enablement
       JOIN plugin_package_skills AS member
         ON member.skill_id = enablement.skill_id AND member.skill_version = enablement.skill_version
       WHERE member.package_id = ? AND member.package_version = ? AND enablement.enabled = 1
       ORDER BY enablement.project_id, enablement.skill_id
       LIMIT 1`,
    )
    .get(manifest.packageId, manifest.version) as unknown as
    { project_id: string; skill_id: string; skill_version: string } | undefined;
  if (enabled !== undefined) {
    throw new StorageError(
      'INVALID_REQUEST',
      `Plugin package ${manifest.packageId} remains enabled by Project ${enabled.project_id}`,
    );
  }
}

function removeInTransaction(
  database: DatabaseSync,
  environment: StorageEnvironment,
  request: PluginApplyRequest,
  occurredAt: string,
) {
  const manifest = packageManifest(database, request.input.packageId, request.input.version);
  if (manifest.manifestHash !== request.input.manifestHash) {
    throw new StorageError('INVALID_REQUEST', 'Plugin package manifest hash does not match');
  }
  const current = installationForPackage(database, manifest.packageId);
  if (current === undefined || !installedManifestMatches(current, manifest)) {
    throw new StorageError('NOT_FOUND', `Plugin package ${manifest.packageId} is not installed`);
  }
  if (request.input.expectedInstallationRevision !== current.revision) {
    throw new StorageError(
      'REVISION_CONFLICT',
      `Plugin installation ${manifest.packageId} revision changed`,
    );
  }
  if (current.state === 'removed') return { manifest, installation: current, auditEvent: null };
  assertNoEnabledMembersInTransaction(database, manifest);
  const updated = database
    .prepare(
      `UPDATE plugin_installations
       SET state = 'removed', revision = ?, removed_at = ?, updated_at = ?
       WHERE package_id = ? AND revision = ? AND state = 'installed'`,
    )
    .run(current.revision + 1, occurredAt, occurredAt, manifest.packageId, current.revision);
  if (Number(updated.changes) !== 1) {
    throw new StorageError(
      'REVISION_CONFLICT',
      `Plugin installation ${manifest.packageId} changed`,
    );
  }
  const installation = installationForPackage(database, manifest.packageId);
  if (installation === undefined || installation.state !== 'removed') {
    throw corrupt(`Plugin installation ${manifest.packageId} removal vanished`);
  }
  const auditEvent = appendAuditEventInTransaction(database, environment, {
    manifest,
    action: 'removed',
    installationRevision: installation.revision,
    occurredAt,
  });
  return { manifest, installation, auditEvent };
}

function manifestIdentity(manifest: PluginPackageManifestV1): string {
  return `${manifest.packageId}\u0000${manifest.version}`;
}

function queryOutput(
  database: DatabaseSync,
  trustedManifests: readonly PluginPackageManifestV1[],
): PluginPackageQueryOutputV1 {
  const events = auditChain(database);
  const installationByManifest = new Map<string, PluginPackageInstallationV1>();
  const installationRows = database
    .prepare(
      `SELECT package_id, package_version, manifest_hash, state, revision, installed_at, removed_at
       FROM plugin_installations`,
    )
    .all() as unknown as PluginInstallationRow[];
  installationRows.forEach((row) => {
    const installation = installationFromRow(row);
    installationByManifest.set(
      `${installation.packageId}\u0000${installation.version}\u0000${installation.manifestHash}`,
      installation,
    );
  });
  const manifests = new Map<string, PluginPackageManifestV1>();
  packageRows(database).forEach((row) => {
    const manifest = manifestFromRow(row);
    manifests.set(manifestIdentity(manifest), manifest);
  });
  trustedManifests.forEach((manifest) => {
    const existing = manifests.get(manifestIdentity(manifest));
    if (existing !== undefined && canonicalJson(existing) !== canonicalJson(manifest)) {
      throw conflict(
        `Trusted Plugin package ${manifest.packageId}@${manifest.version} conflicts with history`,
      );
    }
    manifests.set(manifestIdentity(manifest), manifest);
  });
  const views: PluginPackageViewV1[] = [...manifests.values()]
    .sort(
      (left, right) =>
        left.packageId.localeCompare(right.packageId) || left.version.localeCompare(right.version),
    )
    .map((manifest) => {
      const identity = `${manifest.packageId}\u0000${manifest.version}\u0000${manifest.manifestHash}`;
      return parseCanonical(PluginPackageViewV1Schema, {
        manifest,
        installation: installationByManifest.get(identity) ?? null,
        auditEvents: events.filter(
          (event) =>
            event.packageId === manifest.packageId &&
            event.version === manifest.version &&
            event.manifestHash === manifest.manifestHash,
        ),
      });
    });
  try {
    return parseCanonical(PluginPackageQueryOutputV1Schema, { packages: views });
  } catch (cause) {
    throw corrupt('Plugin package query result is invalid', cause);
  }
}

function querySuccess(
  request: PluginQueryRequest,
  result: PluginPackageQueryOutputV1,
): PluginQuerySuccess {
  return parseCanonical(WireSuccessV1Schema, {
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method: request.method,
    result,
  }) as PluginQuerySuccess;
}

function applySuccess(
  request: PluginApplyRequest,
  result: ReturnType<typeof installInTransaction> | ReturnType<typeof removeInTransaction>,
): PluginApplySuccess {
  return parseCanonical(WireSuccessV1Schema, {
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method: request.method,
    result: parseCanonical(PluginPackageApplyOutputV1Schema, result),
  }) as PluginApplySuccess;
}

export interface PluginPackagesAuthority {
  query(request: PluginQueryRequest): PluginQuerySuccess;
  apply(request: PluginApplyRequest, context: CommandContext): PluginApplySuccess;
}

export function createPluginPackagesAuthority(
  store: Store,
  options: StorageEnvironmentOptions = {},
  catalog: TrustedPluginCatalogPort = emptyTrustedPluginCatalog,
): PluginPackagesAuthority {
  const environment = resolveStorageEnvironment(options);
  return Object.freeze({
    query(requestValue: PluginQueryRequest) {
      const request = queryRequest(requestValue);
      const manifests = trustedCatalog(catalog);
      const database = getStoreDatabase(store);
      return querySuccess(request, queryOutput(database, manifests));
    },
    apply(requestValue: PluginApplyRequest, contextValue: CommandContext) {
      const request = applyRequest(requestValue);
      const context = parseCanonical(CommandContextSchema, contextValue);
      if (context.actor !== 'user') {
        throw new StorageError('INVALID_REQUEST', 'Only a user may manage Plugin packages');
      }
      const occurredAt = parseCanonical(IsoTimestampSchema, environment.now());
      const database = getStoreDatabase(store);
      if (request.input.action === 'install') {
        const manifest = trustedCatalog(catalog).find(
          (candidate) =>
            candidate.packageId === request.input.packageId &&
            candidate.version === request.input.version &&
            candidate.manifestHash === request.input.manifestHash,
        );
        if (manifest === undefined) {
          throw new StorageError(
            'NOT_FOUND',
            `Trusted Plugin package ${request.input.packageId}@${request.input.version} was not found`,
          );
        }
        return executeWireMutation(
          database,
          request,
          context,
          occurredAt,
          () => {
            syncManifestInTransaction(database, manifest, occurredAt);
            const result = installInTransaction(
              database,
              environment,
              request,
              manifest,
              occurredAt,
            );
            return { projectId: null, response: applySuccess(request, { manifest, ...result }) };
          },
          manifest,
        );
      }
      return executeWireMutation(database, request, context, occurredAt, () => {
        const result = removeInTransaction(database, environment, request, occurredAt);
        return { projectId: null, response: applySuccess(request, result) };
      });
    },
  });
}
