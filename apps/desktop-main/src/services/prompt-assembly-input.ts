import {
  computeEffectiveIntensity,
  resolvePromptTemplate,
  type CompiledPrompt,
  type PromptMode,
  type PromptReferenceBinding,
} from '@lucid-fin/application';
import type {
  AIProviderAdapter,
  Canvas,
  CanvasNode,
  GenerationRequest,
  PresetDefinition,
  PresetTrackEntry,
  PresetTrackSet,
  PromptAssemblyInputV1,
  PromptAssemblySource,
} from '@lucid-fin/contracts';
import type { PreparePromptAssemblyInput } from './prompt-assembly.service.js';

interface BuildPromptAssemblyDraftInput {
  canvas: Canvas;
  node: CanvasNode;
  mediaType: 'image' | 'video';
  mode: PromptMode;
  adapter: AIProviderAdapter;
  request: GenerationRequest;
  compiled: CompiledPrompt;
  presetTracks?: PresetTrackSet;
  presetLibrary: PresetDefinition[];
  referenceBindings?: PromptReferenceBinding[];
  nodePrompt?: string;
  nodeNegativePrompt?: string;
  commanderIntent?: string;
  processPrompt?: string;
  authority?: PromptAssemblyInputV1['authority'];
  purpose?: PromptAssemblyInputV1['purpose'];
  parent?: {
    assemblyId?: string;
    finalPrompt: string;
    promptHash: string;
    assetHash?: string;
    userFeedback?: string;
  };
  additionalSources?: Array<Omit<PromptAssemblySource, 'sourceHash'>>;
}

