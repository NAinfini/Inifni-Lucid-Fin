import {
  EntityIdSchema,
  parseCanonical,
  strictObject,
  z,
  type Run,
} from '@lucid-fin/target-contracts';
import { getTargetStoreDatabase } from '../internal/database-access.js';
import { loadRun } from '../internal/run-records.js';
import type { TargetStore } from '../kernel/store.js';

const RunSchedulingPageInputSchema = strictObject({
  afterRunId: EntityIdSchema.nullable(),
  limit: z.number().int().min(1).max(200),
});

export type RunSchedulingPageInput = z.output<typeof RunSchedulingPageInputSchema>;

export interface RunSchedulingPage {
  readonly runs: readonly Run[];
  readonly nextAfterRunId: string | null;
}

interface IdRow {
  readonly id: string;
}

export interface RunSchedulingReadModel {
  listNonterminal(input: RunSchedulingPageInput): RunSchedulingPage;
}

export function createRunSchedulingReadModel(store: TargetStore): RunSchedulingReadModel {
  return Object.freeze({
    listNonterminal(inputValue: RunSchedulingPageInput): RunSchedulingPage {
      const input = parseCanonical(RunSchedulingPageInputSchema, inputValue);
      const database = getTargetStoreDatabase(store);
      const rows = database
        .prepare(
          `SELECT id
           FROM runs
           WHERE status NOT IN ('completed', 'blocked', 'failed', 'cancelled')
             AND (? IS NULL OR id > ?)
           ORDER BY id ASC
           LIMIT ?`,
        )
        .all(input.afterRunId, input.afterRunId, input.limit + 1) as unknown as readonly IdRow[];
      const pageRows = rows.slice(0, input.limit);
      return Object.freeze({
        runs: Object.freeze(pageRows.map(({ id }) => loadRun(database, id))),
        nextAfterRunId: rows.length > input.limit ? (pageRows.at(-1)?.id ?? null) : null,
      });
    },
  });
}
