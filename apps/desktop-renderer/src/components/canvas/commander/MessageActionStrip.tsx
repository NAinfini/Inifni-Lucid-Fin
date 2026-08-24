import type { ReactNode } from 'react';

export interface MessageActionStripProps {
  messageId: string;
  children: ReactNode;
}

export function MessageActionStrip({ messageId, children }: MessageActionStripProps) {
  return (
    <div
      data-testid={`commander-message-actions-${messageId}`}
      className="flex h-5 items-center justify-end opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
    >
      {children}
    </div>
  );
}