export function buildPromptAssemblyDraft(
  input: BuildPromptAssemblyDraftInput,
): PreparePromptAssemblyInput {
  const sources: Array<Omit<PromptAssemblySource, 'sourceHash'>> = [];
  const usedIds = new Set<string>();
  const addSource = (
    source: Omit<PromptAssemblySource, 'sourceHash' | 'sourceId'> & { sourceId: string },
  ): void => {
    let sourceId = source.sourceId;
    let suffix = 2;
    while (usedIds.has(sourceId)) sourceId = `${source.sourceId}-${suffix++}`;
    usedIds.add(sourceId);
    sources.push({ ...source, sourceId });
  };

  if (input.commanderIntent?.trim()) {
    addSource({
      sourceId: 'user-intent',
      kind: 'user-intent',
      label: 'Current user / Commander intent',
      content: input.commanderIntent.trim(),
      required: true,
    });
  }
  if (input.nodePrompt?.trim()) {
    addSource({
      sourceId: 'node-prompt',
      kind: 'node-prompt',
      label: 'Node prompt',
      content: input.nodePrompt.trim(),
      required: true,
    });
  }
  if (input.nodeNegativePrompt?.trim()) {
    addSource({
      sourceId: 'node-negative-prompt',
      kind: 'negative-constraint',
      label: 'Node negative prompt',
      content: input.nodeNegativePrompt.trim(),
      required: true,
    });
  }

  if (
    input.node.type === 'image' &&
    (input.node.data as { generationPurpose?: string }).generationPurpose === 'reference-image'
  ) {
    addSource({
      sourceId: 'generation-purpose',
      kind: 'task-list-guide',
      label: 'Image generation purpose',
      content:
        'This is an identity reference image for a character, location, or equipment record. Preserve stable identity facts and produce a useful reference-sheet view rather than a story shot.',
      required: true,
      metadata: { generationPurpose: 'reference-image' },
    });
  }

  if (input.parent) {
    addSource({
      sourceId: 'parent-final-prompt',
      kind: 'parent-prompt',
      label: 'Exact final prompt from the selected prior generation',
      content: input.parent.finalPrompt,
      required: true,
      metadata: {
        promptHash: input.parent.promptHash,
        ...(input.parent.assetHash ? { assetHash: input.parent.assetHash } : {}),
      },
    });
    if (input.parent.userFeedback?.trim()) {
      addSource({
        sourceId: 'user-feedback',
        kind: 'user-feedback',
        label: 'Incremental user quality feedback',
        content: input.parent.userFeedback.trim(),
        required: true,
      });
    }
  }

  addResolvedCompilerSources(input.compiled, addSource);
  addPresetSources(input.presetTracks, input.presetLibrary, addSource);

  if (input.authority?.kind === 'task-list-approved') {
    addSource({
      sourceId: 'approved-production-plan',
      kind: 'production-plan',
      label: `Approved Production Plan revision ${input.authority.productionPlan.revision}`,
      content: JSON.stringify(input.authority.productionPlan.content, null, 2),
      required: true,
      metadata: {
        revision: input.authority.productionPlan.revision,
        contentHash: input.authority.productionPlan.contentHash,
      },
    });
    addSource({
      sourceId: 'approved-visual-constitution',
      kind: 'visual-constitution',
      label: `Approved Visual Constitution revision ${input.authority.visualConstitution.revision}`,
      content: JSON.stringify(input.authority.visualConstitution.content, null, 2),
      required: true,
      metadata: {
        revision: input.authority.visualConstitution.revision,
        contentHash: input.authority.visualConstitution.contentHash,
      },
    });
  }

  for (const source of input.additionalSources ?? []) addSource(source);

  const appliedShotTemplate = readAppliedShotTemplate(input.node);
  if (appliedShotTemplate) {
    addSource({
      sourceId: 'shot-template',
      kind: 'shot-template',
      label: 'Applied shot template',
      content: appliedShotTemplate.name ?? appliedShotTemplate.id,
      required: true,
      metadata: appliedShotTemplate,
    });
  }

  if (input.processPrompt?.trim()) {
    addSource({
      sourceId: 'task-list-guide',
      kind: 'task-list-guide',
      label: 'Effective image/video task guidance',
      content: input.processPrompt.trim(),
      required: false,
      metadata: {
        instruction:
          'Use only creative and provider-relevant guidance. Do not copy tool calls or host task-execution mechanics into the provider prompt.',
      },
    });
  }

  const promptLimits = input.adapter.getPromptLimits?.(input.request);
  return {
    canvasId: input.canvas.id,
    nodeId: input.node.id,
    nodeUpdatedAt: input.node.updatedAt,
    mediaType: input.mediaType,
    mode: input.mode as PromptAssemblyInputV1['mode'],
    purpose: input.purpose ?? (input.parent ? 'user_refine' : 'initial'),
    authority: input.authority ?? { kind: 'canvas-draft' },
    sources,
    conditioningManifest: buildConditioningManifest(
      input.compiled,
      input.referenceBindings,
      input.request,
    ),
    providerProfile: {
      providerId: input.adapter.id,
      model: input.adapter.name,
      capabilities: input.adapter.capabilities.map(String),
      ...(promptLimits ? { promptLimits: { ...promptLimits } } : {}),
    },
    hostConstraints: {
      ...(input.request.resolution ? { resolution: input.request.resolution } : {}),
      immutable: [
        'providerId',
        'generation mode',
        'image generation purpose',
        'reference asset hashes and semantic roles',
        'resolved resolution',
        'seed',
        'budget and retry limits',
        'Task List revision hashes and approval state',
      ],
    },
    ...(input.parent?.assemblyId ? { parentAssemblyId: input.parent.assemblyId } : {}),
    ...(input.parent?.assetHash ? { sourceAssetHash: input.parent.assetHash } : {}),
  };
}

