import { z } from 'zod';
import { CapabilityToolDocumentV1Schema, SkillDocumentSchema } from '../capability-catalog.js';
import { strictObject } from '../canonical.js';
import { MessageBlockSchema } from '../conversation.js';
import {
  MemorySourceSchema,
  ProjectMemoryCategorySchema,
  ProjectMemoryItemStateSchema,
  ProjectEventSubjectSchema,
  ProjectEventTypeSchema,
  ProjectHistoryEntryViewSchema,
  ProjectHistorySourceSchema,
  ProjectSearchSourceV1Schema,
} from '../history-memory.js';
import {
  ActorSchema,
  CountAmountSchema,
  CountSchema,
  DomainObjectRefSchema,
  EntityIdSchema,
  IsoTimestampSchema,
  PermissionModeSchema,
  ResourceAmountSchema,
  ResourceBudgetSchema,
  RevisionSchema,
  SequenceSchema,
  Sha256Schema,
} from '../primitives.js';
import { ProjectEnabledSkillsSchema, ProjectFormatPolicySchema } from '../project.js';
import { RunAcceptedSourceSchema, RunStateSchema, SelectedContextRefSchema } from '../run.js';
import {
  MAX_QUERY_LENGTH,
  MAX_REFERENCE_COUNT,
  MAX_TOOL_NAMES,
  PageRequestSchema,
  defineTool,
  pageSchema,
  readMetadata,
  uniqueArray,
} from './common.js';
import { ToolIdSchema } from './ids.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const TIME = '2026-08-15T12:00:00.000Z';

function readPolicy(
  domain: 'discovery' | 'project',
  result: 'none' | 'summary' | 'object_links',
  context: 'none' | 'authority_refs' | 'run_state',
  run: 'current' | 'frozen_snapshot' = 'current',
) {
  return readMetadata({
    domain,
    scope: { project: 'current', run, crossProject: 'denied' },
    cas: { mode: 'none', expectedFields: [] },
    publicProgress: { mode: 'none', redactArguments: true },
    publicResult: { mode: result, redactProviderPayload: true },
    artifactProjection: { mode: 'none', fields: [] },
    contextFactProjection: { mode: context, fields: context === 'none' ? [] : ['items'] },
    variantDiscriminant: null,
    variants: [],
  });
}

export const ToolGetDefinition = defineTool({
  id: 'tool.get',
  version: '2.0.0',
  description: 'Load exact frozen definitions for named tools already present in this Run catalog.',
  metadata: readPolicy('discovery', 'none', 'none', 'frozen_snapshot'),
  inputSchema: strictObject({
    names: uniqueArray(ToolIdSchema, 1, MAX_TOOL_NAMES, 'tool names'),
  }),
  successSchema: strictObject({
    definitions: z.array(CapabilityToolDocumentV1Schema).min(1).max(MAX_TOOL_NAMES),
    catalogHash: Sha256Schema,
  }),
  examples: {
    input: { names: ['project.get'] },
    success: {
      definitions: [
        {
          id: 'project.get',
          version: '2.0.0',
          description:
            'Read selected current Project metadata, policy, capability, permission, and budget sections.',
          metadata: {
            version: '2.0.0',
            description:
              'Read selected current Project metadata, policy, capability, permission, and budget sections.',
            ...readPolicy('project', 'summary', 'authority_refs'),
          },
          metadataHash: HASH_B,
          schemaDigest: HASH_A,
          inputSchema: { canonicalJson: '{}', sha256: HASH_A },
          successSchema: { canonicalJson: '{}', sha256: HASH_B },
          outcomeSchema: { canonicalJson: '{}', sha256: HASH_A },
          examples: { canonicalJson: '{}', sha256: HASH_B },
        },
      ],
      catalogHash: HASH_A,
    },
  },
});

