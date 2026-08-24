import {
  touchCanvas,
  requireAuthorizedNode,
  createTextAnalyzeTools,
  createAssetTools,
  createPromptTools,
  EXCLUDED_TOOLS,
  type ToolRegistrationDeps,
  type ToolRegistry,
} from './helpers.js';
import { describeImageAsset } from '../vision.handlers.js';

export function registerMediaTools(registry: ToolRegistry, deps: ToolRegistrationDeps): void {
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
      if (!canvasId) throw new Error('canvasId is required to read a node asset');
      const { node } = requireAuthorizedNode(deps, canvasId, nodeId);
      return (node.data as { assetHash?: string }).assetHash ?? null;
    },
    writeNodeField: async (nodeId: string, field: string, value: string, canvasId?: string) => {
      if (!canvasId) throw new Error('canvasId is required to update a node');
      const { canvas, node } = requireAuthorizedNode(deps, canvasId, nodeId);
      (node.data as Record<string, unknown>)[field] = value;
      node.updatedAt = Date.now();
      touchCanvas(canvas, deps.canvasStore);
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

}