function addResolvedCompilerSources(
  compiled: CompiledPrompt,
  addSource: (
    source: Omit<PromptAssemblySource, 'sourceHash' | 'sourceId'> & { sourceId: string },
  ) => void,
): void {
  for (const [index, segment] of compiled.segments.entries()) {
    if (!segment.text.trim()) continue;
    if (segment.source === 'user-text' || segment.source.startsWith('preset:')) continue;
    const kind = classifyCompilerSource(segment.source);
    addSource({
      sourceId: `${sanitizeId(segment.source)}-${index + 1}`,
      kind,
      label: labelCompilerSource(segment.source),
      content: segment.text.trim(),
      required: kind === 'entity' || kind === 'canvas-style' || kind === 'project-style-guide',
      metadata: { compilerSource: segment.source },
    });
  }
  for (const [index, diagnostic] of compiled.diagnostics.entries()) {
    addSource({
      sourceId: `compiler-diagnostic-${index + 1}`,
      kind: 'task-list-guide',
      label: `Prompt-source diagnostic: ${diagnostic.type}`,
      content: diagnostic.message,
      required: false,
      metadata: { severity: diagnostic.severity, source: diagnostic.source },
    });
  }
}

function addPresetSources(
  tracks: PresetTrackSet | undefined,
  library: PresetDefinition[],
  addSource: (
    source: Omit<PromptAssemblySource, 'sourceHash' | 'sourceId'> & { sourceId: string },
  ) => void,
): void {
  if (!tracks) return;
  const byId = new Map(library.map((preset) => [preset.id, preset]));
  for (const [category, track] of Object.entries(tracks)) {
    for (const entry of [...track.entries].sort((a, b) => a.order - b.order)) {
      if (entry.enabled === false) continue;
      const primary = byId.get(entry.presetId);
      if (!primary) continue;
      const secondary = entry.blend ? byId.get(entry.blend.presetIdB) : undefined;
      const primaryParams = resolvePresetParams(primary, entry.params);
      const secondaryParams = secondary
        ? resolvePresetParams(secondary, entry.blend?.paramsB)
        : undefined;
      addSource({
        sourceId: `preset-${sanitizeId(entry.id || entry.presetId)}`,
        kind: 'preset',
        label: `${primary.category} preset: ${primary.name}`,
        content: formatPresetInstruction(primary, primaryParams, secondary, secondaryParams, entry),
        required: true,
        metadata: {
          category,
          presetId: primary.id,
          intensity: computeEffectiveIntensity(track.intensity, entry.intensity),
          params: primaryParams,
          ...(secondary && entry.blend
            ? {
                blend: {
                  presetId: secondary.id,
                  factor: entry.blend.factor,
                  mode: entry.blend.mode ?? 'mix',
                  params: secondaryParams,
                },
              }
            : {}),
        },
      });
      for (const preset of [primary, secondary]) {
        if (!preset?.negativePrompt?.trim()) continue;
        addSource({
          sourceId: `preset-negative-${sanitizeId(entry.id || entry.presetId)}-${sanitizeId(preset.id)}`,
          kind: 'negative-constraint',
          label: `${preset.name} negative constraint`,
          content: preset.negativePrompt.trim(),
          required: true,
        });
      }
    }
  }
}

function resolvePresetParams(
  preset: PresetDefinition,
  overrides: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const templateDefaults = Object.fromEntries(
    (preset.promptParamDefs ?? []).map((definition) => [definition.key, definition.default]),
  );
  return { ...templateDefaults, ...preset.defaults, ...overrides };
}

function formatPresetInstruction(
  primary: PresetDefinition,
  primaryParams: Record<string, unknown>,
  secondary: PresetDefinition | undefined,
  secondaryParams: Record<string, unknown> | undefined,
  entry: PresetTrackEntry,
): string {
  const primaryInstruction = resolvePresetInstruction(primary, primaryParams);
  if (!secondary || !entry.blend) {
    return `${primaryInstruction}\nEffective parameters: ${JSON.stringify(primaryParams)}`;
  }
  const secondaryInstruction = resolvePresetInstruction(secondary, secondaryParams ?? {});
  return [
    `Primary (${primary.name}): ${primaryInstruction}`,
    `Primary parameters: ${JSON.stringify(primaryParams)}`,
    `Blend (${secondary.name}, factor ${entry.blend.factor}, mode ${entry.blend.mode ?? 'mix'}): ${secondaryInstruction}`,
    `Blend parameters: ${JSON.stringify(secondaryParams ?? {})}`,
  ].join('\n');
}

