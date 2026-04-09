import * as ContextMenu from '@radix-ui/react-context-menu';
import type { CanvasNodeType } from '@lucid-fin/contracts';
import { t } from '../../i18n.js';
import {
  Check,
  ChevronRight,
  Clipboard,
  ClipboardCopy,
  Copy,
  Link2,
  Lock,
  Pencil,
  Scissors,
  Share,
  Sparkles,
  Tag,
  Trash2,
  Unlock,
  Unplug,
} from 'lucide-react';

const ITEM =
  'flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground';

const COLOR_TAGS = [
  { label: () => t('colors.red'), color: '#ef4444' },
  { label: () => t('colors.orange'), color: '#f97316' },
  { label: () => t('colors.yellow'), color: '#eab308' },
  { label: () => t('colors.green'), color: '#22c55e' },
  { label: () => t('colors.blue'), color: '#3b82f6' },
  { label: () => t('colors.purple'), color: '#a855f7' },
] as const;

interface NodeContextMenuProps {
  children: React.ReactNode;
  nodeId: string;
  nodeType: CanvasNodeType;
  locked: boolean;
  colorTag?: string;
  onRename: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onCut: (id: string) => void;
  onCopy: (id: string) => void;
  onPaste: (id: string) => void;
  onDisconnect: (id: string) => void;
  onConnectTo?: (id: string) => void;
  onLock: (id: string) => void;
  onGenerate: (id: string) => void;
  onCopyPromptForAI?: (id: string) => void;
  onColorTag: (id: string, color: string | undefined) => void;
}

export function NodeContextMenu({
  children,
  nodeId,
  nodeType,
  locked,
  colorTag,
  onRename,
  onDelete,
  onDuplicate,
  onCut,
  onCopy,
  onPaste,
  onDisconnect,
  onConnectTo,
  onLock,
  onGenerate,
  onCopyPromptForAI,
  onColorTag,
}: NodeContextMenuProps) {
  const canGenerate = nodeType !== 'text' && nodeType !== 'backdrop';
  const canConnect = nodeType !== 'backdrop';

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger className="contents">{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="min-w-[160px] rounded-md border border-border/60 bg-card p-0.5 text-popover-foreground shadow-lg z-50">
          <ContextMenu.Item className={ITEM} onSelect={() => onRename(nodeId)}>
            <Pencil className="w-3.5 h-3.5" />
            {t('contextMenu.rename')}
          </ContextMenu.Item>
          <ContextMenu.Item className={ITEM} onSelect={() => onDuplicate(nodeId)}>
            <Copy className="w-3.5 h-3.5" />
            {t('contextMenu.duplicate')}
          </ContextMenu.Item>
          <ContextMenu.Separator className="h-px my-1 bg-border" />
          <ContextMenu.Item className={ITEM} onSelect={() => onCut(nodeId)}>
            <Scissors className="w-3.5 h-3.5" />
            {t('contextMenu.cut')}
          </ContextMenu.Item>
          <ContextMenu.Item className={ITEM} onSelect={() => onCopy(nodeId)}>
            <ClipboardCopy className="w-3.5 h-3.5" />
            {t('contextMenu.copy')}
          </ContextMenu.Item>
          <ContextMenu.Item className={ITEM} onSelect={() => onPaste(nodeId)}>
            <Clipboard className="w-3.5 h-3.5" />
            {t('contextMenu.paste')}
          </ContextMenu.Item>
          <ContextMenu.Separator className="h-px my-1 bg-border" />
          <ContextMenu.Item className={ITEM} onSelect={() => onDisconnect(nodeId)}>
            <Unplug className="w-3.5 h-3.5" />
            {t('contextMenu.disconnectAll')}
          </ContextMenu.Item>
          {canConnect && onConnectTo && (
            <ContextMenu.Item className={ITEM} onSelect={() => onConnectTo(nodeId)}>
              <Link2 className="w-3.5 h-3.5" />
              {t('contextMenu.connectTo')}
            </ContextMenu.Item>
          )}
          <ContextMenu.Separator className="h-px my-1 bg-border" />
          <ContextMenu.Item className={ITEM} onSelect={() => onLock(nodeId)}>
            {locked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            {locked ? t('contextMenu.unlock') : t('contextMenu.lock')}
          </ContextMenu.Item>
          {canGenerate && (
            <ContextMenu.Item className={ITEM} onSelect={() => onGenerate(nodeId)}>
              <Sparkles className="w-3.5 h-3.5" />
              {t('contextMenu.generate')}
            </ContextMenu.Item>
          )}
          {onCopyPromptForAI && (
            <ContextMenu.Item className={ITEM} onSelect={() => onCopyPromptForAI(nodeId)}>
              <Share className="w-3.5 h-3.5" />
              {t('contextMenu.copyPromptForAI') || 'Copy Prompt for AI'}
            </ContextMenu.Item>
          )}
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={ITEM}>
              <Tag className="w-3.5 h-3.5" />
              {t('contextMenu.colorTag')}
              <ChevronRight className="ml-auto w-3.5 h-3.5" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className="min-w-[130px] rounded-md border border-border/60 bg-card p-0.5 text-popover-foreground shadow-lg z-50">
                {COLOR_TAGS.map((tag) => (
                  <ContextMenu.Item
                    key={tag.color}
                    className={ITEM}
                    onSelect={() => onColorTag(nodeId, tag.color)}
                  >
                    <span
                      className="h-3 w-3 rounded-full border border-border/50"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.label()}
                    {colorTag === tag.color && <Check className="ml-auto w-3.5 h-3.5" />}
                  </ContextMenu.Item>
                ))}
                <ContextMenu.Separator className="h-px my-1 bg-border" />
                <ContextMenu.Item className={ITEM} onSelect={() => onColorTag(nodeId, undefined)}>
                  <span className="h-3 w-3 rounded-full border border-dashed border-muted-foreground/60" />
                  {t('contextMenu.clear')}
                  {colorTag == null && <Check className="ml-auto w-3.5 h-3.5" />}
                </ContextMenu.Item>
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
          <ContextMenu.Separator className="h-px my-1 bg-border" />
          <ContextMenu.Item
            className="flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer outline-none hover:bg-destructive/20 hover:text-destructive"
            onSelect={() => onDelete(nodeId)}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('action.delete')}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
