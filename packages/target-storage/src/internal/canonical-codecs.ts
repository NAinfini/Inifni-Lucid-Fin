import {
  MessageBlockSchema,
  MediaSourceSchema,
  MediaTechnicalFactsSchema,
  ProjectEventPayloadSchema,
  ProjectFormatPolicySchema,
  ProjectMediaRoleSchema,
  ProjectSearchSourceV1Schema,
  ProductionTypedContentSchema,
  ProtectedFieldRefSchema,
  CanvasGeometrySchema,
  CanvasViewportSchema,
  ResourceBudgetSchema,
  CapabilityCatalogSnapshotV1Schema,
  CausationRefSchema,
  ContextManifestSchema,
  ModelSurfaceRunEventPayloadSchema,
  PublicRunEventPayloadSchema,
  RunAcceptedSourceSchema,
  SelectedContextRefSchema,
  WireSuccessV1Schema,
  canonicalJson,
  parseCanonical,
  z,
  type MessageBlock,
  type MediaTechnicalFacts,
  type ProjectEventPayload,
  type ProjectFormatPolicy,
  type ProjectMediaRole,
  type ProjectSearchSourceV1,
  type ProductionObject,
  type ProtectedFieldRef,
  type CanvasDocument,
  type ResourceBudget,
  type CapabilityCatalogSnapshotV1,
  type CausationRef,
  type ContextManifest,
  type RunAcceptedSource,
  type WireSuccessV1,
} from '@lucid-fin/target-contracts';
import { TargetStorageError } from '../kernel/errors.js';

type SelectedContextRef = z.output<typeof SelectedContextRefSchema>;
type PublicRunEventPayload = z.output<typeof PublicRunEventPayloadSchema>;
type ModelSurfaceRunEventPayload = z.output<typeof ModelSurfaceRunEventPayloadSchema>;

const MessageBlocksSchema = z.array(MessageBlockSchema).min(1).max(1_000);
const ProjectMediaCollectionsSchema = z.array(z.string().trim().min(1).max(120)).max(100);
const ProjectMediaRolesSchema = z.array(ProjectMediaRoleSchema).min(1).max(20);
const GlobalMediaTagsSchema = z.array(z.string().trim().min(1).max(80)).max(100);
const SelectedContextRefsSchema = z.array(SelectedContextRefSchema).max(1_000);

function decodeJson(label: string, json: string): unknown {
  try {
    return JSON.parse(json) as unknown;
  } catch (cause) {
    throw new TargetStorageError('CORRUPT_DATA', `${label} is not valid JSON`, { cause });
  }
}

export function encodeWireSuccess(response: WireSuccessV1): string {
  return canonicalJson(parseCanonical(WireSuccessV1Schema, response));
}

export function decodeWireSuccess(json: string): WireSuccessV1 {
  try {
    return parseCanonical(
      WireSuccessV1Schema,
      decodeJson('Wire success receipt', json),
    ) as WireSuccessV1;
  } catch (cause) {
    if (cause instanceof TargetStorageError) throw cause;
    throw new TargetStorageError('CORRUPT_DATA', 'Wire success receipt is invalid', { cause });
  }
}

export function encodeProjectEventPayload(payload: ProjectEventPayload): string {
  return canonicalJson(parseCanonical(ProjectEventPayloadSchema, payload));
}

export function decodeProjectEventPayload(json: string): ProjectEventPayload {
  try {
    return parseCanonical(ProjectEventPayloadSchema, decodeJson('ProjectEvent payload', json));
  } catch (cause) {
    if (cause instanceof TargetStorageError) throw cause;
    throw new TargetStorageError('CORRUPT_DATA', 'ProjectEvent payload is invalid', { cause });
  }
}

function decodePersisted<Output>(
  label: string,
  json: string,
  parse: (value: unknown) => Output,
): Output {
  try {
    return parse(decodeJson(label, json));
  } catch (cause) {
    if (cause instanceof TargetStorageError) throw cause;
    throw new TargetStorageError('CORRUPT_DATA', `${label} is invalid`, { cause });
  }
}

export function encodeCanonicalRecord<Schema extends z.ZodType>(
  schema: Schema,
  value: z.input<Schema>,
): string {
  return canonicalJson(parseCanonical(schema, value));
}

