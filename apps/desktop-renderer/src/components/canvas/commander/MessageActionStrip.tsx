import type { ReactNode } from 'react';

export interface MessageActionStripProps {
  messageId: string;
  children: ReactNode;
}

export function MessageActionStrip({ messageId, children }: MessageActionStripProps) {
  return (
    <div
      data-testid={`commander-message-actions-${messageId}`}
      className="flex h-5 items-center justify-end border-b border-border/40 bg-background/10 px-2"
    >
      {children}
    </div>
  );
}
