import fs from 'node:fs';
import path from 'node:path';
import type { CAS, SqliteIndex } from '@lucid-fin/storage';
import type { AssetMeta, AssetType } from '@lucid-fin/contracts';
import { parseAssetHash } from '@lucid-fin/contracts-parse';
import log from '../logger.js';

/**
 * Startup reconciliation: corrects divergence between CAS files and DB rows.
 *
 * Two scenarios are handled:
 *  - Orphan CAS entry: meta.json exists on disk but no DB row → backfill DB row.
 *  - Orphan DB row: DB row exists but CAS asset file is missing → delete DB row.
 *
 * Never throws — all errors are logged as warnings so startup is not blocked.
 */
export function reconcileCasDb(cas: CAS, db: SqliteIndex): void {
  try {
    _reconcileCasDb(cas, db);
  } catch (err) {
    log.warn('CAS/DB reconciliation failed unexpectedly', {
      category: 'asset',
      error: String(err),
    });
  }
}

function _reconcileCasDb(cas: CAS, db: SqliteIndex): void {
  const root = cas.getAssetsRoot();

  // Pass 1: scan CAS meta.json files → backfill missing DB rows.
  if (fs.existsSync(root)) {
    for (const typeDir of ['image', 'video', 'audio'] as const) {
      const typeRoot = path.join(root, typeDir);
      if (!fs.existsSync(typeRoot)) continue;

      let prefixes: string[];
      try {
        prefixes = fs.readdirSync(typeRoot);
      } catch (err) {
        log.warn('reconcileCasDb: cannot read CAS type directory', {
          category: 'asset',
          typeDir,
          error: String(err),
        });
        continue;
      }

      for (const prefix of prefixes) {
        const prefixDir = path.join(typeRoot, prefix);
        let files: string[];
        try {
          if (!fs.statSync(prefixDir).isDirectory()) continue;
          files = fs.readdirSync(prefixDir);
        } catch (err) {
          log.warn('reconcileCasDb: cannot read CAS prefix directory', {
            category: 'asset',
            prefixDir,
            error: String(err),
          });
          continue;
        }

        for (const fileName of files) {
          if (!fileName.endsWith('.meta.json')) continue;
          const metaPath = path.join(prefixDir, fileName);
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as AssetMeta;
            if (!meta.hash) continue;
            const existing = db.repos.assets.findByHash(meta.hash);
            if (!existing) {
              db.repos.assets.insert(meta);
              log.warn('reconcileCasDb: backfilled orphan CAS entry into DB', {
                category: 'asset',
                hash: meta.hash,
                type: meta.type,
              });
            }
          } catch (err) {
            log.warn('reconcileCasDb: failed to process meta.json', {
              category: 'asset',
              metaPath,
              error: String(err),
            });
          }
        }
      }
    }
  }

  // Pass 2: check all DB rows have a corresponding CAS asset file.
  let allRows: AssetMeta[];
  try {
    allRows = db.repos.assets.query({ limit: Number.MAX_SAFE_INTEGER }).rows;
  } catch (err) {
    log.warn('reconcileCasDb: failed to query DB assets for orphan-row check', {
      category: 'asset',
      error: String(err),
    });
    return;
  }

  for (const row of allRows) {
    try {
      const filePath = cas.getAssetPath(row.hash, row.type as AssetType, row.format);
      if (!fs.existsSync(filePath)) {
        db.repos.assets.delete(parseAssetHash(row.hash));
        log.warn('reconcileCasDb: removed orphan DB row (CAS file missing)', {
          category: 'asset',
          hash: row.hash,
          type: row.type,
          format: row.format,
        });
      }
    } catch (err) {
      log.warn('reconcileCasDb: failed to check asset file for DB row', {
        category: 'asset',
        hash: row.hash,
        error: String(err),
      });
    }
  }
}
