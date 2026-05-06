import type { EdgeStatus } from '@lucid-fin/contracts';

export const NODE_MINIMAP_COLORS: Record<string, string> = {
  text: '#ffffff',
  image: '#3b82f6',
  video: '#a855f7',
  audio: '#22c55e',
  backdrop: '#334155',
};

export const EDGE_STATUS_COLORS: Record<EdgeStatus, string> = {
  idle: '#4b5563',
  generating: '#d97706',
  done: '#16a34a',
  failed: '#dc2626',
};

export const DEPENDENCY_ROLE_COLORS = {
  upstream: '#f59e0b',
  downstream: '#38bdf8',
  focus: '#a855f7',
} as const;

export const COLOR_TAG_VALUES = {
  red: '#ef4444',
  orange: '#f97316',
  yellow: '#eab308',
  green: '#22c55e',
  blue: '#3b82f6',
  purple: '#a855f7',
} as const;

export const BACKDROP_DEFAULT_COLOR = '#334155';

export const BACKDROP_SWATCHES = [
  '#334155',
  '#1e3a5f',
  '#3b1f5e',
  '#5c1a1a',
  '#1a4d2e',
  '#4a3728',
  '#4b5563',
  '#0f766e',
] as const;
