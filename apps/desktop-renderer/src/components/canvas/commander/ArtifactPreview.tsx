import { memo, useState } from 'react';
import { Plus, Pencil, Trash2, Link2 } from 'lucide-react';

interface ArtifactChange {
  type: 'added' | 'updated' | 'removed' | 'connected';
  /**
   * Display label. `null` means "look up a locale-specific fallback at
   * render time" (currently only for edge-connection changes where there
   * is no node to name). Keeping the extractor pure means every non-null
   * label is data, not i18n — titles, ids, etc.
   */
  label: string | null;
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
    // Label resolved by the renderer via i18n — there is no node to name.
    return [{ type: 'connected', label: null }];
  }

  if (r.success && typeof r.nodeId === 'string') {
    return [
      {
        type: 'updated',
        label: nodeTitlesById[r.nodeId as string] ?? (r.nodeId as string),
        id: r.nodeId as string,
      },
    ];
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
  resolveNodeAssetHash?: (nodeId: string) => string | undefined;
  t: (key: string) => string;
  onNodeClick?: (nodeId: string) => void;
}

function isGenerateTool(toolName: string): boolean {
  const lower = toolName.toLowerCase();
  return lower.includes('generate') && lower.includes('canvas');
}

function GeneratedImagePreview({
  nodeId,
  assetHash,
  onNodeClick,
}: {
  nodeId: string;
  assetHash: string;
  onNodeClick?: (nodeId: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const src = `lucid-asset://${assetHash}/image/png`;

  if (failed) return null;

  return (
    <button
      type="button"
      className="mt-1.5 block overflow-hidden rounded-md border border-border/40"
      onClick={() => onNodeClick?.(nodeId)}
    >
      <img
        src={src}
        alt=""
        className={`max-h-32 w-auto object-contain transition-all duration-700 ${loaded ? 'blur-0 opacity-100' : 'blur-md opacity-40'}`}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
    </button>
  );
}

export const ArtifactPreview = memo(function ArtifactPreview({
  toolName,
  result,
  nodeTitlesById,
  resolveNodeAssetHash,
  t,
  onNodeClick,
}: ArtifactPreviewProps) {
  const changes = extractChanges(toolName, result, nodeTitlesById);

  // 3H: Image blur-reveal for canvas.generate results
  const generatedImageInfo = (() => {
    if (!isGenerateTool(toolName) || !resolveNodeAssetHash || !result) return null;
    const r = result as Record<string, unknown>;
    const nodeId = typeof r.nodeId === 'string' ? r.nodeId : null;
    if (!nodeId) return null;
    const assetHash = resolveNodeAssetHash(nodeId);
    if (!assetHash) return null;
    return { nodeId, assetHash };
  })();

  if (changes.length === 0 && !generatedImageInfo) return null;

  return (
    <div className="mt-1 space-y-0.5">
      {generatedImageInfo && (
        <GeneratedImagePreview
          nodeId={generatedImageInfo.nodeId}
          assetHash={generatedImageInfo.assetHash}
          onNodeClick={onNodeClick}
        />
      )}
      {changes.map((change, i) => {
        const Icon = icons[change.type];
        const label = change.label ?? t(`commander.artifact.${change.type}`);
        return (
          <div key={i} className="flex items-center gap-1.5 text-[10px]">
            <Icon className={`w-3 h-3 ${colors[change.type]}`} />
            {change.id && onNodeClick ? (
              <button
                type="button"
                className="text-primary underline decoration-dotted cursor-pointer hover:text-primary/80"
                onClick={() => onNodeClick(change.id!)}
              >
                {label}
              </button>
            ) : (
              <span className="text-muted-foreground">{label}</span>
            )}
          </div>
        );
      })}
    </div>
  );
});
