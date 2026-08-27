import { describe, expect, it } from 'vitest';
import { createTargetDataAccess } from '../kernel/data-access.js';
import { createTargetStore } from '../kernel/store.js';
import type { TargetStore } from '../kernel/store.js';
import { getTargetStoreDatabase } from './database-access.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GenerationProviderAdapter } from '../kernel/generation-provider.js';
import type { MediaCas, MediaImportCapabilityResolver } from '../kernel/media-cas.js';

const unusedMediaCas: MediaCas = {
  putVerified: async () => {
    throw new Error('Media CAS is not used by database access tests');
  },
  stat: async () => null,
  verify: async () => {
    throw new Error('Media CAS is not used by database access tests');
  },
};

const unusedGenerationProvider: GenerationProviderAdapter = {
  providerKind: 'unused',
  quote: async () => {
    throw new Error('Generation provider is not used by database access tests');
  },
  submit: async () => {
    throw new Error('Generation provider is not used by database access tests');
  },
  reconcileByIdempotencyKey: async () => {
    throw new Error('Generation provider is not used by database access tests');
  },
  cancel: async () => {
    throw new Error('Generation provider is not used by database access tests');
  },
};

const unusedMediaImportCapabilities: MediaImportCapabilityResolver = {
  resolve: async () => {
    throw new Error('Media capabilities are not used by database access tests');
  },
};

describe('target store internal database access', () => {
  it('resolves only an open TargetStore handle and forgets it on close', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-target-access-'));
    let store: TargetStore | undefined;
    try {
      store = await createTargetStore(join(directory, 'project.sqlite'));
      const database = getTargetStoreDatabase(store);
      expect(database.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });

      store.close();
      expect(() => getTargetStoreDatabase(store)).toThrow(/not open/i);
    } finally {
      store?.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('links every public authority and read model to the same store lifetime', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-target-data-access-'));
    let store: TargetStore | undefined;
    try {
      store = await createTargetStore(join(directory, 'project.sqlite'));
      const data = createTargetDataAccess(store, {
        mediaCas: unusedMediaCas,
        mediaImportCapabilities: unusedMediaImportCapabilities,
        generationProvider: unusedGenerationProvider,
      });
      expect(Object.keys(data)).toEqual([
        'projects',
        'plugins',
        'globalMedia',
        'conversations',
        'projectMedia',
        'production',
        'userChoices',
        'canvas',
        'runs',
        'harness',
        'taskLists',
        'compactions',
        'operations',
        'mediaDerivations',
        'mediaInspection',
        'generation',
        'providerCapabilities',
        'resultAssessments',
        'delivery',
        'deliveryOperations',
        'runReplay',
        'projectCapabilities',
        'history',
        'search',
        'media',
        'memory',
        'results',
        'overview',
        'scheduling',
      ]);
      expect(Object.isFrozen(data)).toBe(true);

      store.close();
      expect(() =>
        data.projects.get({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.project.get.closed',
          method: 'project.get',
          input: { projectId: 'project.closed' },
        }),
      ).toThrow(/not open/i);
    } finally {
      store?.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
});