export const SkillLoadDefinition = defineTool({
  id: 'skill.load',
  description: 'Load immutable enabled film-expertise documents from the Run skill snapshot.',
  metadata: readPolicy('discovery', 'summary', 'none', 'frozen_snapshot'),
  inputSchema: strictObject({
    skillIds: uniqueArray(EntityIdSchema, 1, 20, 'skill IDs'),
  }),
  successSchema: strictObject({
    skills: z.array(SkillDocumentSchema).min(1).max(20),
    skillCatalogDigest: Sha256Schema,
  }),
  examples: {
    input: { skillIds: ['skill.continuity'] },
    success: {
      skills: [
        {
          skillId: 'skill.continuity',
          name: 'Continuity review',
          description: 'Review visible continuity evidence.',
          version: '1.0.0',
          contentHash: HASH_A,
          provenance: 'built_in',
          trust: 'trusted',
          content: 'Compare visible production facts and cite every continuity finding.',
          createdAt: TIME,
        },
      ],
      skillCatalogDigest: HASH_B,
    },
  },
});

const ProjectSectionSchema = z.enum([
  'metadata',
  'format_policy',
  'capabilities',
  'permissions',
  'budget',
]);
const PROJECT_SECTION_ORDER = Object.freeze(ProjectSectionSchema.options);
const ProjectSectionsSchema = uniqueArray(
  ProjectSectionSchema,
  1,
  PROJECT_SECTION_ORDER.length,
  'project sections',
).refine(
  (sections) =>
    sections.every(
      (section, index) =>
        index === 0 ||
        PROJECT_SECTION_ORDER.indexOf(sections[index - 1]!) <
          PROJECT_SECTION_ORDER.indexOf(section),
    ),
  { message: 'Project sections must use canonical order' },
);
const ProjectSectionViewSchema = z.union([
  strictObject({
    section: z.literal('metadata'),
    revision: RevisionSchema,
    contentHash: Sha256Schema,
    name: z.string().min(1).max(240),
    lifecycle: z.enum(['active', 'archived', 'deleted']),
  }),
  strictObject({
    section: z.literal('format_policy'),
    revision: RevisionSchema,
    contentHash: Sha256Schema,
    formatPolicy: ProjectFormatPolicySchema,
  }),
  strictObject({
    section: z.literal('capabilities'),
    revision: RevisionSchema,
    contentHash: Sha256Schema,
    defaultProviderProfileId: EntityIdSchema.nullable(),
    enabledSkills: ProjectEnabledSkillsSchema,
  }),
  strictObject({
    section: z.literal('permissions'),
    revision: RevisionSchema,
    contentHash: Sha256Schema,
    mode: PermissionModeSchema,
  }),
  strictObject({
    section: z.literal('budget'),
    revision: RevisionSchema,
    contentHash: Sha256Schema,
    ceiling: ResourceBudgetSchema,
  }),
]);
const ProjectSectionViewsSchema = z
  .array(ProjectSectionViewSchema)
  .min(1)
  .max(PROJECT_SECTION_ORDER.length)
  .refine(
    (sections) =>
      sections.every(
        ({ section }, index) =>
          index === 0 ||
          PROJECT_SECTION_ORDER.indexOf(sections[index - 1]!.section) <
            PROJECT_SECTION_ORDER.indexOf(section),
      ),
    { message: 'Project section views must be unique and use canonical order' },
  );

export const ProjectGetDefinition = defineTool({
  id: 'project.get',
  version: '2.0.0',
  description:
    'Read selected current Project metadata, policy, capability, permission, and budget sections.',
  metadata: readPolicy('project', 'summary', 'authority_refs'),
  inputSchema: strictObject({
    include: ProjectSectionsSchema,
  }),
  successSchema: strictObject({
    sections: ProjectSectionViewsSchema,
  }),
  examples: {
    input: {
      include: ['metadata', 'format_policy', 'capabilities', 'permissions', 'budget'],
    },
    success: {
      sections: [
        {
          section: 'metadata',
          revision: 2,
          contentHash: HASH_A,
          name: 'Short film',
          lifecycle: 'active',
        },
        {
          section: 'format_policy',
          revision: 2,
          contentHash: HASH_B,
          formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
        },
        {
          section: 'capabilities',
          revision: 2,
          contentHash: HASH_B,
          defaultProviderProfileId: null,
          enabledSkills: [{ id: 'skill.continuity', version: '1.0.0' }],
        },
        {
          section: 'permissions',
          revision: 2,
          contentHash: HASH_B,
          mode: 'full',
        },
        {
          section: 'budget',
          revision: 2,
          contentHash: HASH_B,
          ceiling: {
            costUsd: { state: 'known', value: '50', currency: 'USD' },
            maxGenerationCount: 12,
            maxInputTokens: 100_000,
            maxOutputTokens: 20_000,
          },
        },
      ],
    },
  },
});

