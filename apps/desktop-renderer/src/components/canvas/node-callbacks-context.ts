import { createContext, useContext } from 'react';

export interface NodeCallbacks {
  onTitleChange: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onCut: (id: string) => void;
  onCopy: (id: string) => void;
  onPaste: (id: string) => void;
  onDisconnect: (id: string) => void;
  onConnectTo: (id: string) => void;
  onRename: (id: string) => void;
  onGenerate: (id: string) => void;
  onLock: (id: string) => void;
  onColorTag: (id: string, color: string | undefined) => void;
  onCopyPromptForAI: (id: string) => void;
  onUpload: (id: string) => void;
  onSelectVariant: (id: string, index: number) => void;
  onToggleSeedLock: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onOpacityChange: (id: string, opacity: number) => void;
  onCloneVideo: () => void;
}

const NOOP = () => {};
const DEFAULT_CALLBACKS: NodeCallbacks = {
  onTitleChange: NOOP,
  onDelete: NOOP,
  onDuplicate: NOOP,
  onCut: NOOP,
  onCopy: NOOP,
  onPaste: NOOP,
  onDisconnect: NOOP,
  onConnectTo: NOOP,
  onRename: NOOP,
  onGenerate: NOOP,
  onLock: NOOP,
  onColorTag: NOOP,
  onCopyPromptForAI: NOOP,
  onUpload: NOOP,
  onSelectVariant: NOOP,
  onToggleSeedLock: NOOP,
  onToggleCollapse: NOOP,
  onOpacityChange: NOOP,
  onCloneVideo: NOOP,
};

export const NodeCallbacksContext = createContext<NodeCallbacks>(DEFAULT_CALLBACKS);

export function useNodeCallbacks(): NodeCallbacks {
  return useContext(NodeCallbacksContext);
}
