import {
  touchCanvas,
  createTextAnalyzeTools,
  createVideoTools,
  createAssetTools,
  createPromptTools,
  createRenderTools,
  EXCLUDED_TOOLS,
  detectScenes,
  extractFrameAtTime,
  randomUUID,
  fs,
  path,
  os,
  type ToolRegistrationDeps,
  type Canvas,
  type CanvasEdge,
  type CanvasNode,
  type AgentToolRegistry,
} from './helpers.js';
import { describeImageAsset } from '../vision.handlers.js';

export function registerMediaTools(
  registry: AgentToolRegistry,
  deps: ToolRegistrationDeps,
  _generateImage: ReturnType<typeof import('./helpers.js').makeGenerateImage>,
): void {
  for (const tool of createTextAnalyzeTools({
    callLLM: async (systemPrompt: string, userText: string) => {
      const adapters = deps.llmRegistry.list();
      for (const adapter of adapters) {
        if (!(await adapter.validate())) continue;
        return await adapter.complete([
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userText },
        ]);
      }
      throw new Error('No configured LLM adapter available for text analyze tools.');
    },
    describeImage: async (assetHash, _assetType, style, providerId) => {
      const prompt = await describeImageAsset(
        deps.visualAnalyzer,
        assetHash,
        style === 'style-analysis' ? 'style-analysis' : 'prompt',
        deps.activeLLMAdapter,
        providerId,
      );
      return { prompt };
    },
    getNodeAssetHash: async (nodeId: string, canvasId?: string) => {
      if (canvasId) {
        const canvas = deps.canvasStore.get(canvasId);
        if (canvas) {
          const node = canvas.nodes.find((n) => n.id === nodeId);
          if (node) {
            const data = node.data as { assetHash?: string };
            return data.assetHash ?? null;
          }
        }
        return null;
      }
      const canvasList = deps.canvasStore.list();
      for (const entry of canvasList) {
        const canvas = deps.canvasStore.get(entry.id);
        if (!canvas) continue;
        const node = canvas.nodes.find((n) => n.id === nodeId);
        if (node) {
          const data = node.data as { assetHash?: string };
          return data.assetHash ?? null;
        }
      }
      return null;
    },
    writeNodeField: async (nodeId: string, field: string, value: string, canvasId?: string) => {
      if (canvasId) {
        const canvas = deps.canvasStore.get(canvasId);
        if (canvas) {
          const node = canvas.nodes.find((n) => n.id === nodeId);
          if (node) {
            const data = node.data as Record<string, unknown>;
            data[field] = value;
            node.updatedAt = Date.now();
            touchCanvas(canvas, deps.canvasStore);
          }
        }
        return;
      }
      const canvasList = deps.canvasStore.list();
      for (const entry of canvasList) {
        const canvas = deps.canvasStore.get(entry.id);
        if (!canvas) continue;
        const node = canvas.nodes.find((n) => n.id === nodeId);
        if (node) {
          const data = node.data as Record<string, unknown>;
          data[field] = value;
          node.updatedAt = Date.now();
          touchCanvas(canvas, deps.canvasStore);
          return;
        }
      }
    },
  })) {
    if (!EXCLUDED_TOOLS.has(tool.name)) registry.register(tool);
  }

  for (const tool of createVideoTools({
    cloneVideo: async (filePath, threshold) => {
      const scenes = await detectScenes(filePath, threshold ?? 0.4);
      if (scenes.length === 0) {
        return { canvasId: '', nodeCount: 0 };
      }
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-video-clone-'));
      try {
        const keyframeHashes: string[] = [];
        for (let i = 0; i < scenes.length; i++) {
          const framePath = path.join(tmpDir, `frame-${i}.png`);
          try {
            await extractFrameAtTime(filePath, scenes[i].time, framePath);
            const { ref } = await deps.cas.importAsset(framePath, 'image');
            keyframeHashes.push(ref.hash);
          } catch {
            keyframeHashes.push('');
          }
        }
        const now = Date.now();
        const canvasId = randomUUID();
        const nodes: CanvasNode[] = [];
        const edges: CanvasEdge[] = [];
        for (let i = 0; i < scenes.length; i++) {
          const nodeId = randomUUID();
          const hash = keyframeHashes[i];
          const prevHash = i > 0 ? keyframeHashes[i - 1] : undefined;
          nodes.push({
            id: nodeId,
            type: 'video',
            position: { x: i * 300, y: 0 },
            title: `Scene ${i + 1}`,
            status: 'idle',
            bypassed: false,
            locked: false,
            data: {
              status: 'empty',
              prompt: '',
              sourceImageHash: hash || undefined,
              firstFrameAssetHash: prevHash || undefined,
              variants: [],
              selectedVariantIndex: 0,
            },
            createdAt: now,
            updatedAt: now,
          } as CanvasNode);
          if (i > 0) {
            edges.push({
              id: randomUUID(),
              source: nodes[i - 1].id,
              target: nodeId,
              data: { status: 'idle' },
            } as CanvasEdge);
          }
        }
        const canvas: Canvas = {
          id: canvasId,
          name: `Video Clone ${new Date().toLocaleDateString()}`,
          nodes,
          edges,
          viewport: { x: 0, y: 0, zoom: 1 },
          notes: [],
          createdAt: now,
          updatedAt: now,
        };
        deps.canvasStore.save(canvas);
        return { canvasId, nodeCount: nodes.length };
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    },
  })) {
    if (!EXCLUDED_TOOLS.has(tool.name)) registry.register(tool);
  }

  for (const tool of createAssetTools({
    importAsset: async (filePath, type) => {
      const { ref, meta } = await deps.cas.importAsset(filePath, type);
      const now = Date.now();
      deps.db.repos.assets.insert({
        hash: ref.hash,
        type,
        format: meta.format,
        originalName: meta.originalName,
        fileSize: meta.fileSize,
        tags: meta.tags ?? [],
        folderId: null,
        createdAt: meta.createdAt ?? now,
      });
      return ref;
    },
    listAssets: async (type, limit) => {
      const result = deps.db.repos.assets.query({ type, limit: limit ?? 100 });
      return result.rows;
    },
  })) {
    if (!EXCLUDED_TOOLS.has(tool.name)) registry.register(tool);
  }

  for (const tool of createPromptTools({
    listPrompts: async () => {
      return deps.promptStore.list().map((row) => ({
        code: row.code,
        name: row.name,
        type: row.type,
        hasCustom: row.customValue !== null,
      }));
    },
    getPrompt: async (code) => {
      const row = deps.promptStore.get(code);
      if (!row) return null;
      return {
        code: row.code,
        name: row.name,
        defaultValue: row.defaultValue,
        customValue: row.customValue,
      };
    },
    setCustomPrompt: async (code, value) => {
      deps.promptStore.setCustom(code, value);
    },
    clearCustomPrompt: async (code) => {
      deps.promptStore.clearCustom(code);
    },
  })) {
    if (!EXCLUDED_TOOLS.has(tool.name)) registry.register(tool);
  }

  for (const tool of createRenderTools({
    startRender: async (input) => {
      const result = await deps.finalExportService.startApproved({
        workflowRunId: input.workflowRunId,
        canvasId: input.canvasId,
        expectedManifestRevision: input.expectedManifestRevision,
        expectedManifestHash: input.expectedManifestHash,
        ...(input.outputPath ? { destinationPath: input.outputPath } : {}),
        ...(input.retry ? { retry: true } : {}),
      });
      return { renderId: result.jobId };
    },
    cancelRender: async (renderId) => {
      deps.finalExportService.cancel(renderId);
    },
    exportBundle: async () => {
      throw new Error(
        'Canvas→NLE bundle export is not yet wired. Use export:nle IPC with an editorial Project payload from the renderer.',
      );
    },
  })) {
    if (!EXCLUDED_TOOLS.has(tool.name)) registry.register(tool);
  }
}
