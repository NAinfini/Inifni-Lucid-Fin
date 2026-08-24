import type { Canvas } from '@lucid-fin/contracts';

export interface CanvasDocument {
  version: '1.0';
  exportedAt: number;
  canvas: Pick<Canvas, 'name' | 'nodes' | 'edges' | 'viewport'>;
}

export function createCanvasDocument(canvas: Canvas): CanvasDocument {
  return {
    version: '1.0',
    exportedAt: Date.now(),
    canvas: {
      name: canvas.name,
      nodes: JSON.parse(JSON.stringify(canvas.nodes)) as Canvas['nodes'],
      edges: JSON.parse(JSON.stringify(canvas.edges)) as Canvas['edges'],
      viewport: JSON.parse(JSON.stringify(canvas.viewport)) as Canvas['viewport'],
    },
  };
}

export function downloadCanvasDocument(canvas: Canvas): void {
  const canvasDocument = createCanvasDocument(canvas);
  const blob = new Blob([JSON.stringify(canvasDocument, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = `${canvas.name.replace(/\s+/g, '-').toLowerCase() || 'canvas'}.lucid-canvas.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
