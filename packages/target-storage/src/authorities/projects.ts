import {
  EntityIdSchema,
  ProjectGetDefinition,
  ProjectSchema,
  ProjectSettingsSchema,
  canonicalJson,
  parseCanonical,
  parseRequestV1,
  parseResponseV1,
  type Project,
  type ProjectSettings,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import type { TargetStore } from '../kernel/store.js';
import { TargetStorageError } from '../kernel/errors.js';
import {
  decodeProjectFormatPolicy,
  decodeResourceBudget,
  encodeProjectFormatPolicy,
  encodeResourceBudget,
} from '../internal/canonical-codecs.js';
import { causationColumns, causationFromColumns } from '../internal/causation.js';
import { executeWireMutation, type TargetCommandContext } from '../internal/command.js';
import { decodeCursor, encodeCursor } from '../internal/cursor.js';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import type { TargetStorageEnvironment } from '../internal/environment.js';
import { hashCanonical, hashContentObject } from '../internal/hashes.js';
import { appendProjectEvent } from '../internal/project-events.js';
import { createEmptyCanvas, insertCanvas } from '../internal/canvas-records.js';

const ZERO_HASH = '0'.repeat(64);

function projectCreateEventIdempotencyKey(requestId: string, ordinal: 0 | 1 | 2): string {
  return `project.create.${ordinal}.${hashCanonical(requestId)}`;
}

type ProjectRequest<Method extends WireRequestV1['method']> = Extract<
  WireRequestV1,
  { method: Method }
>;
type ProjectSuccess<Method extends WireSuccessV1['method']> = Extract<
  WireSuccessV1,
  { method: Method }
>;

interface ProjectRow {
  id: string;
  name: string;
  lifecycle: Project['lifecycle'];
  schema_revision: number;
  revision: number;
  content_hash: string;
  created_by_kind: string;
  created_by_id: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
}

interface SettingsRow {
  project_id: string;
  revision: number;
  content_hash: string;
  default_provider_profile_id: string | null;
  format_policy_v1_json: string;
  permission_mode: ProjectSettings['permission'];
  budget_v1_json: string;
  updated_at: string;
}

interface EnabledSkillRow {
  skill_id: string;
  skill_version: string;
}

function storageError(code: 'CORRUPT_DATA' | 'NOT_FOUND' | 'REVISION_CONFLICT', message: string) {
  return new TargetStorageError(code, message);
}

function requestFor<Method extends WireRequestV1['method']>(
  input: ProjectRequest<Method>,
  method: Method,
): ProjectRequest<Method> {
  const request = parseRequestV1(input);
  if (request.method !== method) {
    throw new TargetStorageError('INVALID_REQUEST', `Expected ${method} Wire request`);
  }
  return request as ProjectRequest<Method>;
}

function successFor<Method extends WireSuccessV1['method']>(
  request: ProjectRequest<Method>,
  result: ProjectSuccess<Method>['result'],
): ProjectSuccess<Method> {
  const response = parseResponseV1({
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method: request.method,
    result,
  });
  if (response.kind !== 'success' || response.method !== request.method) {
    throw new TargetStorageError('CORRUPT_DATA', 'Constructed Wire response is invalid');
  }
  return response as ProjectSuccess<Method>;
}

function finalizeProject(value: Omit<Project, 'contentHash'>): Project {
  const normalized = parseCanonical(ProjectSchema, { ...value, contentHash: ZERO_HASH });
  return parseCanonical(ProjectSchema, {
    ...normalized,
    contentHash: hashContentObject(normalized),
  });
}

function finalizeSettings(value: Omit<ProjectSettings, 'contentHash'>): ProjectSettings {
  const normalized = parseCanonical(ProjectSettingsSchema, { ...value, contentHash: ZERO_HASH });
  return parseCanonical(ProjectSettingsSchema, {
    ...normalized,
    contentHash: hashContentObject(normalized),
  });
}

function projectFromRow(row: ProjectRow): Project {
  let project: Project;
  try {
    project = parseCanonical(ProjectSchema, {
      authority: 'project',
      id: row.id,
      name: row.name,
      lifecycle: row.lifecycle,
      schemaRevision: row.schema_revision,
      revision: row.revision,
      contentHash: row.content_hash,
      createdBy: causationFromColumns(row.created_by_kind, row.created_by_id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      archivedAt: row.archived_at,
      deletedAt: row.deleted_at,
    });
  } catch (cause) {
    if (cause instanceof TargetStorageError) throw cause;
    throw new TargetStorageError('CORRUPT_DATA', `Project ${row.id} is invalid`, { cause });
  }
  if (hashContentObject(project) !== project.contentHash) {
    throw storageError('CORRUPT_DATA', `Project ${row.id} content hash does not match`);
  }
  return project;
}

export function getProject(database: DatabaseSync, projectId: string): Project {
  const row = database.prepare('SELECT * FROM projects WHERE id = ?').get(projectId) as unknown as
    ProjectRow | undefined;
  if (row === undefined) throw storageError('NOT_FOUND', `Project ${projectId} was not found`);
  return projectFromRow(row);
}

export function getSettings(database: DatabaseSync, projectId: string): ProjectSettings {
  const row = database
    .prepare('SELECT * FROM project_settings WHERE project_id = ?')
    .get(projectId) as unknown as SettingsRow | undefined;
  if (row === undefined) {
    throw storageError('NOT_FOUND', `Project settings for ${projectId} were not found`);
  }
  const skillRows = database
    .prepare(
      `SELECT skill_id, skill_version
       FROM skill_enablements
       WHERE project_id = ? AND enabled = 1
       ORDER BY skill_id`,
    )
    .all(projectId) as unknown as EnabledSkillRow[];
  let settings: ProjectSettings;
  try {
    settings = parseCanonical(ProjectSettingsSchema, {
      authority: 'project_settings',
      projectId: row.project_id,
      revision: row.revision,
      contentHash: row.content_hash,
      defaultProviderProfileId: row.default_provider_profile_id,
      formatPolicy: decodeProjectFormatPolicy(row.format_policy_v1_json),
      permission: row.permission_mode,
      budget: decodeResourceBudget(row.budget_v1_json),
      enabledSkills: skillRows.map(({ skill_id: id, skill_version: version }) => ({ id, version })),
      updatedAt: row.updated_at,
    });
  } catch (cause) {
    if (cause instanceof TargetStorageError) throw cause;
    throw new TargetStorageError('CORRUPT_DATA', `Project settings ${projectId} are invalid`, {
      cause,
    });
  }
  if (hashContentObject(settings) !== settings.contentHash) {
    throw storageError('CORRUPT_DATA', `Project settings ${projectId} content hash does not match`);
  }
  return settings;
}

export type ProjectToolGetInput = ReturnType<typeof ProjectGetDefinition.parseInput>;
export type ProjectToolGetSuccess = ReturnType<typeof ProjectGetDefinition.parseSuccess>;

function getProjectTool(
  database: DatabaseSync,
  projectIdValue: string,
  inputValue: ProjectToolGetInput,
): ProjectToolGetSuccess {
  const projectId = parseCanonical(EntityIdSchema, projectIdValue);
  const input = ProjectGetDefinition.parseInput(inputValue);
  const project = getProject(database, projectId);
  const settings = getSettings(database, projectId);
  return ProjectGetDefinition.parseSuccess({
    sections: input.include.map((section) => {
      switch (section) {
        case 'metadata':
          return {
            section,
            revision: project.revision,
            contentHash: project.contentHash,
            name: project.name,
            lifecycle: project.lifecycle,
          };
        case 'format_policy':
          return {
            section,
            revision: settings.revision,
            contentHash: settings.contentHash,
            formatPolicy: settings.formatPolicy,
          };
        case 'capabilities':
          return {
            section,
            revision: settings.revision,
            contentHash: settings.contentHash,
            defaultProviderProfileId: settings.defaultProviderProfileId,
            enabledSkills: settings.enabledSkills,
          };
        case 'permissions':
          return {
            section,
            revision: settings.revision,
            contentHash: settings.contentHash,
            mode: settings.permission,
          };
        case 'budget':
          return {
            section,
            revision: settings.revision,
            contentHash: settings.contentHash,
            ceiling: settings.budget,
          };
      }
    }),
  });
}

export type ProjectSettingsValues = Pick<
  ProjectSettings,
  'defaultProviderProfileId' | 'formatPolicy' | 'permission' | 'budget' | 'enabledSkills'
>;

export interface UpdateProjectSettingsInTransactionInput {
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly expectedContentHash: string;
  readonly values: ProjectSettingsValues;
  readonly occurredAt: string;
  readonly eventIdempotencyKey: string;
}

export function updateProjectSettingsInTransaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: UpdateProjectSettingsInTransactionInput,
  context: TargetCommandContext,
): ProjectSettings {
  if (!database.isTransaction) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Project settings update requires an active transaction',
    );
  }
  const current = getSettings(database, input.projectId);
  if (
    current.revision !== input.expectedRevision ||
    current.contentHash !== input.expectedContentHash
  ) {
    throw storageError(
      'REVISION_CONFLICT',
      `Project settings ${current.projectId} revision changed`,
    );
  }
  const currentValues: ProjectSettingsValues = {
    defaultProviderProfileId: current.defaultProviderProfileId,
    formatPolicy: current.formatPolicy,
    permission: current.permission,
    budget: current.budget,
    enabledSkills: current.enabledSkills,
  };
  if (canonicalJson(input.values) === canonicalJson(currentValues)) return current;
  if (
    input.values.defaultProviderProfileId !== null &&
    database
      .prepare('SELECT 1 FROM provider_profiles WHERE id = ?')
      .get(input.values.defaultProviderProfileId) === undefined
  ) {
    throw storageError(
      'NOT_FOUND',
      `Provider profile ${input.values.defaultProviderProfileId} was not found`,
    );
  }
  for (const skill of input.values.enabledSkills) {
    const stored = database
      .prepare(
        `SELECT selected.project_id, selected.trust,
                effective.skill_version AS effective_version,
                quarantine.skill_id AS quarantined_skill_id
         FROM skills AS selected
         LEFT JOIN skill_effective_versions AS effective
           ON effective.skill_id = selected.id
         LEFT JOIN skill_quarantines AS quarantine
           ON quarantine.skill_id = selected.id
          AND quarantine.skill_version = selected.version
         WHERE selected.id = ? AND selected.version = ?`,
      )
      .get(skill.id, skill.version) as unknown as
      | {
          project_id: string | null;
          trust: 'trusted' | 'reviewed' | 'unreviewed';
          effective_version: string | null;
          quarantined_skill_id: string | null;
        }
      | undefined;
    if (stored === undefined) {
      throw storageError('NOT_FOUND', `Skill ${skill.id}@${skill.version} was not found`);
    }
    if (
      (stored.project_id !== null && stored.project_id !== current.projectId) ||
      stored.effective_version !== skill.version ||
      stored.trust === 'unreviewed' ||
      stored.quarantined_skill_id !== null
    ) {
      throw storageError(
        'NOT_FOUND',
        `Skill ${skill.id}@${skill.version} is not eligible for Project ${current.projectId}`,
      );
    }
  }
  const next = finalizeSettings({
    authority: 'project_settings',
    projectId: current.projectId,
    revision: current.revision + 1,
    ...input.values,
    updatedAt: input.occurredAt,
  });
  const result = database
    .prepare(
      `UPDATE project_settings
       SET revision = ?, content_hash = ?, default_provider_profile_id = ?,
           format_policy_v1_json = ?, permission_mode = ?, budget_v1_json = ?, updated_at = ?
       WHERE project_id = ? AND revision = ? AND content_hash = ?`,
    )
    .run(
      next.revision,
      next.contentHash,
      next.defaultProviderProfileId,
      encodeProjectFormatPolicy(next.formatPolicy),
      next.permission,
      encodeResourceBudget(next.budget),
      next.updatedAt,
      current.projectId,
      current.revision,
      current.contentHash,
    );
  if (Number(result.changes) !== 1) {
    throw storageError(
      'REVISION_CONFLICT',
      `Project settings ${current.projectId} revision changed`,
    );
  }
  database.prepare('DELETE FROM skill_enablements WHERE project_id = ?').run(current.projectId);
  const insertSkill = database.prepare(
    `INSERT INTO skill_enablements (
       project_id, skill_id, skill_version, enabled, enabled_at
     ) VALUES (?, ?, ?, 1, ?)`,
  );
  for (const skill of next.enabledSkills) {
    insertSkill.run(current.projectId, skill.id, skill.version, input.occurredAt);
  }
  appendProjectEvent(database, {
    eventId: environment.createId('project_event'),
    projectId: current.projectId,
    occurredAt: input.occurredAt,
    actor: context.actor,
    subject: { authority: 'project_settings', id: current.projectId },
    causation: context.causation,
    correlationId: context.correlationId,
    idempotencyKey: input.eventIdempotencyKey,
    payload: {
      type: 'object_revision_changed',
      beforeRevision: current.revision,
      afterRevision: next.revision,
      beforeHash: current.contentHash,
      afterHash: next.contentHash,
    },
  });
  return next;
}

