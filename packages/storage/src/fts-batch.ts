/**
 * FTS5 batch utilities for bulk asset operations (R21).
 *
 * Problem: FTS5 entry and content-prompt triggers fire
 * for every individual row. During bulk imports (100+ assets), this causes
 * significant per-row overhead as each trigger round rebuilds FTS index
 * segments.
 *
 * Solution: Drop FTS triggers before the batch, execute all inserts, then
 * rebuild the FTS index in a single pass and re-create the triggers.
 *
 * Approach chosen: **Drop/recreate triggers** (not session-level flags).
 *
 * Session-flag feasibility analysis:
 * SQLite triggers do not natively support conditional execution via
 * session-level variables. A TEMP table or `sqlite3_create_function`
 * approach (via better-sqlite3's `db.function()`) could gate trigger
 * bodies with a `SELECT ... FROM temp_flag` subquery, but this requires:
 *   1. Modifying existing trigger DDL in SCHEMA_SQL to include a WHERE
 *      clause checking the flag — invasive to the schema definition.
 *   2. Ensuring the flag is always initialized on every connection.
 *   3. Risk of stale flags if a crash occurs between flag-set and
 *      flag-clear.
 *
 * The drop/recreate approach is simpler, has no schema-definition
 * coupling, and better-sqlite3 supports DDL inside transactions. The
 * `rebuild` command is the authoritative index restoration path, making
 * the approach idempotent and deterministic.
 */
import type BetterSqlite3 from 'better-sqlite3';

// ── Trigger SQL constants ──────────────────────────────────────────
// These must stay in sync with the trigger definitions in schema-sql.ts.

const TRIGGER_DROP_SQL = `
DROP TRIGGER IF EXISTS asset_entries_ai;
DROP TRIGGER IF EXISTS asset_entries_ad;
DROP TRIGGER IF EXISTS asset_entries_au;
DROP TRIGGER IF EXISTS asset_contents_prompt_au;
`;

const TRIGGER_CREATE_SQL = `
CREATE TRIGGER IF NOT EXISTS asset_entries_ai AFTER INSERT ON asset_entries BEGIN
  INSERT INTO asset_entries_fts(entry_id, display_name, tags, prompt)
  SELECT new.id, new.display_name, new.tags, prompt
    FROM asset_contents WHERE hash = new.asset_hash;
END;

CREATE TRIGGER IF NOT EXISTS asset_entries_ad AFTER DELETE ON asset_entries BEGIN
  DELETE FROM asset_entries_fts WHERE entry_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS asset_entries_au AFTER UPDATE ON asset_entries BEGIN
  UPDATE asset_entries_fts
     SET display_name = new.display_name,
         tags = new.tags,
         prompt = (SELECT prompt FROM asset_contents WHERE hash = new.asset_hash)
   WHERE entry_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS asset_contents_prompt_au
AFTER UPDATE OF prompt ON asset_contents BEGIN
  UPDATE asset_entries_fts
     SET prompt = new.prompt
   WHERE entry_id IN (SELECT id FROM asset_entries WHERE asset_hash = new.hash);
END;
`;

/**
 * Rebuild the FTS5 index from canonical content and entry rows.
 *
 * Uses the FTS5 `rebuild` command which drops and repopulates the index
 * from the content table. This is idempotent — calling it multiple times
 * produces the same correct index.
 *
 * Can be called independently as a recovery/maintenance operation.
 */
export function rebuildFtsIndex(db: BetterSqlite3.Database): void {
  db.exec(`
    DELETE FROM asset_entries_fts;
    INSERT INTO asset_entries_fts(entry_id, display_name, tags, prompt)
    SELECT entry.id, entry.display_name, entry.tags, content.prompt
      FROM asset_entries entry
      JOIN asset_contents content ON content.hash = entry.asset_hash;
  `);
}

/**
 * Execute a batch operation with FTS triggers temporarily disabled.
 *
 * Process:
 *   1. Drop FTS triggers (DDL inside transaction)
 *   2. Execute the caller-provided batch function
 *   3. Rebuild FTS index from source data in a single pass
 *   4. Re-create FTS triggers
 *
 * The entire operation runs inside a single SQLite transaction. If `fn`
 * throws, the transaction rolls back — both data inserts and DDL changes
 * are reverted (triggers remain as they were before the call).
 *
 * After completion, individual (non-batch) inserts/updates/deletes will
 * fire FTS triggers as before.
 *
 * @param db - The better-sqlite3 Database handle
 * @param fn - Synchronous batch operation to execute (e.g., bulk inserts).
 *             Must NOT return a Promise — better-sqlite3 transactions are
 *             synchronous.
 * @returns The return value of `fn`
 */
export function withBatchFts<T>(
  db: BetterSqlite3.Database,
  fn: () => T extends Promise<unknown> ? never : T,
): T {
  const transactional = db.transaction(() => {
    // Step 1: Drop FTS triggers
    db.exec(TRIGGER_DROP_SQL);

    // Step 2: Execute the batch operation
    let result: T;
    try {
      result = fn() as T;
    } catch (err) {
      // On failure, re-create triggers before the transaction rollback
      // propagates. In practice, better-sqlite3 rolls back the entire
      // transaction including DDL, so the triggers are restored. But we
      // re-create explicitly for clarity and defense-in-depth.
      db.exec(TRIGGER_CREATE_SQL);
      throw err;
    }

    // Step 3: Rebuild FTS index from source data
    rebuildFtsIndex(db);

    // Step 4: Re-create FTS triggers for future individual operations
    db.exec(TRIGGER_CREATE_SQL);

    return result;
  });

  return transactional() as T;
}
