import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../store/index.js';
import { setPosition, setSize } from '../../../store/slices/commander.js';

const MIN_WIDTH = 320;
const MIN_HEIGHT = 400;
const SAFE_Y = 56;

interface UsePanelDragOptions {
  panelRef: RefObject<HTMLElement | null>;
  open: boolean;
  size: { width: number; height: number };
}

/**
 * Drag + resize support for the floating Commander panel.
 *
 * Listeners are only attached on mousedown inside a drag/resize origin — NOT
 * while the panel is merely open. An always-on `mousemove` listener (even an
 * early-returning one) still runs hundreds of times per second anywhere the
 * user moves the cursor and causes measurable canvas lag on lower-end GPUs.
 */
export function usePanelDrag({ panelRef, open, size }: UsePanelDragOptions): void {
  const dispatch = useDispatch<AppDispatch>();
  useEffect(() => {
    if (!open) return;

    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const dragOrigin = target.closest<HTMLElement>('[data-drag-origin="true"]');
      const resizeOrigin = target.closest<HTMLElement>('[data-resize-origin="true"]');
      if (!dragOrigin && !resizeOrigin) return;

      let rafId = 0;
      let pending: { x: number; y: number; w: number; h: number } | null = null;

      const flush = () => {
        rafId = 0;
        const el = panelRef.current;
        if (!el || !pending) return;
        if (dragOrigin) {
          el.style.left = `${pending.x}px`;
          el.style.top = `${pending.y}px`;
        } else {
          el.style.width = `${pending.w}px`;
          el.style.height = `${pending.h}px`;
        }
      };

      const handleMove = (ev: MouseEvent) => {
        if (dragOrigin) {
          const offsetX = Number(dragOrigin.dataset.dragOffsetX ?? '0');
          const offsetY = Number(dragOrigin.dataset.dragOffsetY ?? '0');
          pending = {
            x: Math.max(8, ev.clientX - offsetX),
            y: Math.max(SAFE_Y, ev.clientY - offsetY),
            w: 0, h: 0,
          };
        } else if (resizeOrigin) {
          const startX = Number(resizeOrigin.dataset.resizeStartX ?? '0');
          const startY = Number(resizeOrigin.dataset.resizeStartY ?? '0');
          const startWidth = Number(resizeOrigin.dataset.resizeStartWidth ?? String(size.width));
          const startHeight = Number(resizeOrigin.dataset.resizeStartHeight ?? String(size.height));
          pending = {
            x: 0, y: 0,
            w: Math.max(MIN_WIDTH, startWidth + (ev.clientX - startX)),
            h: Math.max(MIN_HEIGHT, startHeight + (ev.clientY - startY)),
          };
        }
        if (!rafId) rafId = requestAnimationFrame(flush);
      };

      const handleUp = () => {
        document.removeEventListener('mousemove', handleMove);
        document.removeEventListener('mouseup', handleUp);
        if (rafId) cancelAnimationFrame(rafId);
        flush();
        const el = panelRef.current;
        if (dragOrigin) {
          if (el) {
            dispatch(setPosition({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
          }
          delete dragOrigin.dataset.dragOrigin;
          delete dragOrigin.dataset.dragOffsetX;
          delete dragOrigin.dataset.dragOffsetY;
        } else if (resizeOrigin) {
          if (el) {
            dispatch(setSize({ width: parseInt(el.style.width), height: parseInt(el.style.height) }));
          }
          delete resizeOrigin.dataset.resizeOrigin;
          delete resizeOrigin.dataset.resizeStartX;
          delete resizeOrigin.dataset.resizeStartY;
          delete resizeOrigin.dataset.resizeStartWidth;
          delete resizeOrigin.dataset.resizeStartHeight;
        }
      };

      document.addEventListener('mousemove', handleMove);
      document.addEventListener('mouseup', handleUp);
    };

    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [dispatch, open, panelRef, size.height, size.width]);
}
