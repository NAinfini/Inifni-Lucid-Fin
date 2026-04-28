import type { IpcMain, BrowserWindow } from 'electron';
import type { CAS, Keychain, SqliteIndex } from '@lucid-fin/storage';
import { parseAssetHash } from '@lucid-fin/contracts-parse';
import { assetReindexProgressChannel } from '@lucid-fin/contracts-parse';
import log from '../../logger.js';
import { describeImageAsset } from './vision.handlers.js';
import {
  createRendererPushGateway,
  type RendererPushGateway,
} from '../../features/ipc/push-gateway.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REINDEX_BATCH_SIZE = 50;

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
    /** Optional — provide to enable push progress events during reindex. */
    getWindow?: () => BrowserWindow | null;
    /** Pre-built gateway; takes precedence over getWindow when supplied. */
    pushGateway?: RendererPushGateway;
  },
): void {
  const { cas, keychain, db } = deps;
  // Progress gateway: use injected gateway first, fall back to constructing
  // one from getWindow, or leave undefined (no progress events emitted).
  const gateway: RendererPushGateway | undefined =
    deps.pushGateway ??
    (deps.getWindow ? createRendererPushGateway({ getWindow: deps.getWindow }) : undefined);

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
    async (_event, _args, signal?: AbortSignal) => {
      const allAssets = db.repos.assets.query({ type: 'image', limit: 5000 }).rows;
      const embeddedHashes = new Set<string>(db.repos.assets.getAllEmbeddedHashes());
      const toIndex = allAssets.filter((a) => !embeddedHashes.has(a.hash));
      const total = toIndex.length;

      log.info('Reindex embeddings started', {
        category: 'embedding',
        total: allAssets.length,
        toIndex: total,
      });

      let indexed = 0;
      let failed = 0;

      for (let batchStart = 0; batchStart < toIndex.length; batchStart += REINDEX_BATCH_SIZE) {
        // Honour abort between batches
        if (signal?.aborted) {
          log.info('Reindex embeddings aborted', {
            category: 'embedding',
            indexed,
            failed,
            remaining: total - indexed - failed,
          });
          break;
        }

        const batch = toIndex.slice(batchStart, batchStart + REINDEX_BATCH_SIZE);

        for (const asset of batch) {
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

        // Emit progress after each batch
        gateway?.emit(assetReindexProgressChannel, { indexed, failed, total });

        // Yield to the event loop between batches so IPC and other work can proceed
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
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
