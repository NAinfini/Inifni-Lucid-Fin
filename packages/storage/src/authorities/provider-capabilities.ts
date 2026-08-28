import { ProviderCapabilitiesDefinition, canonicalJson } from '@lucid-fin/contracts';
import { getStoreDatabase } from '../internal/database-access.js';
import { StorageError } from '../kernel/errors.js';
import {
  parseProviderCapabilitiesProfile,
  parseProviderCapabilityEvidence,
  type ProviderCapabilitiesProfile,
  type ProviderCapabilitiesResolver,
} from '../kernel/provider-capabilities.js';
import type { Store } from '../kernel/store.js';

export type ProviderCapabilitiesInput = ReturnType<
  typeof ProviderCapabilitiesDefinition.parseInput
>;
export type ProviderCapabilitiesSuccess = ReturnType<
  typeof ProviderCapabilitiesDefinition.parseSuccess
>;

export interface ProviderCapabilitiesAuthority {
  query(
    input: ProviderCapabilitiesInput,
    signal?: AbortSignal,
  ): Promise<ProviderCapabilitiesSuccess>;
}

interface ProviderProfileRow {
  id: string;
  provider_kind: string;
  model: string;
  reasoning_strength: string | null;
  status: 'ready' | 'unavailable' | 'disabled';
  revision: number;
  updated_at: string;
}

function corrupt(message: string, cause?: unknown): StorageError {
  return new StorageError('CORRUPT_DATA', message, cause === undefined ? undefined : { cause });
}

function matchesProfile(
  input: ProviderCapabilitiesInput,
  profile: ProviderCapabilitiesProfile,
): boolean {
  return (
    (input.providerIds.length === 0 || input.providerIds.includes(profile.id)) &&
    (input.models.length === 0 ||
      input.models.some(
        ({ providerId, model }) => providerId === profile.id && model === profile.model.model,
      ))
  );
}

function compareText(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function compareNullableText(left: string | null, right: string | null): number {
  if (left === right) return 0;
  if (left === null) return -1;
  if (right === null) return 1;
  return compareText(left, right);
}

function compareCapabilities(
  left: ProviderCapabilitiesSuccess['capabilities'][number],
  right: ProviderCapabilitiesSuccess['capabilities'][number],
): number {
  return (
    compareText(left.provider.providerId, right.provider.providerId) ||
    compareText(left.provider.model, right.provider.model) ||
    compareNullableText(left.provider.reasoningStrength, right.provider.reasoningStrength) ||
    compareText(left.modality, right.modality)
  );
}

function identityFor(capability: ProviderCapabilitiesSuccess['capabilities'][number]): string {
  return canonicalJson({
    providerId: capability.provider.providerId,
    model: capability.provider.model,
    reasoningStrength: capability.provider.reasoningStrength,
    modality: capability.modality,
  });
}

function loadProfiles(store: Store): readonly ProviderCapabilitiesProfile[] {
  const rows = getStoreDatabase(store)
    .prepare(
      `SELECT id, provider_kind, model, reasoning_strength, status, revision, updated_at
       FROM provider_profiles
       ORDER BY id ASC, model ASC, reasoning_strength ASC`,
    )
    .all() as unknown as ProviderProfileRow[];
  return rows.map((row) => {
    try {
      return parseProviderCapabilitiesProfile({
        id: row.id,
        providerKind: row.provider_kind,
        model: {
          providerId: row.id,
          model: row.model,
          reasoningStrength: row.reasoning_strength,
        },
        status: row.status,
        revision: row.revision,
        updatedAt: row.updated_at,
      });
    } catch (cause) {
      throw corrupt(`Provider Profile ${row.id} is invalid`, cause);
    }
  });
}

export function createProviderCapabilitiesAuthority(
  store: Store,
  resolver: ProviderCapabilitiesResolver,
): ProviderCapabilitiesAuthority {
  return Object.freeze({
    async query(inputValue: ProviderCapabilitiesInput, signal?: AbortSignal) {
      const input = ProviderCapabilitiesDefinition.parseInput(inputValue);
      const capabilities = new Map<string, ProviderCapabilitiesSuccess['capabilities'][number]>();
      for (const profile of loadProfiles(store)) {
        if (!matchesProfile(input, profile)) continue;
        const supplied = await resolver.resolve(profile, signal);
        let evidence: ReturnType<typeof parseProviderCapabilityEvidence>;
        try {
          evidence = parseProviderCapabilityEvidence(supplied);
        } catch (cause) {
          throw corrupt(
            `Provider Capabilities resolver output is invalid for ${profile.id}`,
            cause,
          );
        }
        for (const entry of evidence) {
          if (input.modality !== null && entry.modality !== input.modality) continue;
          let capability: ProviderCapabilitiesSuccess['capabilities'][number];
          try {
            capability = ProviderCapabilitiesDefinition.parseSuccess({
              capabilities: [{ provider: profile.model, ...entry }],
            }).capabilities[0]!;
          } catch (cause) {
            throw corrupt(
              `Provider Capabilities resolver output is invalid for ${profile.id}`,
              cause,
            );
          }
          const identity = identityFor(capability);
          const existing = capabilities.get(identity);
          if (existing !== undefined) {
            if (canonicalJson(existing) !== canonicalJson(capability)) {
              throw corrupt(`Provider Capabilities resolver returned conflicting ${identity}`);
            }
            continue;
          }
          capabilities.set(identity, capability);
        }
      }
      try {
        return ProviderCapabilitiesDefinition.parseSuccess({
          capabilities: [...capabilities.values()].sort(compareCapabilities),
        });
      } catch (cause) {
        throw corrupt('Provider Capabilities result exceeds its bounded contract', cause);
      }
    },
  });
}