const RunContextSectionSchema = z.enum([
  'manifest',
  'inputs',
  'selections',
  'attachments',
  'authority_refs',
  'catalogs',
  'permissions',
  'resources',
]);
const RunContextSectionViewSchema = z.union([
  strictObject({
    section: z.literal('manifest'),
    manifestId: EntityIdSchema,
    manifestHash: Sha256Schema,
    acceptedSource: RunAcceptedSourceSchema,
  }),
  strictObject({
    section: z.literal('inputs'),
    messageIds: z.array(EntityIdSchema).max(100),
    messageHashes: z.array(Sha256Schema).max(100),
  }),
  strictObject({
    section: z.literal('selections'),
    refs: z.array(SelectedContextRefSchema).max(MAX_REFERENCE_COUNT),
  }),
  strictObject({
    section: z.literal('attachments'),
    acceptedAttachmentIds: z.array(EntityIdSchema).max(MAX_REFERENCE_COUNT),
  }),
  strictObject({
    section: z.literal('authority_refs'),
    refs: z.array(DomainObjectRefSchema).max(MAX_REFERENCE_COUNT),
  }),
  strictObject({
    section: z.literal('catalogs'),
    capabilityCatalogHash: Sha256Schema,
    skillCatalogDigest: Sha256Schema,
  }),
  strictObject({
    section: z.literal('permissions'),
    mode: PermissionModeSchema,
    canGenerate: z.boolean(),
    canWrite: z.boolean(),
  }),
  strictObject({
    section: z.literal('resources'),
    inputTokens: CountAmountSchema,
    outputTokens: CountAmountSchema,
    cost: ResourceAmountSchema,
  }),
]);

export const RunInspectDefinition = defineTool({
  id: 'run.inspect',
  description:
    'Re-read selected immutable context and resource facts accepted for the current Run.',
  metadata: {
    ...readPolicy('project', 'none', 'run_state'),
    recovery: { mode: 'run_state', unknownStateNeverResubmit: false },
  },
  inputSchema: strictObject({
    include: uniqueArray(RunContextSectionSchema, 1, 8, 'Run context sections'),
  }),
  successSchema: strictObject({
    runState: RunStateSchema,
    sections: z.array(RunContextSectionViewSchema).min(1).max(8),
  }),
  examples: {
    input: { include: ['manifest'] },
    success: {
      runState: 'running',
      sections: [
        {
          section: 'manifest',
          manifestId: 'manifest.1',
          manifestHash: HASH_A,
          acceptedSource: { kind: 'message', messageId: 'message.1', contentHash: HASH_B },
        },
      ],
    },
  },
});

const SearchKindSchema = z.enum([
  'production',
  'project_media_ref',
  'delivery',
  'message',
  'generated_result',
  'result_assessment',
  'review_cut',
  'delivery_export',
]);
const SearchHitSchema = strictObject({
  source: ProjectSearchSourceV1Schema,
  label: z.string().min(1).max(500),
  excerpt: z.string().max(4_000),
  score: z.number().min(0).max(1).finite(),
});

export const ProjectSearchDefinition = defineTool({
  id: 'project.search',
  description:
    'Search bounded Project indexes and return exact revisioned or immutable source references.',
  metadata: readPolicy('project', 'object_links', 'authority_refs'),
  inputSchema: strictObject({
    query: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
    kinds: uniqueArray(SearchKindSchema, 0, 8, 'search kinds'),
    state: z.enum(['current', 'historical', 'any']),
    page: PageRequestSchema,
  }),
  successSchema: pageSchema(SearchHitSchema),
  examples: {
    input: {
      query: 'moonlit location',
      kinds: ['production'],
      state: 'current',
      page: { cursor: null, limit: 20 },
    },
    success: {
      items: [
        {
          source: {
            kind: 'production',
            ref: { authority: 'production', id: 'location.1', revision: 3, contentHash: HASH_A },
          },
          label: 'Moonlit harbor',
          excerpt: 'A quiet harbor under cold blue light.',
          score: 0.92,
        },
      ],
      nextCursor: null,
    },
  },
});

