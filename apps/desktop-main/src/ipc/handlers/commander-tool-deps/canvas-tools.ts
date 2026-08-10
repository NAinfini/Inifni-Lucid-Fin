import {
  requireCanvas,
  requireNode,
  touchCanvas,
  createCanvasTools,
  EXCLUDED_TOOLS,
  startCanvasGeneration,
  cancelCanvasGeneration,
  buildGenerationContext,
  randomUUID,
  createEmptyPresetTrackSet,
  getBufferedLogs,
  parseCanvasId,
  parseShotTemplateId,
  commanderUndoDispatchChannel,
  NODE_KINDS,
  BUILT_IN_SHOT_TEMPLATES,
  type ToolRegistrationDeps,
  type RendererPushGateway,
  type BrowserWindow,
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  type CanvasNote,
  type CanvasSettings,
  type PresetTrackSet,
  type ShotTemplate,
  type AgentToolRegistry,
} from './helpers.js';
import { createHash } from 'node:crypto';
import { resolveCanvasVisualStylePolicy } from '@lucid-fin/shared-utils';
import {
  preflightGenerationResolution,
  resolveEffectiveResolutionIntent,
} from '@lucid-fin/adapters-ai';
import type {
  GenerationRequest,
  ImageNodeData,
  ResolutionIntent,
  VideoNodeData,
} from '@lucid-fin/contracts';

