interface InspectorPanelEmptyStateProps {
  text: string;
}

export function InspectorPanelEmptyState({ text }: InspectorPanelEmptyStateProps) {
  return (
    <div className="flex h-full items-center justify-center p-3 text-xs text-muted-foreground">
      {text}
    </div>
  );
}
