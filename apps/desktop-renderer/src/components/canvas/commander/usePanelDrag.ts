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

export function usePanelDrag({ panelRef, open, size }: UsePanelDragOptions): void {
  const dispatch = useDispatch<AppDispatch>();
  // Drag handler
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const target = document.querySelector<HTMLElement>('[data-drag-origin="true"]');
      if (!target) {
        return;
      }
      const offsetX = Number(target.dataset.dragOffsetX ?? '0');
      const offsetY = Number(target.dataset.dragOffsetY ?? '0');
      const x = Math.max(8, event.clientX - offsetX);
      const y = Math.max(SAFE_Y, event.clientY - offsetY);
      // Direct DOM update — skip Redux during drag
      const el = panelRef.current;
      if (el) {
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
      }
    };

    const handleMouseUp = () => {
      const dragOrigin = document.querySelector<HTMLElement>('[data-drag-origin="true"]');
      if (dragOrigin) {
        // Commit final position to Redux
        const el = panelRef.current;
        if (el) {
          dispatch(setPosition({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
        }
        delete dragOrigin.dataset.dragOrigin;
        delete dragOrigin.dataset.dragOffsetX;
        delete dragOrigin.dataset.dragOffsetY;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dispatch, open, panelRef]);

  // Resize handler
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleMouseMove = (event: MouseEvent) => {
      const target = document.querySelector<HTMLElement>('[data-resize-origin="true"]');
      if (!target) {
        return;
      }
      const startX = Number(target.dataset.resizeStartX ?? '0');
      const startY = Number(target.dataset.resizeStartY ?? '0');
      const startWidth = Number(target.dataset.resizeStartWidth ?? String(size.width));
      const startHeight = Number(target.dataset.resizeStartHeight ?? String(size.height));
      const w = Math.max(MIN_WIDTH, startWidth + (event.clientX - startX));
      const h = Math.max(MIN_HEIGHT, startHeight + (event.clientY - startY));
      // Direct DOM update — skip Redux during drag
      const el = panelRef.current;
      if (el) {
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
      }
    };

    const handleMouseUp = () => {
      const resizeOrigin = document.querySelector<HTMLElement>('[data-resize-origin="true"]');
      if (resizeOrigin) {
        // Commit final size to Redux
        const el = panelRef.current;
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

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dispatch, open, panelRef, size.height, size.width]);
}
