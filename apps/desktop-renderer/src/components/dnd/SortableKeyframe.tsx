import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

interface SortableKeyframeProps {
  id: string;
  children: React.ReactNode;
}

export function SortableKeyframe({ id, children }: SortableKeyframeProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <button
        {...listeners}
        className="absolute left-1 top-1 z-10 p-0.5 rounded hover:bg-muted cursor-grab active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="w-3 h-3 text-muted-foreground" />
      </button>
      {children}
    </div>
  );
}