export function registerCanvasTools(
  registry: AgentToolRegistry,
  deps: ToolRegistrationDeps,
  getWindow: () => BrowserWindow | null,
  gateway: RendererPushGateway,
  listCommanderPresets: (
    category?: import('@lucid-fin/contracts').PresetCategory,
  ) => Promise<import('@lucid-fin/contracts').PresetDefinition[]>,
  persistCommanderPreset: (
    preset: import('@lucid-fin/contracts').PresetDefinition,
  ) => Promise<import('@lucid-fin/contracts').PresetDefinition>,
  defaultProviders?: Record<string, string>,
): void {
  const canvasGenerationDeps = {
    adapterRegistry: deps.adapterRegistry,
    cas: deps.cas,
    db: deps.db,
    canvasStore: deps.canvasStore,
    keychain: deps.keychain,
    getWindow,
  };

  const canvasToolDeps = {
    getCanvas: async (canvasId: string) => requireCanvas(deps.canvasStore, canvasId),
    deleteCanvas: async (canvasId: string) => {
      requireCanvas(deps.canvasStore, canvasId);
      deps.canvasStore.delete(canvasId);
    },
    addNode: async (canvasId: string, node: CanvasNode) => {
      const current = requireCanvas(deps.canvasStore, canvasId);
      current.nodes.push(node);
      touchCanvas(current, deps.canvasStore);
    },
    moveNode: async (canvasId: string, nodeId: string, position: { x: number; y: number }) => {
      const { canvas: current, node } = requireNode(deps.canvasStore, canvasId, nodeId);
      node.position = position;
      node.updatedAt = Date.now();
      touchCanvas(current, deps.canvasStore);
    },
    renameNode: async (canvasId: string, nodeId: string, title: string) => {
      const { canvas: current, node } = requireNode(deps.canvasStore, canvasId, nodeId);
      node.title = title;
      node.updatedAt = Date.now();
      touchCanvas(current, deps.canvasStore);
    },
    renameCanvas: async (canvasId: string, name: string) => {
      const current = requireCanvas(deps.canvasStore, canvasId);
      current.name = name;
      touchCanvas(current, deps.canvasStore);
    },
    connectNodes: async (canvasId: string, edge: CanvasEdge) => {
      const current = requireCanvas(deps.canvasStore, canvasId);
      current.edges.push(edge);
      touchCanvas(current, deps.canvasStore);
    },
    setNodePresets: async (canvasId: string, nodeId: string, presetTracks: PresetTrackSet) => {
      const { canvas: current, node } = requireNode(deps.canvasStore, canvasId, nodeId);
      if (node.type !== 'image' && node.type !== 'video') {
        throw new Error(`Node type "${node.type}" does not support presets`);
      }
      (
        node.data as {
          presetTracks?: PresetTrackSet;
          appliedShotTemplateId?: string;
          appliedShotTemplateName?: string;
        }
      ).presetTracks = presetTracks ?? createEmptyPresetTrackSet();
      delete (node.data as { appliedShotTemplateId?: string }).appliedShotTemplateId;
      delete (node.data as { appliedShotTemplateName?: string }).appliedShotTemplateName;
      node.updatedAt = Date.now();
      touchCanvas(current, deps.canvasStore);
    },
    layoutNodes: async () => undefined,
    triggerGeneration: async (
      canvasId: string,
      nodeId: string,
      providerId?: string,
      variantCount?: number,
      finalPrompt?: string,
      promptInputMode?: 'base' | 'precompiled',
    ) => {
      await startCanvasGeneration(
        gateway,
        { canvasId, nodeId, providerId, variantCount, finalPrompt, promptInputMode },
        canvasGenerationDeps,
      );
    },
    preparePromptRefinement: async (canvasId: string, nodeId: string, feedback: string) => {
      const { canvas, node } = requireNode(deps.canvasStore, canvasId, nodeId);
      if (node.type !== 'image' && node.type !== 'video') {
        throw new Error('Incremental prompt refinement supports image and video nodes only');
      }
      const data = node.data as {
        assetHash?: string;
        variants?: string[];
        selectedVariantIndex?: number;
      };
      const selectedIndex = Number.isInteger(data.selectedVariantIndex)
        ? Number(data.selectedVariantIndex)
        : 0;
      const sourceAssetHash = data.assetHash ?? data.variants?.[selectedIndex];
      if (!sourceAssetHash) {
        throw new Error('Generate and select an image or video before asking for a refinement');
      }
      const asset = deps.db.repos.assets.findByHash(sourceAssetHash as never);
      const basePrompt = asset?.generationMetadata?.prompt ?? asset?.prompt;
      if (!basePrompt?.trim()) {
        throw new Error(
          'The selected asset has no recorded provider prompt; refusing to reconstruct it from zero',
        );
      }
      const recordedStyle = asset?.generationMetadata?.visualStyle;
      if (recordedStyle?.source === 'visual-constitution') {
        throw new Error(
          'This asset belongs to an approved persistent workflow; use workflow media refinement so the exact Visual Constitution remains authoritative',
        );
      }
      const currentStyle = resolveCanvasVisualStylePolicy(canvas.settings);
      if (
        recordedStyle &&
        currentStyle &&
        currentStyle.provenance.policyHash !== recordedStyle.policyHash
      ) {
        throw new Error(
          'The Canvas visual-style policy changed after this asset was generated; regenerate under the current style before applying an incremental quality comment',
        );
      }
      if (recordedStyle && !currentStyle) {
        throw new Error(
          'The Canvas visual-style policy used by this asset is no longer active; restore it or regenerate before refining',
        );
      }
      if (
        currentStyle &&
        !recordedStyle &&
        currentStyle.policy.summary &&
        !basePrompt.includes(currentStyle.policy.summary)
      ) {
        throw new Error(
          'The selected asset predates the current Canvas visual-style policy; regenerate once under the current style before applying incremental feedback',
        );
      }
      const normalizedFeedback = feedback.trim();
      if (!normalizedFeedback) throw new Error('feedback is required');
      const styleBoundary = currentStyle
        ? `CANVAS VISUAL STYLE REMAINS AUTHORITATIVE (${currentStyle.provenance.policyHash}); apply the feedback without redesigning or restyling unaffected details.`
        : 'PRESERVE THE PRIOR VISUAL LANGUAGE; apply the feedback without redesigning or restyling unaffected details.';
      const prompt = `${basePrompt.trim()}\nUSER QUALITY FEEDBACK (additive): ${normalizedFeedback}\n${styleBoundary}`;
      return {
        sourceAssetHash,
        basePrompt: basePrompt.trim(),
        basePromptHash: createHash('sha256').update(basePrompt.trim(), 'utf8').digest('hex'),
        prompt,
        promptHash: createHash('sha256').update(prompt, 'utf8').digest('hex'),
      };
    },
    cancelGeneration: async (canvasId: string, nodeId: string) => {
      await cancelCanvasGeneration(gateway, { canvasId, nodeId }, canvasGenerationDeps);
    },
    deleteNode: async (canvasId: string, nodeId: string) => {
      const current = requireCanvas(deps.canvasStore, canvasId);
      const idx = current.nodes.findIndex((n) => n.id === nodeId);
      if (idx === -1) throw new Error(`Node not found: ${nodeId}`);
      current.nodes.splice(idx, 1);
      current.edges = current.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
      touchCanvas(current, deps.canvasStore);
    },
    deleteEdge: async (canvasId: string, edgeId: string) => {
      const current = requireCanvas(deps.canvasStore, canvasId);
      const idx = current.edges.findIndex((e) => e.id === edgeId);
      if (idx === -1) throw new Error(`Edge not found: ${edgeId}`);
      current.edges.splice(idx, 1);
      touchCanvas(current, deps.canvasStore);
    },
    updateNodeData: async (canvasId: string, nodeId: string, data: Record<string, unknown>) => {
      const { canvas: current, node } = requireNode(deps.canvasStore, canvasId, nodeId);
      Object.assign(node.data, data);
      node.updatedAt = Date.now();
      touchCanvas(current, deps.canvasStore);
    },
    clearNodeDataFields: async (canvasId: string, nodeId: string, fields: string[]) => {
      const { canvas: current, node } = requireNode(deps.canvasStore, canvasId, nodeId);
      const nodeData = node.data as unknown as Record<string, unknown>;
      for (const field of fields) delete nodeData[field];
      node.updatedAt = Date.now();
      touchCanvas(current, deps.canvasStore);
    },
    preflightResolution: async (canvasId: string, nodeId: string, candidate?: ResolutionIntent) => {
      const { canvas: current, node } = requireNode(deps.canvasStore, canvasId, nodeId);
      if (node.type !== 'image' && node.type !== 'video') {
        throw new Error(`Node "${nodeId}" is not an image or video node`);
      }
      const nodeData = node.data as ImageNodeData | VideoNodeData;
      const videoData = node.type === 'video' ? (nodeData as VideoNodeData) : undefined;
      const providerId =
        nodeData.providerId?.trim() ||
        (node.type === 'video'
          ? current.settings?.videoProviderId
          : current.settings?.imageProviderId) ||
        defaultProviders?.[node.type];
      if (!providerId) {
        throw new Error(`Node "${nodeId}" has no configured ${node.type} provider`);
      }
      const adapter =
        deps.adapterRegistry.resolve?.(providerId, node.type) ??
        deps.adapterRegistry.get(providerId);
      if (!adapter) throw new Error(`Provider adapter not found: ${providerId}`);

      const effective = candidate
        ? { intent: candidate, source: 'node' as const }
        : resolveEffectiveResolutionIntent({
            mediaType: node.type,
            canvasSettings: current.settings,
            nodeData,
          });
      const request: GenerationRequest = {
        type: node.type,
        providerId: adapter.id,
        prompt: nodeData.prompt?.trim() || node.title || 'resolution preflight',
        negativePrompt: nodeData.negativePrompt,
        duration: videoData?.duration,
        quality: videoData?.quality,
        audio: videoData?.audio,
        params: typeof videoData?.fps === 'number' ? { fps: videoData.fps } : undefined,
      };
      return preflightGenerationResolution({
        adapter,
        request,
        intent: effective.intent,
        source: effective.source,
      });
    },
    listPresets: listCommanderPresets,
    savePreset: persistCommanderPreset,
    listShotTemplates: async (): Promise<ShotTemplate[]> => {
      const custom = deps.db.repos.shotTemplates.list().rows;
      return [...BUILT_IN_SHOT_TEMPLATES, ...custom];
    },
    saveShotTemplate: async (template: ShotTemplate): Promise<ShotTemplate> => {
      deps.db.repos.shotTemplates.upsert(template);
      return template;
    },
    deleteShotTemplate: async (templateId: string): Promise<void> => {
      deps.db.repos.shotTemplates.delete(parseShotTemplateId(templateId));
    },
    isProviderKeyConfigured: async (providerId: string) => {
      try {
        const key = await deps.keychain.getKey(providerId);
        return key != null && key.length > 0;
      } catch {
        return false;
      }
    },
    getDefaultProviderId: (group: 'image' | 'video' | 'audio') => defaultProviders?.[group],
    setNodeColorTag: async (canvasId: string, nodeId: string, color: string | undefined) => {
      const { canvas: cur, node } = requireNode(deps.canvasStore, canvasId, nodeId);
      node.colorTag = color;
      node.updatedAt = Date.now();
      touchCanvas(cur, deps.canvasStore);
    },
    toggleSeedLock: async (canvasId: string, nodeId: string) => {
      const { canvas: cur, node } = requireNode(deps.canvasStore, canvasId, nodeId);
      (node.data as { seedLocked?: boolean }).seedLocked = !(node.data as { seedLocked?: boolean })
        .seedLocked;
      node.updatedAt = Date.now();
      touchCanvas(cur, deps.canvasStore);
    },
    selectVariant: async (canvasId: string, nodeId: string, index: number) => {
      const { canvas: cur, node } = requireNode(deps.canvasStore, canvasId, nodeId);
      (node.data as { selectedVariantIndex?: number }).selectedVariantIndex = index;
      node.updatedAt = Date.now();
      touchCanvas(cur, deps.canvasStore);
    },
    estimateCost: async (canvasId: string, nodeIds?: string[]) => {
      const canvas = requireCanvas(deps.canvasStore, canvasId);
      const targets =
        Array.isArray(nodeIds) && nodeIds.length > 0
          ? canvas.nodes.filter((n) => nodeIds.includes(n.id))
          : canvas.nodes.filter(
              (n) =>
                n.type === 'image' ||
                n.type === 'video' ||
                n.type === 'audio' ||
                n.type === 'backdrop',
            );
      let total = 0;
      let currency = 'USD';
      const nodeCosts: Array<{ nodeId: string; estimatedCost: number }> = [];
      const generationDeps = {
        adapterRegistry: deps.adapterRegistry,
        cas: deps.cas,
        db: deps.db,
        canvasStore: deps.canvasStore,
        keychain: deps.keychain,
        getWindow,
      };
      for (const node of targets) {
        try {
          const context = await buildGenerationContext(generationDeps, {
            canvasId,
            nodeId: node.id,
            requestedProviderId: undefined,
            requestedProviderConfig: undefined,
            requestedVariantCount: undefined,
            requestedSeed: undefined,
          });
          const estimate = context.adapter.estimateCost(context.requestBase);
          total += estimate.estimatedCost;
          currency = estimate.currency || currency;
          nodeCosts.push({ nodeId: node.id, estimatedCost: estimate.estimatedCost });
        } catch {
          nodeCosts.push({ nodeId: node.id, estimatedCost: 0 });
        }
      }
      return { totalEstimatedCost: total, currency, nodeCosts };
    },
    previewPrompt: async (canvasId: string, nodeId: string) => {
      const context = await buildGenerationContext(
        {
          adapterRegistry: deps.adapterRegistry,
          cas: deps.cas,
          db: deps.db,
          canvasStore: deps.canvasStore,
          keychain: deps.keychain,
          getWindow,
        },
        {
          canvasId,
          nodeId,
          requestedProviderId: undefined,
          requestedProviderConfig: undefined,
          requestedVariantCount: undefined,
          requestedSeed: undefined,
        },
      );
      return {
        prompt: context.compiled.prompt,
        negativePrompt: context.compiled.negativePrompt,
        segments: context.compiled.segments.map((s) => ({
          source: s.source,
          text: s.text,
          trimmed: s.trimmed,
        })),
        wordCount: context.compiled.wordCount,
        diagnostics: context.compiled.diagnostics.map((d) => ({
          type: d.type,
          severity: d.severity,
          message: d.message,
        })),
        providerId: context.adapter.id,
        mode: context.mode,
      };
    },
    addNote: async (canvasId: string, content: string): Promise<CanvasNote> => {
      const canvas = requireCanvas(deps.canvasStore, canvasId);
      const now = Date.now();
      const note: CanvasNote = {
        id: randomUUID(),
        content,
        createdAt: now,
        updatedAt: now,
      };
      canvas.notes = [...(canvas.notes ?? []), note];
      touchCanvas(canvas, deps.canvasStore);
      return note;
    },
    getRecentLogs: async (level?: string, category?: string, limit?: number) => {
      let entries = getBufferedLogs();
      if (level) entries = entries.filter((e) => e.level === level);
      if (category) entries = entries.filter((e) => e.category === category);
      return entries.slice(-(limit ?? 50)) as unknown as Array<Record<string, unknown>>;
    },
    updateNote: async (canvasId: string, noteId: string, content: string) => {
      const canvas = requireCanvas(deps.canvasStore, canvasId);
      const note = (canvas.notes ?? []).find((n) => n.id === noteId);
      if (!note) throw new Error(`Note not found: ${noteId}`);
      note.content = content;
      note.updatedAt = Date.now();
      touchCanvas(canvas, deps.canvasStore);
    },
    deleteNote: async (canvasId: string, noteId: string) => {
      const canvas = requireCanvas(deps.canvasStore, canvasId);
      const before = (canvas.notes ?? []).length;
      canvas.notes = (canvas.notes ?? []).filter((n) => n.id !== noteId);
      if (canvas.notes.length === before) throw new Error(`Note not found: ${noteId}`);
      touchCanvas(canvas, deps.canvasStore);
    },
    undo: async () => {
      gateway.emit(commanderUndoDispatchChannel, { action: 'undo' });
    },
    redo: async () => {
      gateway.emit(commanderUndoDispatchChannel, { action: 'redo' });
    },
    importWorkflow: async (canvasId: string, json: string): Promise<Canvas> => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch (err) {
        throw new Error(`importWorkflow: invalid JSON — ${(err as Error).message}`, { cause: err });
      }
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('importWorkflow: payload must be a JSON object');
      }
      const incoming = parsed as Record<string, unknown>;
      if (!Array.isArray(incoming.nodes) || !Array.isArray(incoming.edges)) {
        throw new Error('importWorkflow: payload must contain nodes and edges arrays');
      }

      const validNodeKinds = new Set<string>(NODE_KINDS);
      const nodeIds = new Set<string>();
      const now = Date.now();
      const validatedNodes: CanvasNode[] = [];
      for (let i = 0; i < incoming.nodes.length; i++) {
        const raw = incoming.nodes[i];
        if (!raw || typeof raw !== 'object') {
          throw new Error(`importWorkflow: nodes[${i}] is not an object`);
        }
        const n = raw as Record<string, unknown>;
        if (typeof n.id !== 'string' || n.id.length === 0) {
          throw new Error(`importWorkflow: nodes[${i}] missing id`);
        }
        if (nodeIds.has(n.id)) {
          throw new Error(`importWorkflow: duplicate node id "${n.id}"`);
        }
        nodeIds.add(n.id);
        if (typeof n.type !== 'string' || !validNodeKinds.has(n.type)) {
          throw new Error(`importWorkflow: nodes[${i}] has invalid type "${String(n.type)}"`);
        }
        if (!n.position || typeof n.position !== 'object') {
          throw new Error(`importWorkflow: nodes[${i}] missing position`);
        }
        const pos = n.position as Record<string, unknown>;
        if (typeof pos.x !== 'number' || typeof pos.y !== 'number') {
          throw new Error(`importWorkflow: nodes[${i}] position must have numeric x and y`);
        }
        if (typeof n.title !== 'string') {
          throw new Error(`importWorkflow: nodes[${i}] missing title`);
        }
        if (!n.data || typeof n.data !== 'object') {
          throw new Error(`importWorkflow: nodes[${i}] missing data object`);
        }
        validatedNodes.push({
          id: n.id,
          type: n.type as CanvasNode['type'],
          position: { x: pos.x, y: pos.y },
          title: n.title,
          data: n.data as CanvasNode['data'],
          bypassed: typeof n.bypassed === 'boolean' ? n.bypassed : false,
          locked: typeof n.locked === 'boolean' ? n.locked : false,
          colorTag: typeof n.colorTag === 'string' ? n.colorTag : undefined,
          tags: Array.isArray(n.tags)
            ? (n.tags as string[]).filter((t) => typeof t === 'string')
            : undefined,
          groupId: typeof n.groupId === 'string' ? n.groupId : undefined,
          parentId: typeof n.parentId === 'string' ? n.parentId : undefined,
          width: typeof n.width === 'number' ? n.width : undefined,
          height: typeof n.height === 'number' ? n.height : undefined,
          createdAt: typeof n.createdAt === 'number' ? n.createdAt : now,
          updatedAt: typeof n.updatedAt === 'number' ? n.updatedAt : now,
        });
      }

      const validatedEdges: CanvasEdge[] = [];
      for (let i = 0; i < incoming.edges.length; i++) {
        const raw = incoming.edges[i];
        if (!raw || typeof raw !== 'object') {
          throw new Error(`importWorkflow: edges[${i}] is not an object`);
        }
        const e = raw as Record<string, unknown>;
        if (typeof e.id !== 'string' || e.id.length === 0) {
          throw new Error(`importWorkflow: edges[${i}] missing id`);
        }
        if (typeof e.source !== 'string' || !nodeIds.has(e.source)) {
          throw new Error(
            `importWorkflow: edges[${i}] references unknown source "${String(e.source)}"`,
          );
        }
        if (typeof e.target !== 'string' || !nodeIds.has(e.target)) {
          throw new Error(
            `importWorkflow: edges[${i}] references unknown target "${String(e.target)}"`,
          );
        }
        if (e.source === e.target) {
          throw new Error(`importWorkflow: edges[${i}] self-loop not allowed`);
        }
        validatedEdges.push({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: typeof e.sourceHandle === 'string' ? e.sourceHandle : undefined,
          targetHandle: typeof e.targetHandle === 'string' ? e.targetHandle : undefined,
          data: {
            label:
              typeof (e.data as Record<string, unknown> | undefined)?.label === 'string'
                ? ((e.data as Record<string, unknown>).label as string)
                : undefined,
            status: 'idle',
          },
        });
      }

      let validatedViewport: Canvas['viewport'] | undefined;
      if (incoming.viewport && typeof incoming.viewport === 'object') {
        const v = incoming.viewport as Record<string, unknown>;
        if (typeof v.x === 'number' && typeof v.y === 'number' && typeof v.zoom === 'number') {
          validatedViewport = { x: v.x, y: v.y, zoom: v.zoom };
        }
      }

      let validatedNotes: CanvasNote[] | undefined;
      if (Array.isArray(incoming.notes)) {
        validatedNotes = [];
        for (const raw of incoming.notes) {
          if (!raw || typeof raw !== 'object') continue;
          const note = raw as Record<string, unknown>;
          if (typeof note.id !== 'string' || typeof note.content !== 'string') continue;
          validatedNotes.push({
            id: note.id,
            content: note.content,
            createdAt: typeof note.createdAt === 'number' ? note.createdAt : now,
            updatedAt: typeof note.updatedAt === 'number' ? note.updatedAt : now,
          });
        }
      }

      const canvas = requireCanvas(deps.canvasStore, canvasId);
      canvas.nodes = validatedNodes;
      canvas.edges = validatedEdges;
      if (validatedViewport) canvas.viewport = validatedViewport;
      if (validatedNotes) canvas.notes = validatedNotes;
      touchCanvas(canvas, deps.canvasStore);
      return canvas;
    },
    exportWorkflow: async (canvasId: string) => {
      const canvas = requireCanvas(deps.canvasStore, canvasId);
      return JSON.stringify({
        nodes: canvas.nodes,
        edges: canvas.edges,
        viewport: canvas.viewport,
        notes: canvas.notes ?? [],
      });
    },
    getCanvasSettings: async (canvasId: string): Promise<CanvasSettings> => {
      const canvas = requireCanvas(deps.canvasStore, canvasId);
      return canvas.settings ?? {};
    },
    patchCanvasSettings: async (
      canvasId: string,
      patch: CanvasSettings,
    ): Promise<CanvasSettings> => {
      const canvas = requireCanvas(deps.canvasStore, canvasId);
      const brandedId = parseCanvasId(canvasId);
      deps.db.repos.canvases.patchSettings(brandedId, patch);
      const current = canvas.settings ?? {};
      const merged: CanvasSettings = { ...current };
      for (const [rawKey, value] of Object.entries(patch)) {
        const key = rawKey as keyof CanvasSettings;
        if (value === null || value === undefined) {
          delete merged[key];
        } else {
          (merged as Record<string, unknown>)[key] = value;
        }
      }
      if (Object.keys(merged).length === 0) {
        delete canvas.settings;
      } else {
        canvas.settings = merged;
      }
      canvas.updatedAt = Date.now();
      deps.canvasStore.save(canvas);
      return canvas.settings ?? {};
    },
  };

  for (const tool of createCanvasTools(canvasToolDeps)) {
    if (!EXCLUDED_TOOLS.has(tool.name)) registry.register(tool);
  }
}
