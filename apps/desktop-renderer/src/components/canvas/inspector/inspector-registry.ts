import type { ReactNode } from 'react';
import type { Dispatch, UnknownAction } from '@reduxjs/toolkit';
import type { Canvas, CanvasNode } from '@lucid-fin/contracts';

/**
 * Inspector tab type matching the existing two-tab system.
 *
 * Sections with `tab: 'bottom'` render below both tabs (always visible
 * regardless of which tab is active), preserving the current layout where
 * annotation, tags, advanced-params and generation-history sit outside the
 * tab panels.
 */
export type InspectorTab = 'creative' | 'context' | 'bottom';

/**
 * Props handed to every section's render function.
 */
export interface InspectorSectionProps {
  node: CanvasNode;
  canvas: Canvas;
  canvasId: string;
  /** Redux dispatch */
  dispatch: Dispatch<UnknownAction>;
  /** i18n translate */
  t: (key: string) => string;
}

/**
 * A single pluggable section inside the inspector panel.
 *
 * Node types register these via `inspectorRegistry.register(...)`.
 * InspectorPanel queries the registry to decide what to render.
 */
export interface InspectorSectionPlugin {
  /** Unique identifier */
  id: string;
  /** Which tab this section appears in */
  tab: InspectorTab;
  /** Node types this section applies to. Empty array = all node types. */
  nodeTypes: string[];
  /** Display order within the tab (lower number = rendered first) */
  order: number;
  /** Optional section header label */
  label?: string;
  /** Runtime guard -- return false to skip rendering */
  shouldRender?: (node: CanvasNode, canvas: Canvas) => boolean;
  /** Render the section content */
  render: (props: InspectorSectionProps) => ReactNode;
}

class InspectorRegistryImpl {
  private sections: InspectorSectionPlugin[] = [];

  /**
   * Register a section plugin. If a plugin with the same `id` already
   * exists it is replaced (idempotent re-registration).
   */
  register(section: InspectorSectionPlugin): void {
    this.sections = this.sections.filter((s) => s.id !== section.id);
    this.sections.push(section);
    this.sections.sort((a, b) => a.order - b.order);
  }

  /**
   * Return all sections applicable to the given tab + node, pre-sorted
   * by `order`.
   */
  getSections(tab: InspectorTab, node: CanvasNode, canvas: Canvas): InspectorSectionPlugin[] {
    return this.sections.filter((s) => {
      if (s.tab !== tab) return false;
      if (s.nodeTypes.length > 0 && !s.nodeTypes.includes(node.type)) return false;
      if (s.shouldRender && !s.shouldRender(node, canvas)) return false;
      return true;
    });
  }

  /** Remove all registered sections (useful for testing). */
  clear(): void {
    this.sections = [];
  }
}

/** Singleton registry instance -- imported by InspectorPanel and section modules. */
export const inspectorRegistry = new InspectorRegistryImpl();
