import type { Run } from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import {
  addExactDecimals,
  parseExactDecimal,
  subtractExactDecimals,
  type ExactDecimal,
} from './exact-decimal.js';
import { loadRunResourceEntries, type RunResourceEntry } from './run-resource-ledger.js';

export interface RunBudgetExposure {
  readonly cost: ExactDecimal | null;
  readonly costCurrency: string;
  readonly generationCount: bigint;
  readonly inputTokens: bigint | null;
  readonly outputTokens: bigint | null;
}

export function loadRunBudgetExposure(
  database: DatabaseSync,
  run: Run,
  entries: readonly RunResourceEntry[] = loadRunResourceEntries(database, run.id),
): RunBudgetExposure {
  let cost: ExactDecimal | null = parseExactDecimal('0');
  let generationCount = 0n;
  let inputTokens: bigint | null = 0n;
  let outputTokens: bigint | null = 0n;
  const releasedReservationIds = new Set(
    entries.flatMap((entry) =>
      entry.phase === 'released' && entry.reservationEntryId !== null
        ? [entry.reservationEntryId]
        : [],
    ),
  );
  for (const entry of entries) {
    if (entry.kind === 'cost') {
      if (!('currency' in entry.amount) || entry.amount.currency !== run.budget.costUsd.currency) {
        throw new TargetStorageError(
          'CORRUPT_DATA',
          `Run ${run.id} cost ledger currency does not match its budget`,
        );
      }
      if (
        entry.amount.state === 'unknown' &&
        ((entry.phase === 'reserved' && !releasedReservationIds.has(entry.id)) ||
          (entry.phase === 'consumed' && entry.reservationEntryId === null))
      ) {
        cost = null;
      } else if (
        entry.amount.state !== 'unknown' &&
        cost !== null &&
        (entry.phase === 'reserved' ||
          (entry.phase === 'consumed' && entry.reservationEntryId === null))
      ) {
        cost = addExactDecimals(cost, parseExactDecimal(entry.amount.value));
      } else if (entry.amount.state !== 'unknown' && cost !== null && entry.phase === 'released') {
        cost = subtractExactDecimals(cost, parseExactDecimal(entry.amount.value));
      }
    }
    if (entry.kind === 'generation_count' && entry.amount.state !== 'unknown') {
      if (
        entry.phase === 'reserved' ||
        (entry.phase === 'consumed' && entry.reservationEntryId === null)
      ) {
        generationCount += BigInt(entry.amount.value);
      } else if (entry.phase === 'released') {
        generationCount -= BigInt(entry.amount.value);
      }
    }
    if (entry.kind === 'input_tokens' || entry.kind === 'output_tokens') {
      const current: bigint | null = entry.kind === 'input_tokens' ? inputTokens : outputTokens;
      let next: bigint | null = current;
      if (
        entry.amount.state === 'unknown' &&
        ((entry.phase === 'reserved' && !releasedReservationIds.has(entry.id)) ||
          (entry.phase === 'consumed' && entry.reservationEntryId === null))
      ) {
        next = null;
      } else if (
        entry.amount.state !== 'unknown' &&
        current !== null &&
        (entry.phase === 'reserved' ||
          (entry.phase === 'consumed' && entry.reservationEntryId === null))
      ) {
        next = current + BigInt(entry.amount.value);
      } else if (
        entry.amount.state !== 'unknown' &&
        current !== null &&
        entry.phase === 'released'
      ) {
        next = current - BigInt(entry.amount.value);
      }
      if (entry.kind === 'input_tokens') inputTokens = next;
      else outputTokens = next;
    }
  }
  if (
    generationCount < 0n ||
    (inputTokens !== null && inputTokens < 0n) ||
    (outputTokens !== null && outputTokens < 0n) ||
    (cost !== null && cost.coefficient < 0n)
  ) {
    throw new TargetStorageError('CORRUPT_DATA', `Run ${run.id} resource ledger is negative`);
  }
  return {
    cost,
    costCurrency: run.budget.costUsd.currency,
    generationCount,
    inputTokens,
    outputTokens,
  };
}