const PublicMessageBaseShape = {
  id: EntityIdSchema,
  sequence: SequenceSchema,
  blocks: z.array(MessageBlockSchema).min(1).max(1_000),
  contentHash: Sha256Schema,
  createdAt: IsoTimestampSchema,
} as const;
const PublicMessageSchema = z.union([
  strictObject({
    ...PublicMessageBaseShape,
    role: z.literal('user'),
    status: z.literal('accepted'),
    originatingRunId: z.null(),
  }),
  strictObject({
    ...PublicMessageBaseShape,
    role: z.literal('assistant'),
    status: z.enum(['completed', 'interrupted']),
    originatingRunId: EntityIdSchema,
  }),
]);

export const ChatQueryDefinition = defineTool({
  id: 'chat.query',
  description: 'Retrieve bounded immutable public Messages from the current Project Chat.',
  metadata: readPolicy('project', 'summary', 'none'),
  inputSchema: strictObject({
    chatId: EntityIdSchema.nullable(),
    beforeSequence: SequenceSchema.nullable(),
    afterSequence: SequenceSchema.nullable(),
    messageIds: uniqueArray(EntityIdSchema, 0, MAX_REFERENCE_COUNT, 'message IDs'),
    page: PageRequestSchema,
  }).refine(
    (query) =>
      query.beforeSequence === null ||
      query.afterSequence === null ||
      query.afterSequence < query.beforeSequence,
    { message: 'afterSequence must precede beforeSequence' },
  ),
  successSchema: pageSchema(PublicMessageSchema),
  examples: {
    input: {
      chatId: null,
      beforeSequence: null,
      afterSequence: null,
      messageIds: ['message.1'],
      page: { cursor: null, limit: 20 },
    },
    success: {
      items: [
        {
          id: 'message.1',
          sequence: 1,
          role: 'user',
          status: 'accepted',
          originatingRunId: null,
          blocks: [{ type: 'text', text: 'Create a moonlit harbor shot.' }],
          contentHash: HASH_A,
          createdAt: TIME,
        },
      ],
      nextCursor: null,
    },
  },
});

const HistoryTimeRangeSchema = strictObject({
  from: IsoTimestampSchema.nullable(),
  to: IsoTimestampSchema.nullable(),
}).refine(
  (range) =>
    range.from === null || range.to === null || Date.parse(range.from) <= Date.parse(range.to),
  { message: 'History time range is reversed' },
);

export const HistoryQueryDefinition = defineTool({
  id: 'history.query',
  description:
    'Read bounded chronological Message, RunEvent, ProjectEvent, GeneratedResult, and UserChoice evidence.',
  metadata: readPolicy('project', 'summary', 'authority_refs'),
  inputSchema: strictObject({
    sources: uniqueArray(ProjectHistorySourceSchema, 0, 5, 'history sources'),
    eventTypes: uniqueArray(ProjectEventTypeSchema, 0, 9, 'event types'),
    subjects: uniqueArray(ProjectEventSubjectSchema, 0, MAX_REFERENCE_COUNT, 'history subjects'),
    actors: uniqueArray(ActorSchema, 0, 4, 'history actors'),
    time: HistoryTimeRangeSchema,
    page: PageRequestSchema,
  }),
  successSchema: pageSchema(ProjectHistoryEntryViewSchema),
  examples: {
    input: {
      sources: ['project_event'],
      eventTypes: ['choice_recorded'],
      subjects: [{ authority: 'generated_result', id: 'result.1' }],
      actors: ['user'],
      time: { from: null, to: null },
      page: { cursor: null, limit: 20 },
    },
    success: {
      items: [
        {
          projectId: 'project.1',
          source: 'project_event',
          eventId: 'event.1',
          sequence: 1,
          eventVersion: 1,
          eventType: 'choice_recorded',
          actor: 'user',
          subject: { authority: 'generated_result', id: 'result.1' },
          causation: { kind: 'message', messageId: 'message.1' },
          correlationId: 'correlation.1',
          payloadHash: HASH_A,
          payloadState: {
            state: 'available',
            payload: { type: 'choice_recorded', choiceId: 'choice.1' },
          },
          previousEventHash: null,
          summary: 'Result selected for shot 1.',
          occurredAt: TIME,
          eventHash: HASH_B,
        },
      ],
      nextCursor: null,
    },
  },
});

