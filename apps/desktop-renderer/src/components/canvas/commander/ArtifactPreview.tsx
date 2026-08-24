import { memo } from 'react';
import { FileImage, ListChecks, PanelsTopLeft } from 'lucide-react';
import type { PublicToolArtifact } from '@lucid-fin/contracts';

interface ArtifactPreviewProps {
  artifacts: PublicToolArtifact[];
  onNodeClick?: (nodeId: string) => void;
}

const artifactIcon = {
  asset: FileImage,
  checklist: ListChecks,
  canvas_node: PanelsTopLeft,
};

/** Render only canonical public artifact references; raw tool results never enter this component. */
export const ArtifactPreview = memo(function ArtifactPreview({
  artifacts,
  onNodeClick,
}: ArtifactPreviewProps) {
  if (!artifacts.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5" data-testid="commander-artifact-preview">
      {artifacts.map((artifact) => {
        const Icon = artifactIcon[artifact.kind];
        const label = artifact.label ?? artifact.id;
        const content = (
          <>
            <Icon className="h-3 w-3" aria-hidden />
            <span>{label}</span>
          </>
        );
        return artifact.kind === 'canvas_node' && onNodeClick ? (
          <button
            type="button"
            key={`${artifact.kind}:${artifact.id}`}
            className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-primary"
            onClick={() => onNodeClick(artifact.id)}
          >
            {content}
          </button>
        ) : (
          <span
            key={`${artifact.kind}:${artifact.id}`}
            className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground"
          >
            {content}
          </span>
        );
      })}
    </div>
  );
});
