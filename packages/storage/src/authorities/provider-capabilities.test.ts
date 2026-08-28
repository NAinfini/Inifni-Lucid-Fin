import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ProviderCapabilitiesDefinition } from '@lucid-fin/contracts';
import { describe, expect, it } from 'vitest';
import { registerStoreDatabase, unregisterStoreDatabase } from '../internal/database-access.js';
import { createProviderCapabilitiesAuthority } from './provider-capabilities.js';
import type {
  ProviderCapabilitiesResolver,
  ProviderCapabilityEvidence,
} from '../kernel/provider-capabilities.js';
import type { Store } from '../kernel/store.js';

const NOW = '2026-08-24T12:00:00.000Z';

function memoryStore(): { store: Store; database: DatabaseSync } {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(
    readFileSync(new URL('../../../contracts/ddl/project-v1.sql', import.meta.url), 'utf8'),
  );
  let open = true;
  const store: Store = {
    databasePath: ':memory:',
    schemaFingerprint: {} as Store['schemaFingerprint'],
    security: { defensive: true, extensionLoading: false, foreignKeys: true },
    close() {
      if (!open) return;
      open = false;
      unregisterStoreDatabase(store);
      database.close();
    },
  };
  registerStoreDatabase(store, database);
  return { store, database };
}

function insertProfile(
  database: DatabaseSync,
  value: {
    readonly id: string;
    readonly providerKind: string;
    readonly model: string;
    readonly reasoningStrength: string | null;
    readonly status: 'ready' | 'unavailable' | 'disabled';
    readonly revision: number;
  },
): void {
  database
    .prepare(
      `INSERT INTO provider_profiles (
         id, display_name, provider_kind, model, reasoning_strength, endpoint_origin,
         credential_handle, status, configuration_v1_json, revision, created_at, updated_at
       ) VALUES (?, 'Provider', ?, ?, ?, 'https://private.invalid', 'credential.private', ?,
                 '{"opaqueCredentialHint":"never expose"}', ?, ?, ?)`,
    )
    .run(
      value.id,
      value.providerKind,
      value.model,
      value.reasoningStrength,
      value.status,
      value.revision,
      NOW,
      NOW,
    );
}

class RecordingCapabilitiesResolver implements ProviderCapabilitiesResolver {
  readonly calls: Parameters<ProviderCapabilitiesResolver['resolve']>[0][] = [];
  readonly responses = new Map<string, readonly ProviderCapabilityEvidence[]>();

  async resolve(profile: Parameters<ProviderCapabilitiesResolver['resolve']>[0]) {
    this.calls.push(profile);
    return this.responses.get(profile.id) ?? [];
  }
}

describe('Provider capabilities authority', () => {
  it('uses only the safe profile projection and deterministically binds, filters, and deduplicates capabilities', async () => {
    const { store, database } = memoryStore();
    try {
      insertProfile(database, {
        id: 'provider.alpha',
        providerKind: 'alpha',
        model: 'model.a',
        reasoningStrength: null,
        status: 'ready',
        revision: 3,
      });
      insertProfile(database, {
        id: 'provider.beta',
        providerKind: 'beta',
        model: 'model.b',
        reasoningStrength: 'deep',
        status: 'unavailable',
        revision: 7,
      });
      const resolver = new RecordingCapabilitiesResolver();
      const alpha: ProviderCapabilityEvidence = {
        modality: 'image',
        imageTasks: ['create'],
        videoTasks: [],
        audioTasks: [],
        parameters: [{ name: 'width', required: true, minimum: 1, maximum: 4096 }],
        quoteSupport: 'estimate',
        availability: 'available',
        capabilityVersion: 'alpha.v1',
        freshAt: NOW,
      };
      resolver.responses.set('provider.alpha', [alpha, alpha]);
      resolver.responses.set('provider.beta', [
        {
          modality: 'video',
          imageTasks: [],
          videoTasks: ['create'],
          audioTasks: [],
          parameters: [{ name: 'durationMs', required: true, minimum: 1_000, maximum: 10_000 }],
          quoteSupport: 'unavailable',
          availability: 'unavailable',
          capabilityVersion: 'beta.v1',
          freshAt: NOW,
        },
      ]);
      const authority = createProviderCapabilitiesAuthority(store, resolver);
      const allInput = ProviderCapabilitiesDefinition.parseInput({
        modality: null,
        providerIds: [],
        models: [],
      });
      const beforeRows = database.prepare('SELECT COUNT(*) AS count FROM provider_profiles').get();

      const all = await authority.query(allInput);
      expect(all.capabilities).toEqual([
        {
          provider: { providerId: 'provider.alpha', model: 'model.a', reasoningStrength: null },
          ...alpha,
        },
        {
          provider: { providerId: 'provider.beta', model: 'model.b', reasoningStrength: 'deep' },
          modality: 'video',
          imageTasks: [],
          videoTasks: ['create'],
          audioTasks: [],
          parameters: [{ name: 'durationMs', required: true, minimum: 1_000, maximum: 10_000 }],
          quoteSupport: 'unavailable',
          availability: 'unavailable',
          capabilityVersion: 'beta.v1',
          freshAt: NOW,
        },
      ]);
      expect(resolver.calls).toEqual([
        {
          id: 'provider.alpha',
          providerKind: 'alpha',
          model: { providerId: 'provider.alpha', model: 'model.a', reasoningStrength: null },
          status: 'ready',
          revision: 3,
          updatedAt: NOW,
        },
        {
          id: 'provider.beta',
          providerKind: 'beta',
          model: { providerId: 'provider.beta', model: 'model.b', reasoningStrength: 'deep' },
          status: 'unavailable',
          revision: 7,
          updatedAt: NOW,
        },
      ]);
      expect(JSON.stringify({ calls: resolver.calls, all })).not.toContain('credential.private');
      expect(JSON.stringify({ calls: resolver.calls, all })).not.toContain('opaqueCredentialHint');
      expect(database.prepare('SELECT COUNT(*) AS count FROM provider_profiles').get()).toEqual(
        beforeRows,
      );

      const filtered = await authority.query(
        ProviderCapabilitiesDefinition.parseInput({
          modality: 'video',
          providerIds: ['provider.alpha', 'provider.beta'],
          models: [{ providerId: 'provider.beta', model: 'model.b' }],
        }),
      );
      expect(filtered.capabilities).toEqual([all.capabilities[1]]);

      resolver.responses.set('provider.alpha', [
        alpha,
        { ...alpha, capabilityVersion: 'alpha.v2' },
      ]);
      await expect(authority.query(allInput)).rejects.toMatchObject({ code: 'CORRUPT_DATA' });
    } finally {
      store.close();
    }
  });
});
