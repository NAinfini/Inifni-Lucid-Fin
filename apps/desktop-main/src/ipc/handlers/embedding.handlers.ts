import type { IpcMain } from 'electron';
import type { CAS, Keychain, SqliteIndex } from '@lucid-fin/storage';
import { parseAssetHash } from '@lucid-fin/contracts-parse';
import log from '../../logger.js';
import { describeImageAsset } from './vision.handlers.js';

// ---------------------------------------------------------------------------
// Tokenization
// ---------------------------------------------------------------------------

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 2);
}

// ---------------------------------------------------------------------------
// Core embedding generation (shared by handler and auto-import)
// ---------------------------------------------------------------------------

export async function generateEmbeddingForAsset(
  cas: CAS,
  keychain: Keychain,
  db: SqliteIndex,
  assetHash: string,
): Promise<void> {
  const description = await describeImageAsset(cas, keychain, assetHash, 'description');
  const tokens = tokenize(description);
  const model = 'vision-description';
  db.repos.assets.insertEmbedding(parseAssetHash(assetHash), description, tokens, model);
  log.info('Embedding generated', {
    category: 'embedding',
    assetHash,
    tokenCount: tokens.length,
  });
}

// ---------------------------------------------------------------------------
// Handler registration
// ---------------------------------------------------------------------------

export function registerEmbeddingHandlers(
  ipcMain: IpcMain,
  deps: {
    cas: CAS;
    keychain: Keychain;
    db: SqliteIndex;
  },
): void {
  const { cas, keychain, db } = deps;

  ipcMain.handle(
    'asset:generateEmbedding',
    async (_event, args: { assetHash: string }) => {
      if (!args?.assetHash || typeof args.assetHash !== 'string') {
        throw new Error('assetHash is required');
      }
      await generateEmbeddingForAsset(cas, keychain, db, args.assetHash);
      return { ok: true };
    },
  );

  ipcMain.handle(
    'asset:searchSemantic',
    async (_event, args: { query: string; limit?: number }) => {
      if (!args?.query || typeof args.query !== 'string') {
        throw new Error('query is required');
      }
      const queryTokens = tokenize(args.query);
      const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 20;
      const results = db.repos.assets.searchByTokens(queryTokens, limit);
      log.info('Semantic search', {
        category: 'embedding',
        query: args.query,
        tokenCount: queryTokens.length,
        resultCount: results.length,
      });
      return results;
    },
  );

  ipcMain.handle(
    'asset:reindexEmbeddings',
    async () => {
      const allAssets = db.repos.assets.query({ type: 'image', limit: 5000 }).rows;
      const embeddedHashes = new Set<string>(db.repos.assets.getAllEmbeddedHashes());
      const toIndex = allAssets.filter((a) => !embeddedHashes.has(a.hash));

      log.info('Reindex embeddings started', {
        category: 'embedding',
        total: allAssets.length,
        toIndex: toIndex.length,
      });

      let indexed = 0;
      let failed = 0;
      for (const asset of toIndex) {
        try {
          await generateEmbeddingForAsset(cas, keychain, db, asset.hash);
          indexed++;
        } catch (err) {
          failed++;
          log.warn('Failed to generate embedding during reindex', {
            category: 'embedding',
            assetHash: asset.hash,
            error: String(err),
          });
        }
      }

      log.info('Reindex embeddings complete', {
        category: 'embedding',
        indexed,
        failed,
      });

      return { indexed, failed };
    },
  );
}