function updateLifecycleTimestamps(
  current: Project,
  lifecycle: Project['lifecycle'],
  now: string,
): Pick<Project, 'archivedAt' | 'deletedAt'> {
  if (lifecycle === 'active') return { archivedAt: null, deletedAt: null };
  if (lifecycle === 'archived') {
    return {
      archivedAt: current.lifecycle === 'archived' ? current.archivedAt : now,
      deletedAt: null,
    };
  }
  return {
    archivedAt: null,
    deletedAt: current.lifecycle === 'deleted' ? current.deletedAt : now,
  };
}

export interface ProjectsAuthority {
  getTool(projectId: string, input: ProjectToolGetInput): ProjectToolGetSuccess;
  create(
    request: ProjectRequest<'project.create'>,
    context: TargetCommandContext,
  ): ProjectSuccess<'project.create'>;
  update(
    request: ProjectRequest<'project.update'>,
    context: TargetCommandContext,
  ): ProjectSuccess<'project.update'>;
  updateSettings(
    request: ProjectRequest<'project.settings.update'>,
    context: TargetCommandContext,
  ): ProjectSuccess<'project.settings.update'>;
  get(request: ProjectRequest<'project.get'>): ProjectSuccess<'project.get'>;
  getSettings(
    request: ProjectRequest<'project.settings.get'>,
  ): ProjectSuccess<'project.settings.get'>;
  list(request: ProjectRequest<'project.list'>): ProjectSuccess<'project.list'>;
}

