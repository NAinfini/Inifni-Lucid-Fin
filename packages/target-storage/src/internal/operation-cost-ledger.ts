import type { ProviderUsage, ResourceAmount } from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import type { TargetStorageEnvironment } from './environment.js';
import {
  compareExactDecimals,
  formatExactDecimal,
  parseExactDecimal,
  subtractExactDecimals,
} from './exact-decimal.js';
import type { BoundOperationRecord } from './operation-dispatch.js';
import { appendRunResourceEntry, loadRunResourceEntries } from './run-resource-ledger.js';
import { hashCanonical } from './hashes.js';

function resourceKey(ownerId: string, phase: string): string {
  return hashCanonical({ ownerId, kind: 'cost', phase });
}

function corrupt(label: string, message: string): TargetStorageError {
  return new TargetStorageError('CORRUPT_DATA', `${label} ${message}`);
}

export function loadOperationCostReservation(
  database: DatabaseSync,
  bound: BoundOperationRecord,
  label: string,
) {
  const reservations = loadRunResourceEntries(database, bound.dispatch.key.runId).filter(
    (entry) =>
      entry.source.kind === 'dispatch_operation' &&
      entry.source.id === bound.dispatch.id &&
      entry.kind === 'cost' &&
      entry.phase === 'reserved',
  );
  if (reservations.length !== 1 || !('currency' in reservations[0]!.amount)) {
    throw corrupt(label, 'cost reservation is incomplete');
  }
  return reservations[0]!;
}

export function appendOperationCostReservation(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  bound: BoundOperationRecord,
  amount: ResourceAmount,
  recordedAt: string,
): void {
  appendRunResourceEntry(database, environment, {
    runId: bound.dispatch.key.runId,
    source: { kind: 'dispatch_operation', id: bound.dispatch.id },
    phase: 'reserved',
    reservationEntryId: null,
    kind: 'cost',
    amount,
    idempotencyKey: resourceKey(bound.owner.view.id, 'reserved'),
    recordedAt,
  });
}

export function releaseOperationCostReservation(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  bound: BoundOperationRecord,
  recordedAt: string,
  label: string,
): void {
  const reservation = loadOperationCostReservation(database, bound, label);
  appendRunResourceEntry(database, environment, {
    runId: bound.dispatch.key.runId,
    source: { kind: 'dispatch_operation', id: bound.dispatch.id },
    phase: 'released',
    reservationEntryId: reservation.id,
    kind: 'cost',
    amount: reservation.amount,
    idempotencyKey: resourceKey(bound.owner.view.id, 'released'),
    recordedAt,
  });
}

export function settleOperationCostReservation(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  bound: BoundOperationRecord,
  usage: ProviderUsage,
  recordedAt: string,
  label: string,
): void {
  const reservation = loadOperationCostReservation(database, bound, label);
  if (
    usage.cost.state !== 'known' ||
    !('currency' in reservation.amount) ||
    usage.cost.currency !== reservation.amount.currency
  ) {
    throw corrupt(label, 'terminal cost is not exact');
  }
  const source = { kind: 'dispatch_operation' as const, id: bound.dispatch.id };
  if (reservation.amount.state === 'unknown') {
    releaseOperationCostReservation(database, environment, bound, recordedAt, label);
    appendRunResourceEntry(database, environment, {
      runId: bound.dispatch.key.runId,
      source,
      phase: 'consumed',
      reservationEntryId: null,
      kind: 'cost',
      amount: usage.cost,
      idempotencyKey: resourceKey(bound.owner.view.id, 'consumed'),
      recordedAt,
    });
    return;
  }
  if (
    compareExactDecimals(
      parseExactDecimal(usage.cost.value),
      parseExactDecimal(reservation.amount.value),
    ) > 0
  ) {
    throw corrupt(label, 'exceeded its quoted cost upper bound');
  }
  appendRunResourceEntry(database, environment, {
    runId: bound.dispatch.key.runId,
    source,
    phase: 'consumed',
    reservationEntryId: reservation.id,
    kind: 'cost',
    amount: usage.cost,
    idempotencyKey: resourceKey(bound.owner.view.id, 'consumed'),
    recordedAt,
  });
  appendRunResourceEntry(database, environment, {
    runId: bound.dispatch.key.runId,
    source,
    phase: 'released',
    reservationEntryId: reservation.id,
    kind: 'cost',
    amount: {
      state: 'known',
      value: formatExactDecimal(
        subtractExactDecimals(
          parseExactDecimal(reservation.amount.value),
          parseExactDecimal(usage.cost.value),
        ),
      ),
      currency: reservation.amount.currency,
    },
    idempotencyKey: resourceKey(bound.owner.view.id, 'released'),
    recordedAt,
  });
}
