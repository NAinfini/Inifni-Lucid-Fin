import { useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import { setNodeAnnotation } from '../../../../store/slices/canvas.js';
import { LazyDetails } from '../../LazyDetails.js';
import type { InspectorSectionProps } from '../inspector-registry.js';
import type { ImageNodeData, VideoNodeData, AudioNodeData } from '@lucid-fin/contracts';

/**
 * Annotation section (M7) -- renders for generation nodes (image/video/audio).
 * Allows the user to add a text annotation to the node.
 */
export function AnnotationSection({ node, dispatch, t }: InspectorSectionProps) {
  const generationData = node.data as ImageNodeData | VideoNodeData | AudioNodeData;

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const text = e.target.value;
      dispatch(
        setNodeAnnotation({
          id: node.id,
          annotation: text ? { text, position: 'bottom' } : undefined,
        }),
      );
    },
    [dispatch, node.id],
  );

  return (
    <div className="px-3 py-2 border-b border-border/60">
      <LazyDetails
        className="group"
        summary={
          <summary className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider select-none">
            <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
            {t('inspector.annotation')}
          </summary>
        }
      >
        <div className="mt-1.5 space-y-1">
          <input
            type="text"
            className="w-full rounded-md border border-border/60 bg-muted px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring"
            placeholder={t('inspector.annotationPlaceholder')}
            value={
              (generationData as { annotation?: { text?: string } })?.annotation?.text ?? ''
            }
            onChange={handleChange}
          />
        </div>
      </LazyDetails>
    </div>
  );
}