function resolvePresetInstruction(
  preset: PresetDefinition,
  params: Record<string, unknown>,
): string {
  const prompt = preset.prompt.trim();
  const hasExplicitOverride =
    !preset.builtIn ||
    (preset.modified === true && (!preset.defaultPrompt || prompt !== preset.defaultPrompt.trim()));
  if (hasExplicitOverride || !preset.promptTemplate?.trim()) return prompt;
  return resolvePromptTemplate(preset.promptTemplate, preset.promptParamDefs ?? [], params).trim();
}

function buildConditioningManifest(
  compiled: CompiledPrompt,
  referenceBindings: PromptReferenceBinding[] = [],
  request: GenerationRequest,
): PromptAssemblyInputV1['conditioningManifest'] {
  const manifest = new Map<
    string,
    PromptAssemblyInputV1['conditioningManifest'][number]['roles']
  >();
  const addRole = (assetHash: string | undefined, role: string, entityId?: string): void => {
    if (!assetHash) return;
    const roles = manifest.get(assetHash) ?? [];
    if (!roles.some((candidate) => candidate.role === role && candidate.entityId === entityId)) {
      roles.push({ role, ...(entityId ? { entityId } : {}) });
      manifest.set(assetHash, roles);
    }
  };

  for (const assetHash of compiled.referenceImages ?? []) {
    const bindings = referenceBindings.filter((binding) => binding.imageHash === assetHash);
    if (bindings.length === 0) addRole(assetHash, 'generic_reference');
    for (const binding of bindings) {
      addRole(assetHash, binding.entityType, binding.entityId);
    }
  }
  addRole(request.sourceImageHash, 'source_image');
  addRole(request.frameReferenceImages?.first, 'first_frame');
  addRole(request.frameReferenceImages?.last, 'last_frame');

  return [...manifest].map(([assetHash, roles]) => ({ assetHash, roles }));
}

function readAppliedShotTemplate(node: CanvasNode): { id: string; name?: string } | undefined {
  if (node.type !== 'image' && node.type !== 'video') return undefined;
  const data = node.data as { appliedShotTemplateId?: unknown; appliedShotTemplateName?: unknown };
  if (typeof data.appliedShotTemplateId !== 'string' || !data.appliedShotTemplateId.trim()) {
    return undefined;
  }
  return {
    id: data.appliedShotTemplateId.trim(),
    ...(typeof data.appliedShotTemplateName === 'string' && data.appliedShotTemplateName.trim()
      ? { name: data.appliedShotTemplateName.trim() }
      : {}),
  };
}

function classifyCompilerSource(source: string): PromptAssemblySource['kind'] {
  if (/^(character|location|equipment|reference-bindings)/.test(source)) return 'entity';
  if (source === 'connected-text') return 'connected-text';
  if (source === 'visual-style-policy') return 'canvas-style';
  if (source === 'style-guide') return 'project-style-guide';
  return 'task-list-guide';
}

function labelCompilerSource(source: string): string {
  if (source === 'connected-text') return 'Connected script or context text';
  if (source === 'visual-style-policy') return 'Canvas visual-style authority';
  if (source === 'style-guide') return 'Project style guide';
  if (source.startsWith('character:')) return 'Character identity facts';
  if (source.startsWith('location:')) return 'Location facts';
  if (source.startsWith('equipment:')) return 'Equipment facts';
  if (source === 'reference-bindings') return 'Reference-image identity roles';
  return source;
}

function sanitizeId(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'source'
  );
}