export function decodeCanonicalRecord<Schema extends z.ZodType>(
  label: string,
  schema: Schema,
  json: string,
): z.output<Schema> {
  const value = decodePersisted(label, json, (input) => parseCanonical(schema, input));
  if (canonicalJson(value) !== json) {
    throw new TargetStorageError('CORRUPT_DATA', `${label} is not canonical`);
  }
  return value;
}

export function encodeProjectFormatPolicy(value: ProjectFormatPolicy): string {
  return canonicalJson(parseCanonical(ProjectFormatPolicySchema, value));
}

export function decodeProjectFormatPolicy(json: string): ProjectFormatPolicy {
  return decodePersisted('Project format policy', json, (value) =>
    parseCanonical(ProjectFormatPolicySchema, value),
  );
}

export function encodeResourceBudget(value: ResourceBudget): string {
  return canonicalJson(parseCanonical(ResourceBudgetSchema, value));
}

export function decodeResourceBudget(json: string): ResourceBudget {
  return decodePersisted('Project resource budget', json, (value) =>
    parseCanonical(ResourceBudgetSchema, value),
  );
}

export function encodeCapabilityCatalogSnapshot(value: CapabilityCatalogSnapshotV1): string {
  return canonicalJson(parseCanonical(CapabilityCatalogSnapshotV1Schema, value));
}

export function decodeCapabilityCatalogSnapshot(json: string): CapabilityCatalogSnapshotV1 {
  return decodePersisted('Capability catalog snapshot', json, (value) =>
    parseCanonical(CapabilityCatalogSnapshotV1Schema, value),
  );
}

export function encodeContextManifest(value: ContextManifest): string {
  return canonicalJson(parseCanonical(ContextManifestSchema, value));
}

export function decodeContextManifest(json: string): ContextManifest {
  return decodePersisted('Context Manifest', json, (value) =>
    parseCanonical(ContextManifestSchema, value),
  );
}

export function encodeRunAcceptedSource(value: RunAcceptedSource): string {
  return canonicalJson(parseCanonical(RunAcceptedSourceSchema, value));
}

export function decodeRunAcceptedSource(json: string): RunAcceptedSource {
  return decodePersisted('Run accepted source', json, (value) =>
    parseCanonical(RunAcceptedSourceSchema, value),
  );
}

export function encodeSelectedContextRefs(value: readonly SelectedContextRef[]): string {
  return canonicalJson(parseCanonical(SelectedContextRefsSchema, value));
}

export function decodeSelectedContextRefs(json: string): SelectedContextRef[] {
  return decodePersisted('Selected context references', json, (value) =>
    parseCanonical(SelectedContextRefsSchema, value),
  );
}

export function encodeCausationRef(value: CausationRef): string {
  return canonicalJson(parseCanonical(CausationRefSchema, value));
}

export function decodeCausationRef(json: string): CausationRef {
  return decodePersisted('RunEvent causation', json, (value) =>
    parseCanonical(CausationRefSchema, value),
  );
}

export function encodeRunEventPayload(visibility: 'public', value: PublicRunEventPayload): string;
export function encodeRunEventPayload(
  visibility: 'model_surface',
  value: ModelSurfaceRunEventPayload,
): string;
export function encodeRunEventPayload(
  visibility: 'public' | 'model_surface',
  value: PublicRunEventPayload | ModelSurfaceRunEventPayload,
): string {
  return canonicalJson(
    visibility === 'public'
      ? parseCanonical(PublicRunEventPayloadSchema, value)
      : parseCanonical(ModelSurfaceRunEventPayloadSchema, value),
  );
}

export function decodePublicRunEventPayload(json: string): PublicRunEventPayload {
  return decodePersisted('Public RunEvent payload', json, (value) =>
    parseCanonical(PublicRunEventPayloadSchema, value),
  );
}

export function decodeModelSurfaceRunEventPayload(json: string): ModelSurfaceRunEventPayload {
  return decodePersisted('Model-surface RunEvent payload', json, (value) =>
    parseCanonical(ModelSurfaceRunEventPayloadSchema, value),
  );
}

export function encodeMessageBlocks(blocks: readonly MessageBlock[]): string {
  return canonicalJson(parseCanonical(MessageBlocksSchema, blocks));
}

