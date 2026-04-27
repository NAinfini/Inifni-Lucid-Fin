import type { Canvas, ImageNodeData, VideoNodeData, AudioNodeData } from '@lucid-fin/contracts';
import { isVisualMedia, matchNode } from '@lucid-fin/shared-utils';

function readNegativePrompt(data: ImageNodeData | VideoNodeData): string | undefined {
  if (
    'negativePrompt' in data &&
    typeof data.negativePrompt === 'string' &&
    data.negativePrompt.trim()
  ) {
    return data.negativePrompt;
  }
  return undefined;
}

/**
 * Build a structured prompt for external AI tools (ChatGPT, DeepSeek, etc.)
 * Contains node context, connected nodes, presets, and instructions for the AI
 * to output in a format the app can parse.
 */
export function buildExternalAIPrompt(
  canvas: Canvas,
  nodeId: string,
  presetSummaryByNodeId?: Record<string, string>,
): string {
  const node = canvas.nodes.find((n) => n.id === nodeId);
  if (!node) return '';

  const lines: string[] = [];
  lines.push(`# Lucid Fin — AI Prompt Context`);
  lines.push('');
  lines.push(`## Node: ${node.title} (${node.type})`);

  // Node-specific data
  matchNode(node.type, {
    image: () => {
      const data = node.data as ImageNodeData;
      if (data.prompt) lines.push(`**Current Prompt:** ${data.prompt}`);
      const negativePrompt = readNegativePrompt(data);
      if (negativePrompt) lines.push(`**Negative Prompt:** ${negativePrompt}`);
    },
    video: () => {
      const data = node.data as VideoNodeData;
      if (data.prompt) lines.push(`**Current Prompt:** ${data.prompt}`);
      const negativePrompt = readNegativePrompt(data);
      if (negativePrompt) lines.push(`**Negative Prompt:** ${negativePrompt}`);
      if (data.duration) lines.push(`**Duration:** ${data.duration}s`);
    },
    audio: () => {
      const data = node.data as AudioNodeData;
      if (data.prompt) lines.push(`**Current Prompt:** ${data.prompt}`);
    },
    text: () => {
      const data = node.data as { content?: string };
      if (data.content) lines.push(`**Content:** ${data.content}`);
    },
    backdrop: () => {},
  });

  // Preset summary
  const presetSummary = presetSummaryByNodeId?.[nodeId];
  if (presetSummary) {
    lines.push(`**Applied Presets:** ${presetSummary}`);
  }

  // Connected nodes
  const connectedEdges = canvas.edges.filter(
    (e) => e.source === nodeId || e.target === nodeId,
  );
  if (connectedEdges.length > 0) {
    lines.push('');
    lines.push('## Connected Nodes');
    for (const edge of connectedEdges) {
      const otherId = edge.source === nodeId ? edge.target : edge.source;
      const other = canvas.nodes.find((n) => n.id === otherId);
      if (!other) continue;
      const direction = edge.source === nodeId ? 'output →' : 'input ←';
      lines.push(`- ${direction} **${other.title}** (${other.type})`);
      const otherPreset = presetSummaryByNodeId?.[otherId];
      if (otherPreset) lines.push(`  Presets: ${otherPreset}`);
    }
  }

  // Instructions for external AI
  lines.push('');
  lines.push('## Instructions');
  lines.push('Please generate a detailed prompt for this node. You can output in this tagged format so I can paste it back:');
  lines.push('```');
  if (isVisualMedia(node.type)) {
    lines.push('[prompt] Your detailed generation prompt here...');
    lines.push('[negative] Things to avoid...');
    if (node.type === 'video') {
      lines.push('[camera] camera movement preset name');
      lines.push('[emotion] emotion preset name');
    }
  } else if (node.type === 'audio') {
    lines.push('[prompt] Audio description or text to speak...');
  } else {
    lines.push('[content] Your text content here...');
  }
  lines.push('```');

  return lines.join('\n');
}
