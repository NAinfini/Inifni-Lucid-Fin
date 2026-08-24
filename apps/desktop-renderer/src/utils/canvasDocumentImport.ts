import type { Canvas } from '@lucid-fin/contracts';
import type { CanvasDocument } from './canvasDocumentExport.js';

function isCanvasDocument(input: unknown): input is CanvasDocument {
  if (!input || typeof input !== 'object') return false;
  const candidate = input as Partial<CanvasDocument>;
  return (
    candidate.version === '1.0' &&
    !!candidate.canvas &&
    Array.isArray(candidate.canvas.nodes) &&
    Array.isArray(candidate.canvas.edges)
  );
}

export async function readCanvasDocument(file: File): Promise<CanvasDocument> {
  const content = await file.text();
  const parsed = JSON.parse(content) as unknown;
  if (!isCanvasDocument(parsed)) {
    throw new Error('Invalid canvas document');
  }
  return parsed;
}

export function materializeImportedCanvas(args: {
  document: CanvasDocument;
  canvasId: string;
  name?: string;
}): Canvas {
  const now = Date.now();
  return {
    id: args.canvasId,
    name: args.name ?? args.document.canvas.name,
    nodes: JSON.parse(JSON.stringify(args.document.canvas.nodes)) as Canvas['nodes'],
    edges: JSON.parse(JSON.stringify(args.document.canvas.edges)) as Canvas['edges'],
    viewport: JSON.parse(JSON.stringify(args.document.canvas.viewport)) as Canvas['viewport'],
    createdAt: now,
    updatedAt: now,
    notes: [],
  };
}
