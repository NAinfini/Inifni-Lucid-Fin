import { createContext, useContext } from 'react';
import type { Attachment } from './CommanderInputBar.js';
import type { SlashCommand } from './useSlashCommands.js';
import type { ContextUsage } from '../../../commander/state/context-usage.js';
import type { CanvasNode } from '@lucid-fin/contracts';

interface CommanderContextType {
  // Text input
  input: string;
  setInput: (value: string) => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  attachments: Attachment[];
  setAttachments: React.Dispatch<React.SetStateAction<Attachment[]>>;

  // Dropdown toggles
  modelPickerOpen: boolean;
  setModelPickerOpen: (open: boolean) => void;
  permPickerOpen: boolean;
  setPermPickerOpen: (open: boolean) => void;
  nodePickerOpen: boolean;
  setNodePickerOpen: (open: boolean) => void;

  // Queue editing
  editingQueueIndex: number | null;
  setEditingQueueIndex: (index: number | null) => void;
  editingQueueText: string;
  setEditingQueueText: (text: string) => void;

  // Slash commands
  slashMenuRef: React.RefObject<HTMLDivElement | null>;
  slashMenuOpen: boolean;
  slashMenuIndex: number;
  setSlashMenuIndex: React.Dispatch<React.SetStateAction<number>>;
  filteredSlashItems: SlashCommand[];
  executeSlashCommand: (name: string) => Promise<void>;
  SLASH_COMMANDS: SlashCommand[];

  // Canvas/context data
  canvasNodes: CanvasNode[] | undefined;
  contextUsage: ContextUsage | null;

  // Utilities
  triggerCompact: () => Promise<void>;
  userScrolledUpRef: React.RefObject<boolean>;
  isBackendReady: boolean;
  t: (key: string) => string;
}

const CommanderContext = createContext<CommanderContextType | null>(null);

export function useCommanderCtx(): CommanderContextType {
  const ctx = useContext(CommanderContext);
  if (!ctx) throw new Error('useCommanderCtx must be used within CommanderProvider');
  return ctx;
}

export { CommanderContext };
export type { CommanderContextType };
