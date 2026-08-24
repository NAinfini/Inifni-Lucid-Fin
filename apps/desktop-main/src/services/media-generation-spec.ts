import { createHash } from 'node:crypto';
import type {
  Canvas,
  CanvasNode,
  GenerationRequest,
  ProductionMediaAuthority,
  ProductionMediaGenerationSpec,
  ProductionMediaLineage,
  ProductionMediaReferenceEvidence,
  ProductionMediaScope,
  PromptAssemblyRecord,
  Task,
} from '@lucid-fin/contracts';
import type { BuiltGenerationContext } from '../ipc/handlers/generation-types.js';

export function buildMediaGenerationSpec(input: {
  scope: ProductionMediaScope;
  authority: ProductionMediaAuthority;
  taskListId: string;
  task: Task;
  canvas: Canvas;
  node: CanvasNode;
  context: BuiltGenerationContext;
  request: GenerationRequest;
  promptAssembly: PromptAssemblyRecord;
  limits: ProductionMediaGenerationSpec['limits'];
  lineage: ProductionMediaLineage;
  createdAt: number;
}): ProductionMediaGenerationSpec {
  const mediaType = input.context.generationType;
  if (mediaType !== 'image' && mediaType !== 'video') {
    throw new Error('Media Generation Spec supports only image and video requests');
  }
  if (!input.promptAssembly.output) {
    throw new Error('Media Generation Spec requires an assembled Prompt Assembly');
  }
  const prompt = input.promptAssembly.output.finalPrompt;
  const negativePrompt = input.promptAssembly.output.negativePrompt;
  if (input.request.prompt !== prompt || input.request.negativePrompt !== negativePrompt) {
    throw new Error('Generation request does not exactly match its Prompt Assembly');
  }
  const taskRole = requiredString(input.task.input.taskRole, 'taskRole');
  const modelId =
    input.promptAssembly.input.providerProfile.model ?? input.context.adapter.id;
  return {
    specVersion: 3,
    scope: input.scope,
    authority: input.authority,
    taskListId: input.taskListId,
    taskId: input.task.id,
    canvasId: input.canvas.id,
    canvasUpdatedAt: input.canvas.updatedAt,
    nodeId: input.node.id,
    nodeUpdatedAt: input.node.updatedAt,
    task: {
      id: input.task.id,
      key: input.task.taskKey,
      role: taskRole,
      ...(optionalString(asRecord(input.task.input.shot).id)
        ? { shotId: optionalString(asRecord(input.task.input.shot).id) }
        : {}),
    },
    mediaType,
    operation: requireMediaOperation(input.context.mode),
    providerId: input.context.adapter.id,
    modelId,
    promptAssemblyId: input.promptAssembly.id,
    prompt,
    promptHash: sha256(prompt),
    ...(negativePrompt !== undefined ? { negativePrompt } : {}),
    referenceEvidence: buildReferenceEvidence(input.context, input.request),
    request: cloneGenerationRequest(input.request),
    limits: { ...input.limits },
    lineage: { ...input.lineage },
    createdAt: input.createdAt,
  };
}

export function buildReferenceEvidence(
  context: BuiltGenerationContext,
  request: GenerationRequest,
): ProductionMediaReferenceEvidence[] {
  type Role = ProductionMediaReferenceEvidence['roles'][number];
  const rolesByHash = new Map<string, Role[]>();
  const addRole = (assetHash: string | undefined, role: Role): void => {
    if (!assetHash) return;
    const roles = rolesByHash.get(assetHash) ?? [];
    if (!roles.some((candidate) => JSON.stringify(candidate) === JSON.stringify(role))) {
      roles.push(role);
      rolesByHash.set(assetHash, roles);
    }
  };
  const addEntityRoles = (
    refs: Array<{ entityId: string; imageHashes: string[] }> | undefined,
    role: 'character' | 'equipment' | 'location',
  ): void => {
    for (const ref of refs ?? []) {
      for (const assetHash of ref.imageHashes) addRole(assetHash, { role, entityId: ref.entityId });
    }
  };

  addEntityRoles(context.resolvedEntityRefs.characterRefs, 'character');
  addEntityRoles(context.resolvedEntityRefs.equipmentRefs, 'equipment');
  addEntityRoles(context.resolvedEntityRefs.locationRefs, 'location');
  addRole(request.sourceImageHash, { role: 'source_image' });
  addRole(request.frameReferenceImages?.first, { role: 'first_frame' });
  addRole(request.frameReferenceImages?.last, { role: 'last_frame' });
  for (const assetHash of request.referenceImages ?? []) {
    if (!rolesByHash.has(assetHash)) addRole(assetHash, { role: 'generic_reference' });
  }

  const ordered =
    request.type === 'video'
      ? [
          request.frameReferenceImages?.first,
          request.sourceImageHash,
          ...(request.referenceImages ?? []),
          request.frameReferenceImages?.last,
        ]
      : [request.sourceImageHash, ...(request.referenceImages ?? [])];
  const seen = new Set<string>();
  const evidence: ProductionMediaReferenceEvidence[] = [];
  for (const assetHash of ordered) {
    if (!assetHash || seen.has(assetHash)) continue;
    seen.add(assetHash);
    evidence.push({
      order: evidence.length,
      assetHash,
      roles: rolesByHash.get(assetHash) ?? [{ role: 'generic_reference' }],
    });
  }
  return evidence;
}

function cloneGenerationRequest(request: GenerationRequest): GenerationRequest {
  return {
    ...request,
    ...(request.referenceImages ? { referenceImages: [...request.referenceImages] } : {}),
    ...(request.frameReferenceImages
      ? { frameReferenceImages: { ...request.frameReferenceImages } }
      : {}),
    ...(request.params ? { params: { ...request.params } } : {}),
    ...(request.resolution ? { resolution: structuredClone(request.resolution) } : {}),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function requiredString(value: unknown, name: string): string {
  const normalized = optionalString(value);
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requireMediaOperation(
  mode: BuiltGenerationContext['mode'],
): ProductionMediaGenerationSpec['operation'] {
  if (
    mode !== 'text-to-image' &&
    mode !== 'image-to-image' &&
    mode !== 'text-to-video' &&
    mode !== 'image-to-video'
  ) {
    throw new Error(`Unsupported image/video prompt mode: ${mode}`);
  }
  return mode;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
