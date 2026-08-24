import { describe, expect, it } from 'vitest';
import {
  COMMANDER_MIN_WIDTH,
  clampPanelGeometry,
  clampPanelPosition,
  getCommanderResizeWidthBounds,
} from './usePanelDrag.js';

describe('Commander panel viewport bounds', () => {
  it('keeps a normal panel fully recoverable at every viewport edge', () => {
    expect(
      clampPanelGeometry(
        { x: 900, y: 700 },
        { width: 500, height: 500 },
        { width: 1_000, height: 800 },
      ),
    ).toEqual({
      position: { x: 492, y: 292 },
      size: { width: 500, height: 500 },
    });
  });

  it('shrinks an oversized saved panel to the usable viewport', () => {
    expect(
      clampPanelGeometry(
        { x: -50, y: -50 },
        { width: 1_200, height: 1_000 },
        { width: 1_000, height: 800 },
      ),
    ).toEqual({
      position: { x: 8, y: 56 },
      size: { width: 984, height: 736 },
    });
  });

  it('allows the Commander chat column to shrink to its 300 pixel minimum', () => {
    expect(
      clampPanelGeometry(
        { x: 0, y: 0 },
        { width: 200, height: 500 },
        { width: 1_000, height: 800 },
      ),
    ).toEqual({
      position: { x: 8, y: 56 },
      size: { width: COMMANDER_MIN_WIDTH, height: 500 },
    });
  });

  it('uses the same 300 pixel minimum for the keyboard resize control ARIA bounds', () => {
    expect(getCommanderResizeWidthBounds(1_000)).toEqual({ min: COMMANDER_MIN_WIDTH, max: 984 });
    expect(getCommanderResizeWidthBounds(260)).toEqual({ min: COMMANDER_MIN_WIDTH, max: 300 });
  });

  it('clamps the compact pill using its rendered size instead of the full window size', () => {
    expect(
      clampPanelPosition(
        { x: 990, y: 790 },
        { width: 150, height: 44 },
        { width: 1_000, height: 800 },
      ),
    ).toEqual({ x: 842, y: 748 });
  });
});
