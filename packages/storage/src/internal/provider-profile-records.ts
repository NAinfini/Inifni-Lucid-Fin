import {
  ProviderModelSchema,
  canonicalJson,
  parseCanonical,
  type ProviderModel,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from '../kernel/errors.js';

export interface ProviderAdapterIdentity {
  readonly providerKind: string;
}

export interface ResolvedProviderProfile {
  readonly id: string;
  readonly providerKind: string;
  readonly model: ProviderModel;
}

interface ProviderProfileRow {
  id: string;
  provider_kind: string;
  model: string;
  reasoning_strength: string | null;
  status: 'ready' | 'unavailable' | 'disabled';
  configuration_v1_json: string;
}

function invalid(message: string): StorageError {
  return new StorageError('INVALID_REQUEST', message);
}

function corrupt(message: string): StorageError {
  return new StorageError('CORRUPT_DATA', message);
}

export function loadProviderProfileRecord(
  database: DatabaseSync,
  requestedId: string,
  adapter: ProviderAdapterIdentity,
  label: string,
  expectedModel?: ProviderModel,
): ResolvedProviderProfile {
  const row = database
    .prepare(
      `SELECT id, provider_kind, model, reasoning_strength, status, configuration_v1_json
       FROM provider_profiles WHERE id = ?`,
    )
    .get(requestedId) as unknown as ProviderProfileRow | undefined;
  if (row === undefined) throw invalid(`${label} Provider Profile ${requestedId} was not found`);
  let configuration: unknown;
  try {
    configuration = JSON.parse(row.configuration_v1_json) as unknown;
  } catch {
    throw corrupt(`${label} Provider Profile ${row.id} configuration is invalid`);
  }
  if (
    typeof configuration !== 'object' ||
    configuration === null ||
    Array.isArray(configuration) ||
    canonicalJson(configuration) !== row.configuration_v1_json
  ) {
    throw corrupt(`${label} Provider Profile ${row.id} configuration is not canonical`);
  }
  let model: ProviderModel;
  try {
    model = parseCanonical(ProviderModelSchema, {
      providerId: row.id,
      model: row.model,
      reasoningStrength: row.reasoning_strength,
    });
  } catch {
    throw corrupt(`${label} Provider Profile ${row.id} is invalid`);
  }
  if (row.status !== 'ready') throw invalid(`${label} Provider Profile ${row.id} is not ready`);
  if (row.provider_kind !== adapter.providerKind) {
    throw invalid(`${label} Provider Profile ${row.id} has no injected adapter`);
  }
  if (expectedModel !== undefined && canonicalJson(expectedModel) !== canonicalJson(model)) {
    throw invalid(`${label} Provider Profile ${row.id} no longer matches the accepted Attempt`);
  }
  return Object.freeze({ id: row.id, providerKind: row.provider_kind, model });
}
