import * as ContextMenu from '@radix-ui/react-context-menu';
import { Children, isValidElement, type ReactElement } from 'react';
import { AlignHorizontalJustifyCenter, AlignVerticalJustifyCenter, AlignStartHorizontal, AlignStartVertical, AlignEndHorizontal, AlignEndVertical, Clipboard, FileText, Image, LayoutTemplate, Redo2, Undo2, Upload, Video, Volume2 } from 'lucide-react';
import type { NodeKind } from '@lucid-fin/contracts';
import { t } from '../../i18n.js';

export type AlignDirection = 'left' | 'right' | 'top' | 'bottom' | 'centerH' | 'centerV';

interface CanvasContextMenuProps {
  children: React.ReactNode;
  onAddNode: (type: NodeKind, position: { x: number; y: number }) => void;
  onPaste?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onUploadMedia?: () => void;
  onAlign?: (direction: AlignDirection) => void;
  hasClipboard: boolean;
  selectedNodeCount?: number;
}

/** Stores the last right-click position for node creation */
let lastContextPos = { x: 0, y: 0 };

export function setContextMenuPosition(x: number, y: number) {
  lastContextPos = { x, y };
}

export function getContextMenuPosition() {
  return lastContextPos;
}

const ITEM =
  'flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer outline-none hover:bg-accent hover:text-accent-foreground';

function requireNativeTriggerChild(children: React.ReactNode): ReactElement {
  const child = Children.only(children);
  if (!isValidElement(child) || typeof child.type !== 'string') {
    throw new Error(
      'CanvasContextMenu requires a single native DOM element child so Radix can attach trigger props and refs safely.',
    );
  }
  return child;
}

const MENU_ITEMS: Array<{ type: NodeKind; label: string; icon: typeof FileText }> = [
  { type: 'text', label: 'contextMenu.addTextNode', icon: FileText },
  { type: 'image', label: 'contextMenu.addImageNode', icon: Image },
  { type: 'video', label: 'contextMenu.addVideoNode', icon: Video },
  { type: 'audio', label: 'contextMenu.addAudioNode', icon: Volume2 },
  { type: 'backdrop', label: 'contextMenu.addBackdropFrame', icon: LayoutTemplate },
];

const ALIGN_ITEMS: Array<{ dir: AlignDirection; labelKey: string; icon: typeof AlignStartHorizontal }> = [
  { dir: 'left', labelKey: 'contextMenu.alignLeft', icon: AlignStartHorizontal },
  { dir: 'right', labelKey: 'contextMenu.alignRight', icon: AlignEndHorizontal },
  { dir: 'top', labelKey: 'contextMenu.alignTop', icon: AlignStartVertical },
  { dir: 'bottom', labelKey: 'contextMenu.alignBottom', icon: AlignEndVertical },
  { dir: 'centerH', labelKey: 'contextMenu.alignCenterH', icon: AlignHorizontalJustifyCenter },
  { dir: 'centerV', labelKey: 'contextMenu.alignCenterV', icon: AlignVerticalJustifyCenter },
];

export function CanvasContextMenu({
  children,
  onAddNode,
  onPaste,
  onUndo,
  onRedo,
  onUploadMedia,
  onAlign,
  hasClipboard,
  selectedNodeCount = 0,
}: CanvasContextMenuProps) {
  const triggerChild = requireNativeTriggerChild(children);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{triggerChild}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="min-w-[170px] rounded-md border border-border/60 bg-card p-0.5 text-popover-foreground shadow-lg z-50">
          {MENU_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <ContextMenu.Item
                key={item.type}
                className={ITEM}
                onSelect={() => onAddNode(item.type, getContextMenuPosition())}
              >
                <Icon className="w-3.5 h-3.5" />
                {t(item.label)}
              </ContextMenu.Item>
            );
          })}
          <ContextMenu.Item
            className={ITEM}
            disabled={!onUploadMedia}
            onSelect={() => onUploadMedia?.()}
          >
            <Upload className="w-3.5 h-3.5" />
            {t('contextMenu.uploadMedia')}
          </ContextMenu.Item>
          <ContextMenu.Separator className="h-px my-1 bg-border" />
          {selectedNodeCount >= 2 && onAlign && (
            <>
              <ContextMenu.Sub>
                <ContextMenu.SubTrigger className={ITEM}>
                  <AlignHorizontalJustifyCenter className="w-3.5 h-3.5" />
                  {t('contextMenu.align')}
                </ContextMenu.SubTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.SubContent className="z-50 min-w-[160px] rounded-md border border-border/60 bg-card p-0.5 shadow-xl">
                    {ALIGN_ITEMS.map((item) => {
                      const Icon = item.icon;
                      return (
                        <ContextMenu.Item
                          key={item.dir}
                          className={ITEM}
                          onSelect={() => onAlign(item.dir)}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {t(item.labelKey)}
                        </ContextMenu.Item>
                      );
                    })}
                  </ContextMenu.SubContent>
                </ContextMenu.Portal>
              </ContextMenu.Sub>
              <ContextMenu.Separator className="h-px my-1 bg-border" />
            </>
          )}
          <ContextMenu.Item
            className={ITEM}
            disabled={!hasClipboard || !onPaste}
            onSelect={() => onPaste?.()}
          >
            <Clipboard className="w-3.5 h-3.5" />
            {t('contextMenu.paste')}
          </ContextMenu.Item>
          <ContextMenu.Item className={ITEM} onSelect={() => onUndo?.()}>
            <Undo2 className="w-3.5 h-3.5" />
            {t('action.undo')}
          </ContextMenu.Item>
          <ContextMenu.Item className={ITEM} onSelect={() => onRedo?.()}>
            <Redo2 className="w-3.5 h-3.5" />
            {t('action.redo')}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
