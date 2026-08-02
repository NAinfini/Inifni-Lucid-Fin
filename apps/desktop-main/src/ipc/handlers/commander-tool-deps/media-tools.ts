import {
  touchCanvas,
  createTextAnalyzeTools,
  createVideoTools,
  createAssetTools,
  createPromptTools,
  createRenderTools,
  EXCLUDED_TOOLS,
  getCachedProviders,
  buildRuntimeLLMAdapter,
  normalizeLLMProviderRuntimeConfig,
  getBuiltinVisionProviderPreset,
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

export function registerMediaTools(
  registry: AgentToolRegistry,
  deps: ToolRegistrationDeps,
  _generateImage: ReturnType<typeof import('./helpers.js').makeGenerateImage>,
): void {
  const IMAGE_EXTENSIONS_VISION = ['png', 'jpg', 'jpeg', 'webp'] as const;
  const MIME_MAP_VISION: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
  };
  const VISION_PROMPT_DEFAULT =
    'You are an expert at describing images for AI generation. Analyze this image and write a detailed prompt that could be used to recreate it with an AI image generator.\n\nInclude: subject/scene description, art style, lighting quality and direction, color palette, mood/atmosphere, camera angle/lens, composition, texture/material details, and any notable cinematic or photographic techniques.\n\nOutput ONLY the prompt text, no explanations or labels. Write in English.';
  const VISION_PROMPT_STYLE_ANALYSIS =
    'You are a visual style analyst for AI filmmaking. Analyze this image and extract its visual style characteristics.\n\nReport in this exact format:\nArt Style: [style name]\nLighting: [lighting description]\nColor Palette: [primary colors and mood]\nMood: [emotional atmosphere]\nComposition: [framing and arrangement]\nCamera: [angle, lens, movement if applicable]\nTexture: [surface quality, grain, post-processing]\nReference: [closest cinematic/artistic reference]\n\nBe specific and technical. Output ONLY the analysis, no explanations.';

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
      const visionProviders = getCachedProviders('vision');
      const providerInfo = providerId
        ? (visionProviders.find((p) => p.id === providerId) ?? visionProviders[0])
        : visionProviders[0];
      if (!providerInfo?.id) {
        throw new Error('Vision provider not configured. Go to Settings → Vision.');
      }
      const apiKey = await deps.keychain.getKey(providerInfo.id);
      const preset = getBuiltinVisionProviderPreset(providerInfo.id);
      const runtimeConfig = normalizeLLMProviderRuntimeConfig({
        id: providerInfo.id,
        name: providerInfo.name || preset?.name || providerInfo.id,
        baseUrl: providerInfo.baseUrl || preset?.baseUrl || '',
        model: providerInfo.model || preset?.model || '',
        protocol: providerInfo.protocol ?? preset?.protocol,
        authStyle: providerInfo.authStyle ?? preset?.authStyle,
      });
      const adapter = buildRuntimeLLMAdapter(runtimeConfig);
      adapter.configure(apiKey ?? '', {
        baseUrl: runtimeConfig.baseUrl,
        model: runtimeConfig.model,
      });
      let resolvedPath: string | null = null;
      let resolvedExt = 'jpg';
      for (const ext of IMAGE_EXTENSIONS_VISION) {
        const p = deps.cas.getAssetPath(assetHash, 'image', ext);
        if (fs.existsSync(p)) {
          resolvedPath = p;
          resolvedExt = ext;
          break;
        }
      }
      if (!resolvedPath) {
        throw new Error(`Asset file not found for hash: ${assetHash}`);
      }
      const imageBuffer = fs.readFileSync(resolvedPath);
      const base64Data = imageBuffer.toString('base64');
      const mimeType = MIME_MAP_VISION[resolvedExt] ?? 'image/jpeg';
      const systemPrompt =
        style === 'style-analysis' ? VISION_PROMPT_STYLE_ANALYSIS : VISION_PROMPT_DEFAULT;
      const result = await adapter.complete([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: 'Describe this image.', images: [{ data: base64Data, mimeType }] },
      ]);
      return { prompt: result };
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
