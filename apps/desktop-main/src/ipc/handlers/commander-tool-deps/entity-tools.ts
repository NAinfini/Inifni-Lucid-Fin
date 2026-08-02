import {
  requireCanvas,
  createScriptTools,
  createEntityTools,
  EXCLUDED_TOOLS,
  parseScript,
  normalizeScriptFormat,
  saveScriptDocument,
  parseCharacterId,
  parseLocationId,
  parseEquipmentId,
  fs,
  path,
  type ToolRegistrationDeps,
  type AgentToolRegistry,
} from './helpers.js';

export function registerEntityTools(
  registry: AgentToolRegistry,
  deps: ToolRegistrationDeps,
  generateImage: ReturnType<typeof import('./helpers.js').makeGenerateImage>,
): void {
  for (const tool of createScriptTools({
    loadScript: async (filePath?: string) => {
      if (!filePath) {
        return deps.db.repos.scripts.get();
      }
      const resolved = path.resolve(filePath);
      if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
        throw new Error(`Script file not found: ${resolved}`);
      }
      const content = fs.readFileSync(resolved, 'utf-8');
      const ext = path.extname(resolved).toLowerCase();
      const format = ext === '.fountain' ? 'fountain' : ext === '.fdx' ? 'fdx' : 'plaintext';
      return saveScriptDocument(deps.db, content, format);
    },
    saveScript: async (content: string) => {
      saveScriptDocument(deps.db, content, 'fountain');
    },
    parseScript: (content: string) => parseScript(content, 'fountain'),
    importScript: async (content: string, format?: string) => {
      const normalizedFormat = normalizeScriptFormat(format);
      const doc = saveScriptDocument(deps.db, content, normalizedFormat);
      return {
        content: doc.content,
        parsedScenes: doc.parsedScenes,
        format: doc.format,
      };
    },
  })) {
    if (!EXCLUDED_TOOLS.has(tool.name)) registry.register(tool);
  }

  for (const tool of createEntityTools({
    listCharacters: async () => deps.db.repos.entities.listCharacters().rows,
    saveCharacter: async (c) => {
      deps.db.repos.entities.upsertCharacter({ ...c });
    },
    deleteCharacter: async (id) => deps.db.repos.entities.deleteCharacter(parseCharacterId(id)),
    listLocations: async () => deps.db.repos.entities.listLocations().rows,
    saveLocation: async (l) => {
      deps.db.repos.entities.upsertLocation({ ...l });
    },
    deleteLocation: async (id) => deps.db.repos.entities.deleteLocation(parseLocationId(id)),
    listEquipment: async () => deps.db.repos.entities.listEquipment().rows,
    saveEquipment: async (e) => {
      deps.db.repos.entities.upsertEquipment({ ...e });
    },
    deleteEquipment: async (id) => deps.db.repos.entities.deleteEquipment(parseEquipmentId(id)),
    generateImage,
    getCanvas: async (canvasId: string) => requireCanvas(deps.canvasStore, canvasId),
  })) {
    if (!EXCLUDED_TOOLS.has(tool.name)) registry.register(tool);
  }
}
