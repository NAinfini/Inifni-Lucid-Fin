import type { IpcMain } from 'electron';
import type { AdapterRegistry } from '@lucid-fin/adapters-ai';
import type { ReferenceImage } from '@lucid-fin/contracts';
import type { CAS, SqliteIndex } from '@lucid-fin/storage';
import { parseCharacterId, parseEquipmentId, parseLocationId } from '@lucid-fin/contracts-parse';
import { generateAndImport } from '../../generation-pipeline.js';

type EntityGenerationDeps = {
  adapterRegistry: AdapterRegistry;
  cas: CAS;
  db: SqliteIndex;
};

type GenerateArgs = {
  entityType: 'character' | 'equipment' | 'location';
  entityId: string;
  description: string;
  provider: string;
  variantCount?: number;
  seed?: number;
};

export function registerEntityHandlers(ipcMain: IpcMain, deps: EntityGenerationDeps): void {
  ipcMain.handle('entity:generateReferenceImage', async (_event, args: GenerateArgs) => {
    const { entityType, entityId, description, provider, variantCount = 1, seed } = args;

    if (!entityId || !entityType) throw new Error('entityId and entityType are required');

    const adapter = deps.adapterRegistry.get(provider);
    if (!adapter) throw new Error(`Provider not found: ${provider}`);

    const hashes: string[] = [];

    for (let i = 0; i < Math.min(variantCount, 9); i++) {
      const result = await generateAndImport(
        { type: 'image', providerId: provider, prompt: description, seed: typeof seed === 'number' ? seed + i : undefined, width: 1024, height: 1024 },
        { adapter, cas: deps.cas, db: deps.db },
        { prompt: description, provider, tags: [entityType, `${entityType}:${entityId}`, 'reference-image'] },
      );
      hashes.push(...result.hashes);
    }

    const newRefs: ReferenceImage[] = hashes.map((hash, i) => ({
      slot: `generated-${Date.now()}-${i}`,
      assetHash: hash,
      isStandard: false,
    }));

    if (entityType === 'character') {
      const entity = deps.db.repos.entities.getCharacter(parseCharacterId(entityId));
      if (!entity) throw new Error(`Character not found: ${entityId}`);
      deps.db.repos.entities.upsertCharacter({ id: entity.id, name: entity.name, referenceImages: [...entity.referenceImages, ...newRefs], updatedAt: Date.now() });
    } else if (entityType === 'equipment') {
      const entity = deps.db.repos.entities.getEquipment(parseEquipmentId(entityId));
      if (!entity) throw new Error(`Equipment not found: ${entityId}`);
      deps.db.repos.entities.upsertEquipment({ id: entity.id, name: entity.name, referenceImages: [...entity.referenceImages, ...newRefs], updatedAt: Date.now() });
    } else {
      const entity = deps.db.repos.entities.getLocation(parseLocationId(entityId));
      if (!entity) throw new Error(`Location not found: ${entityId}`);
      deps.db.repos.entities.upsertLocation({ id: entity.id, name: entity.name, referenceImages: [...entity.referenceImages, ...newRefs], updatedAt: Date.now() });
    }

    return { variants: hashes };
  });
}
