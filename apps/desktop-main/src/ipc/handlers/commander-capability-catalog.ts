import { createHash } from 'node:crypto';
import type { ToolRegistry } from '@lucid-fin/application';
import type { RunCapabilityCatalogEntry } from '@lucid-fin/contracts';

export interface FrozenRunCapabilityCatalog {
  catalogHash: string;
  tools: RunCapabilityCatalogEntry[];
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

export function freezeRunCapabilityCatalog(
  registry: ToolRegistry,
): FrozenRunCapabilityCatalog {
  const tools = registry
    .list()
    .map(
      (tool): RunCapabilityCatalogEntry => ({
        name: tool.name,
        description: tool.description,
        tier: tool.tier,
        tags: [...(tool.tags ?? [])].sort(),
        contexts: [...(tool.contexts ?? [])].sort(),
        inputSchemaHash: hash(stableStringify(tool.inputSchema)),
        outputSchemaHash: hash(stableStringify(tool.outputSchema)),
      }),
    )
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    tools,
    catalogHash: hash(stableStringify(tools)),
  };
}
