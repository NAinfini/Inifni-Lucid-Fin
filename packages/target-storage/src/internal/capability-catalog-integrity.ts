import {
  capabilityCatalogHashInput,
  capabilityIndexDigestInput,
  skillCatalogDigestInput,
  toolCatalogDigestInput,
  toolSchemaDigestInput,
  type CapabilityCatalogSnapshotV1,
} from '@lucid-fin/target-contracts';
import { hashCanonical, hashUtf8 } from './hashes.js';

export function capabilityCatalogIntegrityError(
  catalog: CapabilityCatalogSnapshotV1,
): string | undefined {
  for (const tool of catalog.tools) {
    for (const document of [
      tool.inputSchema,
      tool.successSchema,
      tool.outcomeSchema,
      tool.examples,
    ]) {
      if (hashUtf8(document.canonicalJson) !== document.sha256) {
        return `Capability document digest does not match for ${tool.id}`;
      }
    }
    if (
      hashCanonical(tool.metadata) !== tool.metadataHash ||
      hashUtf8(toolSchemaDigestInput(tool)) !== tool.schemaDigest
    ) {
      return `Capability tool digest does not match for ${tool.id}`;
    }
  }
  if (
    hashUtf8(toolCatalogDigestInput(catalog.tools)) !== catalog.toolCatalogDigest ||
    hashUtf8(skillCatalogDigestInput(catalog.skills)) !== catalog.skillCatalogDigest ||
    hashUtf8(capabilityIndexDigestInput(catalog.capabilityIndex)) !== catalog.capabilityIndexDigest
  ) {
    return 'Capability catalog component digest does not match';
  }
  const { catalogHash: _catalogHash, ...withoutHash } = catalog;
  if (hashUtf8(capabilityCatalogHashInput(withoutHash)) !== catalog.catalogHash) {
    return 'Capability catalog hash does not match';
  }
  return undefined;
}
