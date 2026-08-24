import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '../../../store/index.js';
import { setPosition, setSize } from '../../../store/slices/commander.js';

export const COMMANDER_MIN_WIDTH = 300;
const MIN_HEIGHT = 440;
const SAFE_Y = 56;
const SAFE_MARGIN = 8;

export function getCommanderResizeWidthBounds(viewportWidth: number): {
  min: number;
  max: number;
} {
  const max = Math.max(COMMANDER_MIN_WIDTH, viewportWidth - SAFE_MARGIN * 2);
  return { min: Math.min(COMMANDER_MIN_WIDTH, max), max };
}

export function clampPanelPosition(
  position: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: Math.min(
      Math.max(SAFE_MARGIN, position.x),
      Math.max(SAFE_MARGIN, viewport.width - size.width - SAFE_MARGIN),
    ),
    y: Math.min(
      Math.max(SAFE_Y, position.y),
      Math.max(SAFE_Y, viewport.height - size.height - SAFE_MARGIN),
    ),
  };
}

export function clampPanelGeometry(
  position: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { position: { x: number; y: number }; size: { width: number; height: number } } {
  const { max: maxWidth } = getCommanderResizeWidthBounds(viewport.width);
  const maxHeight = Math.max(320, viewport.height - SAFE_Y - SAFE_MARGIN);
  const width = Math.min(
    maxWidth,
    Math.max(Math.min(COMMANDER_MIN_WIDTH, maxWidth), size.width),
  );
  const height = Math.min(maxHeight, Math.max(Math.min(MIN_HEIGHT, maxHeight), size.height));
  return {
    position: clampPanelPosition(position, { width, height }, viewport),
    size: { width, height },
  };
}

interface UsePanelDragOptions {
  panelRef: RefObject<HTMLElement | null>;
  open: boolean;
  position: { x: number; y: number };
  size: { width: number; height: number };
  /** Width added by an outward-opening child column; not persisted as chat width. */
  widthOffset?: number;
}

export function usePanelDrag({
  panelRef,
  open,
  position,
  size,
  widthOffset = 0,
}: UsePanelDragOptions): void {
  const dispatch = useDispatch<AppDispatch>();

  useEffect(() => {
    if (!open) return;

    const onDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;

      const dragOrigin = target.closest<HTMLElement>('[data-drag-origin="true"]');
      const resizeOrigin = target.closest<HTMLElement>('[data-resize-origin="true"]');
      if (!dragOrigin && !resizeOrigin) return;

      let frameId = 0;
      let pending: { x: number; y: number; width: number; height: number } | null = null;

      const flush = () => {
        frameId = 0;
        const panel = panelRef.current;
        if (!panel || !pending) return;
        if (dragOrigin) {
          panel.style.left = `${pending.x}px`;
          panel.style.top = `${pending.y}px`;
        } else {
          panel.style.width = `${pending.width}px`;
          panel.style.height = `${pending.height}px`;
        }
      };

      const onMouseMove = (moveEvent: MouseEvent) => {
        if (dragOrigin) {
          const startX = Number(dragOrigin.dataset.dragStartX ?? moveEvent.clientX);
          const startY = Number(dragOrigin.dataset.dragStartY ?? moveEvent.clientY);
          if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 4) return;
          dragOrigin.dataset.dragMoved = 'true';
          const offsetX = Number(dragOrigin.dataset.dragOffsetX ?? '0');
          const offsetY = Number(dragOrigin.dataset.dragOffsetY ?? '0');
          const panel = panelRef.current;
          const clamped = clampPanelGeometry(
            { x: moveEvent.clientX - offsetX, y: moveEvent.clientY - offsetY },
            panel
              ? { width: panel.offsetWidth, height: panel.offsetHeight }
              : { width: size.width + widthOffset, height: size.height },
            { width: window.innerWidth, height: window.innerHeight },
          );
          pending = {
            x: clamped.position.x,
            y: clamped.position.y,
            width: 0,
            height: 0,
          };
        } else if (resizeOrigin) {
          const startX = Number(resizeOrigin.dataset.resizeStartX ?? '0');
          const startY = Number(resizeOrigin.dataset.resizeStartY ?? '0');
          const startWidth = Number(
            resizeOrigin.dataset.resizeStartWidth ?? size.width + widthOffset,
          );
          const startHeight = Number(resizeOrigin.dataset.resizeStartHeight ?? size.height);
          const clamped = clampPanelGeometry(
            { x: position.x, y: position.y },
            {
              width: Math.max(
                COMMANDER_MIN_WIDTH + widthOffset,
                startWidth + moveEvent.clientX - startX,
              ),
              height: Math.max(MIN_HEIGHT, startHeight + moveEvent.clientY - startY),
            },
            { width: window.innerWidth, height: window.innerHeight },
          );
          pending = {
            x: 0,
            y: 0,
            width: clamped.size.width,
            height: clamped.size.height,
          };
        }
        if (!frameId) frameId = requestAnimationFrame(flush);
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (frameId) cancelAnimationFrame(frameId);
        flush();

        const panel = panelRef.current;
        if (dragOrigin) {
          if (panel) {
            dispatch(setPosition({ x: parseInt(panel.style.left), y: parseInt(panel.style.top) }));
          }
          delete dragOrigin.dataset.dragOrigin;
          delete dragOrigin.dataset.dragOffsetX;
          delete dragOrigin.dataset.dragOffsetY;
          delete dragOrigin.dataset.dragStartX;
          delete dragOrigin.dataset.dragStartY;
        } else if (resizeOrigin) {
          if (panel) {
            dispatch(
              setSize({
                width: Math.max(COMMANDER_MIN_WIDTH, parseInt(panel.style.width) - widthOffset),
                height: parseInt(panel.style.height),
              }),
            );
          }
          delete resizeOrigin.dataset.resizeOrigin;
          delete resizeOrigin.dataset.resizeStartX;
          delete resizeOrigin.dataset.resizeStartY;
          delete resizeOrigin.dataset.resizeStartWidth;
          delete resizeOrigin.dataset.resizeStartHeight;
        }
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousedown', onDocumentMouseDown);
    const clampToViewport = () => {
      const clamped = clampPanelGeometry(
        { x: position.x, y: position.y },
        { width: size.width + widthOffset, height: size.height },
        { width: window.innerWidth, height: window.innerHeight },
      );
      const currentX = position.x;
      const currentY = position.y;
      if (currentX !== clamped.position.x || currentY !== clamped.position.y) {
        dispatch(setPosition(clamped.position));
      }
      const persistedWidth = clamped.size.width - widthOffset;
      if (persistedWidth !== size.width || clamped.size.height !== size.height) {
        dispatch(setSize({ width: persistedWidth, height: clamped.size.height }));
      }
    };
    window.addEventListener('resize', clampToViewport);
    clampToViewport();
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      window.removeEventListener('resize', clampToViewport);
    };
  }, [dispatch, open, panelRef, position.x, position.y, size.height, size.width, widthOffset]);
}