const MemoryItemViewSchema = strictObject({
  itemId: EntityIdSchema,
  category: ProjectMemoryCategorySchema,
  text: z.string().min(1).max(100_000),
  state: ProjectMemoryItemStateSchema,
  tentative: z.boolean(),
  sources: z.array(MemorySourceSchema).min(1).max(MAX_REFERENCE_COUNT),
  contentHash: Sha256Schema,
});

const MemoryHeadViewSchema = strictObject({
  memoryVersionId: EntityIdSchema,
  headRevision: RevisionSchema,
  derivationVersion: z.string().min(1).max(80),
  sourceSchemaVersion: z.string().min(1).max(80),
  historyWatermark: CountSchema,
  sourceSetHash: Sha256Schema,
  completeness: z.literal('complete'),
  createdAt: IsoTimestampSchema,
});
const MemoryUnavailableViewSchema = strictObject({
  state: z.literal('unavailable'),
  reason: z.enum(['not_built', 'failed', 'disabled']),
});
const MemoryReadyViewSchema = strictObject({
  state: z.literal('ready'),
  head: MemoryHeadViewSchema,
  activeHistoryWatermark: CountSchema,
  items: z.array(MemoryItemViewSchema).max(100),
}).refine((view) => view.activeHistoryWatermark === view.head.historyWatermark, {
  path: ['activeHistoryWatermark'],
  message: 'Ready Memory must match the active Project History watermark',
});
const MemoryStaleViewSchema = strictObject({
  state: z.literal('stale'),
  head: MemoryHeadViewSchema,
  activeHistoryWatermark: CountSchema,
  items: z.array(MemoryItemViewSchema).max(100),
}).refine((view) => view.activeHistoryWatermark > view.head.historyWatermark, {
  path: ['activeHistoryWatermark'],
  message: 'Stale Memory must trail the active Project History watermark',
});
const MemoryQuerySuccessSchema = z.union([
  MemoryUnavailableViewSchema,
  MemoryReadyViewSchema,
  MemoryStaleViewSchema,
]);

export const MemoryQueryDefinition = defineTool({
  id: 'memory.query',
  description:
    'Retrieve cited Project Memory facts while preserving authority freshness and conflicts.',
  metadata: readPolicy('project', 'summary', 'authority_refs'),
  inputSchema: strictObject({
    query: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
    categories: uniqueArray(ProjectMemoryCategorySchema, 0, 7, 'memory categories'),
    itemKeys: uniqueArray(EntityIdSchema, 0, MAX_REFERENCE_COUNT, 'memory item keys'),
    limit: z.number().int().positive().max(100),
  }),
  successSchema: MemoryQuerySuccessSchema,
  examples: {
    input: {
      query: 'visual direction',
      categories: ['visual_direction'],
      itemKeys: [],
      limit: 20,
    },
    success: {
      state: 'ready',
      head: {
        memoryVersionId: 'memory.1',
        headRevision: 1,
        derivationVersion: 'memory-v1',
        sourceSchemaVersion: 'source-v1',
        historyWatermark: 8,
        sourceSetHash: HASH_A,
        completeness: 'complete',
        createdAt: TIME,
      },
      activeHistoryWatermark: 8,
      items: [
        {
          itemId: 'memory.visual.1',
          category: 'visual_direction',
          text: 'Use cold moonlight and restrained contrast.',
          state: 'current',
          tentative: false,
          sources: [
            {
              kind: 'domain_object',
              ref: {
                authority: 'production',
                id: 'direction.1',
                revision: 2,
                contentHash: HASH_A,
              },
            },
          ],
          contentHash: HASH_B,
        },
      ],
    },
  },
});

export const CONTEXT_TOOL_DEFINITIONS = Object.freeze([
  ToolGetDefinition,
  SkillLoadDefinition,
  ProjectGetDefinition,
  RunInspectDefinition,
  ProjectSearchDefinition,
  ChatQueryDefinition,
  HistoryQueryDefinition,
  MemoryQueryDefinition,
] as const);