export function createProjectsAuthority(
  store: TargetStore,
  environment: TargetStorageEnvironment,
): ProjectsAuthority {
  const database = () => getTargetStoreDatabase(store);

  return Object.freeze({
    getTool(projectId: string, input: ProjectToolGetInput) {
      return getProjectTool(database(), projectId, input);
    },
    create(
      requestInput: ProjectRequest<'project.create'>,
      context: TargetCommandContext,
    ): ProjectSuccess<'project.create'> {
      const request = requestFor(requestInput, 'project.create');
      const now = environment.now();
      return executeWireMutation(database(), request, context, now, () => {
        const projectId = environment.createId('project');
        const project = finalizeProject({
          authority: 'project',
          id: projectId,
          name: request.input.name,
          lifecycle: 'active',
          schemaRevision: 1,
          revision: 0,
          createdBy: context.causation,
          createdAt: now,
          updatedAt: now,
          archivedAt: null,
          deletedAt: null,
        });
        const settings = finalizeSettings({
          authority: 'project_settings',
          projectId,
          revision: 0,
          defaultProviderProfileId: null,
          formatPolicy: request.input.formatPolicy,
          permission: request.input.permissionMode,
          budget: request.input.budget,
          enabledSkills: [],
          updatedAt: now,
        });
        const canvas = createEmptyCanvas(projectId, environment.createId('canvas'), now);
        const [createdByKind, createdById] = causationColumns(project.createdBy);
        database()
          .prepare(
            `INSERT INTO projects (
               id, name, lifecycle, schema_revision, revision, content_hash,
               created_by_kind, created_by_id, created_at, updated_at, archived_at, deleted_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            project.id,
            project.name,
            project.lifecycle,
            project.schemaRevision,
            project.revision,
            project.contentHash,
            createdByKind,
            createdById,
            project.createdAt,
            project.updatedAt,
            project.archivedAt,
            project.deletedAt,
          );
        database()
          .prepare(
            `INSERT INTO project_settings (
               project_id, revision, content_hash, default_provider_profile_id,
               format_policy_v1_json, permission_mode, budget_v1_json, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            settings.projectId,
            settings.revision,
            settings.contentHash,
            settings.defaultProviderProfileId,
            encodeProjectFormatPolicy(settings.formatPolicy),
            settings.permission,
            encodeResourceBudget(settings.budget),
            settings.updatedAt,
          );
        insertCanvas(database(), canvas);
        appendProjectEvent(database(), {
          eventId: environment.createId('project_event'),
          projectId,
          occurredAt: now,
          actor: context.actor,
          subject: { authority: 'project', id: projectId },
          causation: context.causation,
          correlationId: context.correlationId,
          idempotencyKey: projectCreateEventIdempotencyKey(request.requestId, 0),
          payload: {
            type: 'object_created',
            revision: 0,
            contentHash: project.contentHash,
          },
        });
        appendProjectEvent(database(), {
          eventId: environment.createId('project_event'),
          projectId,
          occurredAt: now,
          actor: context.actor,
          subject: { authority: 'project_settings', id: projectId },
          causation: context.causation,
          correlationId: context.correlationId,
          idempotencyKey: projectCreateEventIdempotencyKey(request.requestId, 1),
          payload: {
            type: 'object_created',
            revision: 0,
            contentHash: settings.contentHash,
          },
        });
        appendProjectEvent(database(), {
          eventId: environment.createId('project_event'),
          projectId,
          occurredAt: now,
          actor: context.actor,
          subject: { authority: 'canvas', id: canvas.id },
          causation: context.causation,
          correlationId: context.correlationId,
          idempotencyKey: projectCreateEventIdempotencyKey(request.requestId, 2),
          payload: {
            type: 'object_created',
            revision: 0,
            contentHash: canvas.contentHash,
          },
        });
        return {
          projectId,
          response: successFor(request, { project, settings }),
        };
      });
    },

    update(
      requestInput: ProjectRequest<'project.update'>,
      context: TargetCommandContext,
    ): ProjectSuccess<'project.update'> {
      const request = requestFor(requestInput, 'project.update');
      const now = environment.now();
      return executeWireMutation(database(), request, context, now, () => {
        const current = getProject(database(), request.input.projectId);
        if (current.revision !== request.input.expectedRevision) {
          throw storageError('REVISION_CONFLICT', `Project ${current.id} revision changed`);
        }
        const name = request.input.name ?? current.name;
        const lifecycle = request.input.lifecycle ?? current.lifecycle;
        if (name === current.name && lifecycle === current.lifecycle) {
          return { projectId: current.id, response: successFor(request, current) };
        }
        const next = finalizeProject({
          ...current,
          name,
          lifecycle,
          revision: current.revision + 1,
          updatedAt: now,
          ...updateLifecycleTimestamps(current, lifecycle, now),
        });
        const result = database()
          .prepare(
            `UPDATE projects
             SET name = ?, lifecycle = ?, revision = ?, content_hash = ?, updated_at = ?,
                 archived_at = ?, deleted_at = ?
             WHERE id = ? AND revision = ?`,
          )
          .run(
            next.name,
            next.lifecycle,
            next.revision,
            next.contentHash,
            next.updatedAt,
            next.archivedAt,
            next.deletedAt,
            current.id,
            current.revision,
          );
        if (Number(result.changes) !== 1) {
          throw storageError('REVISION_CONFLICT', `Project ${current.id} revision changed`);
        }
        appendProjectEvent(database(), {
          eventId: environment.createId('project_event'),
          projectId: current.id,
          occurredAt: now,
          actor: context.actor,
          subject: { authority: 'project', id: current.id },
          causation: context.causation,
          correlationId: context.correlationId,
          idempotencyKey: `${request.requestId}:0`,
          payload: {
            type: 'object_revision_changed',
            beforeRevision: current.revision,
            afterRevision: next.revision,
            beforeHash: current.contentHash,
            afterHash: next.contentHash,
          },
        });
        return { projectId: current.id, response: successFor(request, next) };
      });
    },

    updateSettings(
      requestInput: ProjectRequest<'project.settings.update'>,
      context: TargetCommandContext,
    ): ProjectSuccess<'project.settings.update'> {
      const request = requestFor(requestInput, 'project.settings.update');
      const now = environment.now();
      return executeWireMutation(database(), request, context, now, () => {
        const settings = updateProjectSettingsInTransaction(
          database(),
          environment,
          {
            projectId: request.input.projectId,
            expectedRevision: request.input.expectedRevision,
            expectedContentHash: request.input.expectedContentHash,
            values: {
              defaultProviderProfileId: request.input.defaultProviderProfileId,
              formatPolicy: request.input.formatPolicy,
              permission: request.input.permission,
              budget: request.input.budget,
              enabledSkills: request.input.enabledSkills,
            },
            occurredAt: now,
            eventIdempotencyKey: `${request.requestId}:0`,
          },
          context,
        );
        return {
          projectId: settings.projectId,
          response: successFor(request, settings),
        };
      });
    },

    get(requestInput: ProjectRequest<'project.get'>): ProjectSuccess<'project.get'> {
      const request = requestFor(requestInput, 'project.get');
      return successFor(request, getProject(database(), request.input.projectId));
    },

    getSettings(
      requestInput: ProjectRequest<'project.settings.get'>,
    ): ProjectSuccess<'project.settings.get'> {
      const request = requestFor(requestInput, 'project.settings.get');
      return successFor(request, getSettings(database(), request.input.projectId));
    },

    list(requestInput: ProjectRequest<'project.list'>): ProjectSuccess<'project.list'> {
      const request = requestFor(requestInput, 'project.list');
      const afterId = decodeCursor(request.input.cursor, 'project.list');
      const rows = database()
        .prepare(
          `SELECT * FROM projects
           WHERE (? IS NULL OR id > ?)
           ORDER BY id
           LIMIT ?`,
        )
        .all(afterId, afterId, request.input.limit + 1) as unknown as ProjectRow[];
      const hasNext = rows.length > request.input.limit;
      const pageRows = hasNext ? rows.slice(0, request.input.limit) : rows;
      const projects = pageRows.map(projectFromRow);
      return successFor(request, {
        items: projects.map((project) => ({
          id: project.id,
          name: project.name,
          lifecycle: project.lifecycle,
          revision: project.revision,
          contentHash: project.contentHash,
          updatedAt: project.updatedAt,
        })),
        nextCursor:
          hasNext && projects.length > 0 ? encodeCursor('project.list', projects.at(-1)!.id) : null,
      });
    },
  });
}