export function decodeMessageBlocks(json: string): MessageBlock[] {
  return decodePersisted('Message blocks', json, (value) =>
    parseCanonical(MessageBlocksSchema, value),
  );
}

export function encodeProjectMediaCollections(collections: readonly string[]): string {
  return canonicalJson(parseCanonical(ProjectMediaCollectionsSchema, collections));
}

export function decodeProjectMediaCollections(json: string): string[] {
  return decodePersisted('Project Media collections', json, (value) =>
    parseCanonical(ProjectMediaCollectionsSchema, value),
  );
}

export function encodeProjectMediaRoles(roles: readonly ProjectMediaRole[]): string {
  return canonicalJson(parseCanonical(ProjectMediaRolesSchema, roles));
}

export function decodeProjectMediaRoles(json: string): ProjectMediaRole[] {
  return decodePersisted('Project Media roles', json, (value) =>
    parseCanonical(ProjectMediaRolesSchema, value),
  );
}

export function encodeProjectSearchSource(source: ProjectSearchSourceV1): string {
  return canonicalJson(parseCanonical(ProjectSearchSourceV1Schema, source));
}

export function decodeProjectSearchSource(json: string): ProjectSearchSourceV1 {
  return decodePersisted('Project search source', json, (value) =>
    parseCanonical(ProjectSearchSourceV1Schema, value),
  );
}

export function encodeMediaTechnicalFacts(value: MediaTechnicalFacts): string {
  return canonicalJson(parseCanonical(MediaTechnicalFactsSchema, value));
}

export function decodeMediaTechnicalFacts(json: string): MediaTechnicalFacts {
  return decodePersisted('Media technical facts', json, (value) =>
    parseCanonical(MediaTechnicalFactsSchema, value),
  );
}

export function encodeMediaSource(value: z.output<typeof MediaSourceSchema>): string {
  return canonicalJson(parseCanonical(MediaSourceSchema, value));
}

export function decodeMediaSource(json: string): z.output<typeof MediaSourceSchema> {
  return decodePersisted('Global Media source', json, (value) =>
    parseCanonical(MediaSourceSchema, value),
  );
}

export function encodeGlobalMediaTags(value: readonly string[]): string {
  return canonicalJson(parseCanonical(GlobalMediaTagsSchema, value));
}

export function decodeGlobalMediaTags(json: string): string[] {
  return decodePersisted('Global Media tags', json, (value) =>
    parseCanonical(GlobalMediaTagsSchema, value),
  );
}

export function encodeProductionContent(
  objectType: ProductionObject['type'],
  content: ProductionObject['content'],
): string {
  return canonicalJson(
    parseCanonical(ProductionTypedContentSchema, { objectType, content }).content,
  );
}

export function decodeProductionContent(
  objectType: ProductionObject['type'],
  json: string,
): ProductionObject['content'] {
  return decodePersisted(
    'Production content',
    json,
    (content) => parseCanonical(ProductionTypedContentSchema, { objectType, content }).content,
  );
}

export function encodeProtectedFieldRef(value: ProtectedFieldRef): string {
  return canonicalJson(parseCanonical(ProtectedFieldRefSchema, value));
}

export function decodeProtectedFieldRef(json: string): ProtectedFieldRef {
  return decodePersisted('Protected field reference', json, (value) =>
    parseCanonical(ProtectedFieldRefSchema, value),
  );
}

export function encodeCanvasViewport(value: CanvasDocument['viewport']): string {
  return canonicalJson(parseCanonical(CanvasViewportSchema, value));
}

export function decodeCanvasViewport(json: string): CanvasDocument['viewport'] {
  return decodePersisted('Canvas viewport', json, (value) =>
    parseCanonical(CanvasViewportSchema, value),
  );
}

export function encodeCanvasGeometry(
  value: CanvasDocument['annotations'][number]['geometry'],
): string | null {
  return value === null ? null : canonicalJson(parseCanonical(CanvasGeometrySchema, value));
}

export function decodeCanvasGeometry(
  json: string | null,
): CanvasDocument['annotations'][number]['geometry'] {
  return json === null
    ? null
    : decodePersisted('Canvas annotation geometry', json, (value) =>
        parseCanonical(CanvasGeometrySchema, value),
      );
}
