import { memo } from 'react';
import { Plus, Pencil, Trash2, Link2 } from 'lucide-react';

interface ArtifactChange {
  type: 'added' | 'updated' | 'removed' | 'connected';
  label: string;
  id?: string;
}

export function extractChanges(
  toolName: string,
  result: unknown,
  nodeTitlesById: Record<string, string>,
): ArtifactChange[] {
  if (!result || typeof result !== 'object') return [];
  const r = result as Record<string, unknown>;

  if (toolName.includes('addNode') || toolName.includes('batchCreate')) {
    const nodes = Array.isArray(r.nodes) ? r.nodes : r.nodeId ? [{ id: r.nodeId }] : [];
    return (nodes as Array<Record<string, unknown>>).map((n) => ({
      type: 'added' as const,
      label: nodeTitlesById[n.id as string] ?? (n.title as string) ?? (n.id as string),
      id: n.id as string,
    }));
  }

  if (toolName.includes('updateNode') || toolName.includes('Update')) {
    const ids = Array.isArray(r.nodeIds) ? r.nodeIds : r.nodeId ? [r.nodeId] : [];
    return (ids as string[]).map((id) => ({
      type: 'updated' as const,
      label: nodeTitlesById[id] ?? id,
      id,
    }));
  }

  if (toolName.includes('deleteNode') || toolName.includes('Delete')) {
    const ids = Array.isArray(r.nodeIds) ? r.nodeIds : r.nodeId ? [r.nodeId] : [];
    return (ids as string[]).map((id) => ({
      type: 'removed' as const,
      label: nodeTitlesById[id] ?? id,
      id,
    }));
  }

  if (toolName.includes('connect') || toolName.includes('addEdge')) {
    return [{ type: 'connected', label: 'Edge created' }];
  }

  if (r.success && typeof r.nodeId === 'string') {
    return [{ type: 'updated', label: nodeTitlesById[r.nodeId as string] ?? (r.nodeId as string), id: r.nodeId as string }];
  }

  return [];
}

const icons = {
  added: Plus,
  updated: Pencil,
  removed: Trash2,
  connected: Link2,
};

const colors = {
  added: 'text-emerald-400',
  updated: 'text-amber-400',
  removed: 'text-destructive',
  connected: 'text-primary',
};

interface ArtifactPreviewProps {
  toolName: string;
  result: unknown;
  nodeTitlesById: Record<string, string>;
  onNodeClick?: (nodeId: string) => void;
}

export const ArtifactPreview = memo(function ArtifactPreview({
  toolName,
  result,
  nodeTitlesById,
  onNodeClick,
}: ArtifactPreviewProps) {
  const changes = extractChanges(toolName, result, nodeTitlesById);
  if (changes.length === 0) return null;

  return (
    <div className="mt-1 space-y-0.5">
      {changes.map((change, i) => {
        const Icon = icons[change.type];
        return (
          <div key={i} className="flex items-center gap-1.5 text-[10px]">
            <Icon className={`w-3 h-3 ${colors[change.type]}`} />
            {change.id && onNodeClick ? (
              <button
                type="button"
                className="text-primary underline decoration-dotted cursor-pointer hover:text-primary/80"
                onClick={() => onNodeClick(change.id!)}
              >
                {change.label}
              </button>
            ) : (
              <span className="text-muted-foreground">{change.label}</span>
            )}
          </div>
        );
      })}
    </div>
  );
});
