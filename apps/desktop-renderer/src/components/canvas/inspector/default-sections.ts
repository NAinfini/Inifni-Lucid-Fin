/**
 * Default inspector section plugins.
 *
 * This module registers the "bottom" sections that currently live inside
 * InspectorPanel below the creative/context tabs.  Importing this module
 * (side-effect import) is enough to register them.
 *
 * Sections extracted:
 *  1. Annotation (M7) -- generation nodes only
 *  2. Tags & Groups (M9) -- all nodes
 *  3. Advanced Generation Params (L17) -- image/video nodes only
 *  4. Generation History (M10) -- generation nodes with history
 */
import { createElement } from 'react';
import { inspectorRegistry, type InspectorSectionProps } from './inspector-registry.js';
import { isGenerationNode } from './guardTypes.js';
import type { ImageNodeData, VideoNodeData, AudioNodeData } from '@lucid-fin/contracts';

// ---------------------------------------------------------------------------
// Lazy wrappers -- the actual React components are defined below and
// rendered via createElement so this file stays a plain .ts module.
// ---------------------------------------------------------------------------

import { AnnotationSection } from './sections/AnnotationSection.js';
import { TagsSection } from './sections/TagsSection.js';
import { AdvancedParamsSection } from './sections/AdvancedParamsSection.js';
import { GenerationHistorySection } from './sections/GenerationHistorySection.js';

// ---------------------------------------------------------------------------
// 1. Annotation (M7) -- generation nodes (image / video / audio)
// ---------------------------------------------------------------------------
inspectorRegistry.register({
  id: 'annotation',
  tab: 'bottom',
  nodeTypes: ['image', 'video', 'audio'],
  order: 100,
  shouldRender: (node) => isGenerationNode(node),
  render: (props: InspectorSectionProps) => createElement(AnnotationSection, props),
});

// ---------------------------------------------------------------------------
// 2. Tags & Groups (M9) -- all node types
// ---------------------------------------------------------------------------
inspectorRegistry.register({
  id: 'tags',
  tab: 'bottom',
  nodeTypes: [],
  order: 200,
  render: (props: InspectorSectionProps) => createElement(TagsSection, props),
});

// ---------------------------------------------------------------------------
// 3. Advanced Generation Params (L17) -- image / video only
// ---------------------------------------------------------------------------
inspectorRegistry.register({
  id: 'advanced-params',
  tab: 'bottom',
  nodeTypes: ['image', 'video'],
  order: 300,
  shouldRender: (node) => isGenerationNode(node) && node.type !== 'audio',
  render: (props: InspectorSectionProps) => createElement(AdvancedParamsSection, props),
});

// ---------------------------------------------------------------------------
// 4. Generation History (M10) -- generation nodes with entries
// ---------------------------------------------------------------------------
inspectorRegistry.register({
  id: 'generation-history',
  tab: 'bottom',
  nodeTypes: ['image', 'video', 'audio'],
  order: 400,
  shouldRender: (node) => {
    if (!isGenerationNode(node)) return false;
    const data = node.data as ImageNodeData | VideoNodeData | AudioNodeData;
    const history = (data as { generationHistory?: unknown[] }).generationHistory;
    return Array.isArray(history) && history.length > 0;
  },
  render: (props: InspectorSectionProps) => createElement(GenerationHistorySection, props),
});
