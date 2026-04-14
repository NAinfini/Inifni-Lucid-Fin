import { useCallback } from 'react';
import { addNodeTag, removeNodeTag } from '../../../../store/slices/canvas.js';
import { LazyDetails } from '../../LazyDetails.js';
import type { InspectorSectionProps } from '../inspector-registry.js';

/**
 * Tags & Groups section (M9) -- renders for all node types.
 * Allows the user to add/remove freeform tags on a node.
 */
export function TagsSection({ node, dispatch, t }: InspectorSectionProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        const val = (e.target as HTMLInputElement).value.trim();
        if (val) {
          dispatch(addNodeTag({ id: node.id, tag: val }));
          (e.target as HTMLInputElement).value = '';
        }
      }
    },
    [dispatch, node.id],
  );

  const handleRemove = useCallback(
    (tag: string) => {
      dispatch(removeNodeTag({ id: node.id, tag }));
    },
    [dispatch, node.id],
  );

  return (
    <div className="px-3 py-2 border-b border-border/60">
      <LazyDetails
        className="group"
        summary={
          <summary className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider select-none">
            <span className="transition-transform group-open:rotate-90">&#9654;</span>
            {t('inspector.tagsAndGroups')}
          </summary>
        }
      >
        <div className="mt-1.5 space-y-1.5">
          <div className="flex items-center gap-1">
            <input
              type="text"
              className="flex-1 rounded-md border border-border/60 bg-muted px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring"
              placeholder={t('inspector.addTagPlaceholder')}
              onKeyDown={handleKeyDown}
            />
          </div>
          {(node.tags ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {(node.tags ?? []).map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-0.5 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  {tag}
                  <button
                    type="button"
                    className="ml-0.5 text-muted-foreground/50 hover:text-destructive"
                    onClick={() => handleRemove(tag)}
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </LazyDetails>
    </div>
  );
}
