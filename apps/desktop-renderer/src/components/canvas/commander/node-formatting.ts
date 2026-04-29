// apps/desktop-renderer/src/components/canvas/commander/node-formatting.ts

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNodeReferenceKey(key: string): boolean {
  return key === 'nodeId' || key.endsWith('NodeId') || key === 'source' || key === 'target';
}

export function isNodeReferenceListKey(key: string): boolean {
  return key === 'nodeIds' || key.endsWith('NodeIds');
}

export function formatNodeReference(
  nodeId: string,
  nodeTitlesById: Record<string, string>,
): string {
  const title = nodeTitlesById[nodeId]?.trim();
  if (!title || title === nodeId) {
    return nodeId;
  }
  return `${title} (${nodeId})`;
}

export function annotateToolPayload(
  value: unknown,
  nodeTitlesById: Record<string, string>,
  parentKey?: string,
): unknown {
  if (typeof value === 'string' && parentKey && isNodeReferenceKey(parentKey)) {
    return formatNodeReference(value, nodeTitlesById);
  }

  if (Array.isArray(value)) {
    if (parentKey && isNodeReferenceListKey(parentKey)) {
      return value.map((entry) =>
        typeof entry === 'string' ? formatNodeReference(entry, nodeTitlesById) : entry,
      );
    }
    return value.map((entry) => annotateToolPayload(entry, nodeTitlesById));
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      annotateToolPayload(entry, nodeTitlesById, key),
    ]),
  );
}
