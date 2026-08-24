/** UI effects a tool can declare — renderer dispatches these on tool completion. */
export type UiEffect =
  | { kind: 'entity.refresh'; entity: string }
  | { kind: 'canvas.refresh' }
  | { kind: 'canvas.dispatch'; action: unknown }
  | { kind: 'toast'; message: string }
  | { kind: 'focus-node'; nodeId: string };
