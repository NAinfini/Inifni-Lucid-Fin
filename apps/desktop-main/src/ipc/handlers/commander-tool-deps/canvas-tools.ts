import {
  requireAuthorizedCanvas,
  requireAuthorizedNode,
  touchCanvas,
  createCanvasTools,
  EXCLUDED_TOOLS,
  buildGenerationEstimateContext,
  resolveGenerationResolutionMediaType,
  randomUUID,
  createEmptyPresetTrackSet,
  getBufferedLogs,
  parseCanvasId,
  parseShotTemplateId,
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
  type ToolRegistry,
} from './helpers.js';
import {
  preflightGenerationResolution,
  resolveEffectiveResolutionIntent,
} from '@lucid-fin/adapters-ai';
import { getCommanderSessionId } from '@lucid-fin/contracts';
import type {
  CanvasPatch,
  GenerationRequest,
  ImageNodeData,
  ResolutionIntent,
  VideoNodeData,
} from '@lucid-fin/contracts';

export function registerCanvasTools(
  registry: ToolRegistry,
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
  const commanderSessionId = deps.commanderContinuation?.sessionId;
  const requireOwnedTaskList = (taskListId: string) => {
    const taskList = deps.taskExecutionEngine.get(taskListId);
    if (
      !commanderSessionId ||
      !taskList ||
      getCommanderSessionId(taskList.metadata) !== commanderSessionId
    ) {
      throw new Error('Task List is not bound to the current Commander session');
    }
    return taskList;
  };
  const canvasToolDeps = {
    getCanvas: async (canvasId: string) => requireAuthorizedCanvas(deps, canvasId),
    patchCanvas: async (canvasId: string, patch: CanvasPatch) => {
      requireAuthorizedCanvas(deps, canvasId);
      deps.canvasStore.patchApply(canvasId, patch);
    },
    deleteCanvas: async (canvasId: string) => {
      requireAuthorizedCanvas(deps, canvasId);
      deps.canvasStore.archive(canvasId);
    },
    addNode: async (canvasId: string, node: CanvasNode) => {
      const current = requireAuthorizedCanvas(deps, canvasId);
      current.nodes.push(node);
      touchCanvas(current, deps.canvasStore);
    },
    moveNode: async (canvasId: string, nodeId: string, position: { x: number; y: number }) => {
      const { canvas: current, node } = requireAuthorizedNode(deps, canvasId, nodeId);
      node.position = position;
      node.updatedAt = Date.now();
      touchCanvas(current, deps.canvasStore);
    },
    renameNode: async (canvasId: string, nodeId: string, title: string) => {
      const { canvas: current, node } = requireAuthorizedNode(deps, canvasId, nodeId);
      node.title = title;
      node.updatedAt = Date.now();
      touchCanvas(current, deps.canvasStore);
    },
    renameCanvas: async (canvasId: string, name: string) => {
      const current = requireAuthorizedCanvas(deps, canvasId);
      current.name = name;
      touchCanvas(current, deps.canvasStore);
    },
    connectNodes: async (canvasId: string, edge: CanvasEdge) => {
      const current = requireAuthorizedCanvas(deps, canvasId);
      current.edges.push(edge);
      touchCanvas(current, deps.canvasStore);
    },
    setNodePresets: async (canvasId: string, nodeId: string, presetTracks: PresetTrackSet) => {
      const { canvas: current, node } = requireAuthorizedNode(deps, canvasId, nodeId);
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
    layoutNodes: async (canvasId: string) => {
      requireAuthorizedCanvas(deps, canvasId);
    },
    prepareMediaTask: async (input: {
      canvasId: string;
      nodeId: string;
      providerId?: string;
      providerConfig?: { baseUrl: string; model: string };
      intent?: string;
      parentAttemptId?: string;
      feedback?: string;
    }) => {
      requireAuthorizedNode(deps, input.canvasId, input.nodeId);
      if (!commanderSessionId) {
        throw new Error('Commander session binding is unavailable for media generation');
      }
      return deps.mediaTaskService.start({
        canvasId: input.canvasId,
        nodeId: input.nodeId,
        commanderSessionId,
        ...(input.providerId ? { providerId: input.providerId } : {}),
        ...(input.providerConfig ? { providerConfig: input.providerConfig } : {}),
        ...(input.intent ? { commanderIntent: input.intent } : {}),
        ...(input.parentAttemptId ? { parentAttemptId: input.parentAttemptId } : {}),
        ...(input.feedback ? { feedback: input.feedback } : {}),
      });
    },
    getMediaTask: async (taskListId: string) => {
      requireOwnedTaskList(taskListId);
      const view = deps.mediaTaskService.get(taskListId);
      requireAuthorizedCanvas(deps, view.canvasId);
      return view;
    },
    getPromptAssembly: async (assemblyId: string) => {
      const assembly = deps.promptAssemblyService.get(assemblyId);
      if (!assembly || !assembly.taskListId) {
        throw new Error('Prompt Assembly is not bound to a Canvas Task List');
      }
      requireAuthorizedNode(deps, assembly.canvasId, assembly.nodeId);
      requireOwnedTaskList(assembly.taskListId);
      return assembly;
    },
    submitMediaPrompt: async (input: {
      taskListId: string;
      assemblyId: string;
      assembly: import('@lucid-fin/contracts').PromptAssemblyOutputV1;
    }) => {
      requireOwnedTaskList(input.taskListId);
      const view = deps.mediaTaskService.get(input.taskListId);
      requireAuthorizedCanvas(deps, view.canvasId);
      if (!deps.activeLLMAdapter) {
        throw new Error('Commander LLM author binding is unavailable for media Prompt Assembly');
      }
      return deps.mediaTaskService.submitPrompt(
        {
          taskListId: input.taskListId,
          promptAssemblyId: input.assemblyId,
          promptAssemblyOutput: input.assembly,
        },
        {
          providerId: deps.activeLLMAdapter.id,
          model: deps.activeLLMAdapter.name,
        },
      );
    },
    cancelMediaTask: async (taskListId: string) => {
      requireOwnedTaskList(taskListId);
      const view = deps.mediaTaskService.get(taskListId);
      requireAuthorizedCanvas(deps, view.canvasId);
      return deps.mediaTaskService.cancel(taskListId);
    },
    retryMediaEvaluation: async (taskListId: string) => {
      requireOwnedTaskList(taskListId);
      const view = deps.mediaTaskService.get(taskListId);
      requireAuthorizedCanvas(deps, view.canvasId);
      if (!commanderSessionId) {
        throw new Error('Commander session binding is unavailable for media generation');
      }
      return deps.mediaTaskService.retryEvaluation(taskListId, commanderSessionId);
    },
    deleteNode: async (canvasId: string, nodeId: string) => {
      const current = requireAuthorizedCanvas(deps, canvasId);
      const idx = current.nodes.findIndex((n) => n.id === nodeId);
      if (idx === -1) throw new Error(`Node not found: ${nodeId}`);
      current.nodes.splice(idx, 1);
      current.edges = current.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
      touchCanvas(current, deps.canvasStore);
    },
    deleteEdge: async (canvasId: string, edgeId: string) => {
      const current = requireAuthorizedCanvas(deps, canvasId);
      const idx = current.edges.findIndex((e) => e.id === edgeId);
      if (idx === -1) throw new Error(`Edge not found: ${edgeId}`);
      current.edges.splice(idx, 1);
      touchCanvas(current, deps.canvasStore);
    },
    updateNodeData: async (canvasId: string, nodeId: string, data: Record<string, unknown>) => {
      const { canvas: current, node } = requireAuthorizedNode(deps, canvasId, nodeId);
      Object.assign(node.data, data);
      node.updatedAt = Date.now();
      touchCanvas(current, deps.canvasStore);
    },
    clearNodeDataFields: async (canvasId: string, nodeId: string, fields: string[]) => {
      const { canvas: current, node } = requireAuthorizedNode(deps, canvasId, nodeId);
      const nodeData = node.data as unknown as Record<string, unknown>;
      for (const field of fields) delete nodeData[field];
      node.updatedAt = Date.now();
      touchCanvas(current, deps.canvasStore);
    },
    preflightResolution: async (canvasId: string, nodeId: string, candidate?: ResolutionIntent) => {
      const { canvas: current, node } = requireAuthorizedNode(deps, canvasId, nodeId);
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
            mediaType: resolveGenerationResolutionMediaType(node, node.type),
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
      const { canvas: cur, node } = requireAuthorizedNode(deps, canvasId, nodeId);
      node.colorTag = color;
      node.updatedAt = Date.now();
      touchCanvas(cur, deps.canvasStore);
    },
    toggleSeedLock: async (canvasId: string, nodeId: string) => {
      const { canvas: cur, node } = requireAuthorizedNode(deps, canvasId, nodeId);
      (node.data as { seedLocked?: boolean }).seedLocked = !(node.data as { seedLocked?: boolean })
        .seedLocked;
      node.updatedAt = Date.now();
      touchCanvas(cur, deps.canvasStore);
    },
    selectVariant: async (canvasId: string, nodeId: string, index: number) => {
      const { canvas: cur, node } = requireAuthorizedNode(deps, canvasId, nodeId);
      (node.data as { selectedVariantIndex?: number }).selectedVariantIndex = index;
      node.updatedAt = Date.now();
      touchCanvas(cur, deps.canvasStore);
    },
    estimateCost: async (canvasId: string, nodeIds?: string[]) => {
      const canvas = requireAuthorizedCanvas(deps, canvasId);
      const requestedNodeIds =
        Array.isArray(nodeIds) && nodeIds.length > 0 ? new Set(nodeIds) : null;
      const targets =
        requestedNodeIds
          ? canvas.nodes.filter((n) => requestedNodeIds.has(n.id))
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
        resolvePresetCatalog: deps.presetCatalog.list,
        promptAssemblyService: deps.promptAssemblyService,
        preferredPromptAssembler: deps.activeLLMAdapter,
        resolveProcessPrompt: deps.resolveProcessPrompt,
      };
      for (const node of targets) {
        const context = await buildGenerationEstimateContext(generationDeps, {
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
      }
      return { totalEstimatedCost: total, currency, nodeCosts };
    },
    addNote: async (canvasId: string, content: string): Promise<CanvasNote> => {
      const canvas = requireAuthorizedCanvas(deps, canvasId);
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
      const canvas = requireAuthorizedCanvas(deps, canvasId);
      const note = (canvas.notes ?? []).find((n) => n.id === noteId);
      if (!note) throw new Error(`Note not found: ${noteId}`);
      note.content = content;
      note.updatedAt = Date.now();
      touchCanvas(canvas, deps.canvasStore);
    },
    deleteNote: async (canvasId: string, noteId: string) => {
      const canvas = requireAuthorizedCanvas(deps, canvasId);
      const before = (canvas.notes ?? []).length;
      canvas.notes = (canvas.notes ?? []).filter((n) => n.id !== noteId);
      if (canvas.notes.length === before) throw new Error(`Note not found: ${noteId}`);
      touchCanvas(canvas, deps.canvasStore);
    },
    importCanvasDocument: async (canvasId: string, json: string): Promise<Canvas> => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch (err) {
        throw new Error(`importCanvasDocument: invalid JSON — ${(err as Error).message}`, {
          cause: err,
        });
      }
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('importCanvasDocument: payload must be a JSON object');
      }
      const incoming = parsed as Record<string, unknown>;
      if (!Array.isArray(incoming.nodes) || !Array.isArray(incoming.edges)) {
        throw new Error('importCanvasDocument: payload must contain nodes and edges arrays');
      }

      const validNodeKinds = new Set<string>(NODE_KINDS);
      const nodeIds = new Set<string>();
      const now = Date.now();
      const validatedNodes: CanvasNode[] = [];
      for (let i = 0; i < incoming.nodes.length; i++) {
        const raw = incoming.nodes[i];
        if (!raw || typeof raw !== 'object') {
          throw new Error(`importCanvasDocument: nodes[${i}] is not an object`);
        }
        const n = raw as Record<string, unknown>;
        if (typeof n.id !== 'string' || n.id.length === 0) {
          throw new Error(`importCanvasDocument: nodes[${i}] missing id`);
        }
        if (nodeIds.has(n.id)) {
          throw new Error(`importCanvasDocument: duplicate node id "${n.id}"`);
        }
        nodeIds.add(n.id);
        if (typeof n.type !== 'string' || !validNodeKinds.has(n.type)) {
          throw new Error(`importCanvasDocument: nodes[${i}] has invalid type "${String(n.type)}"`);
        }
        if (!n.position || typeof n.position !== 'object') {
          throw new Error(`importCanvasDocument: nodes[${i}] missing position`);
        }
        const pos = n.position as Record<string, unknown>;
        if (typeof pos.x !== 'number' || typeof pos.y !== 'number') {
          throw new Error(`importCanvasDocument: nodes[${i}] position must have numeric x and y`);
        }
        if (typeof n.title !== 'string') {
          throw new Error(`importCanvasDocument: nodes[${i}] missing title`);
        }
        if (!n.data || typeof n.data !== 'object') {
          throw new Error(`importCanvasDocument: nodes[${i}] missing data object`);
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
          throw new Error(`importCanvasDocument: edges[${i}] is not an object`);
        }
        const e = raw as Record<string, unknown>;
        if (typeof e.id !== 'string' || e.id.length === 0) {
          throw new Error(`importCanvasDocument: edges[${i}] missing id`);
        }
        if (typeof e.source !== 'string' || !nodeIds.has(e.source)) {
          throw new Error(
            `importCanvasDocument: edges[${i}] references unknown source "${String(e.source)}"`,
          );
        }
        if (typeof e.target !== 'string' || !nodeIds.has(e.target)) {
          throw new Error(
            `importCanvasDocument: edges[${i}] references unknown target "${String(e.target)}"`,
          );
        }
        if (e.source === e.target) {
          throw new Error(`importCanvasDocument: edges[${i}] self-loop not allowed`);
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

      const canvas = requireAuthorizedCanvas(deps, canvasId);
      canvas.nodes = validatedNodes;
      canvas.edges = validatedEdges;
      if (validatedViewport) canvas.viewport = validatedViewport;
      if (validatedNotes) canvas.notes = validatedNotes;
      touchCanvas(canvas, deps.canvasStore);
      return canvas;
    },
    exportCanvasDocument: async (canvasId: string) => {
      const canvas = requireAuthorizedCanvas(deps, canvasId);
      return JSON.stringify({
        nodes: canvas.nodes,
        edges: canvas.edges,
        viewport: canvas.viewport,
        notes: canvas.notes ?? [],
      });
    },
    getCanvasSettings: async (canvasId: string): Promise<CanvasSettings> => {
      const canvas = requireAuthorizedCanvas(deps, canvasId);
      return canvas.settings ?? {};
    },
    patchCanvasSettings: async (
      canvasId: string,
      patch: CanvasSettings,
    ): Promise<CanvasSettings> => {
      const canvas = requireAuthorizedCanvas(deps, canvasId);
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
