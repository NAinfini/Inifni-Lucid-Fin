/**
 * Typed in-process event bus.
 *
 * Callers declare their event map once as a type, then `createEventBus<Map>()`
 * gives back a bus whose `emit` and `on` are restricted to those keys and
 * payloads. Unknown keys and payload-shape drift are compile errors rather
 * than runtime silent misses.
 *
 * This primitive is deliberately decoupled from IPC. The renderer push path
 * (Phase F `RendererPushGateway`) uses a different primitive that crosses the
 * process boundary; `EventBus` stays in-process.
 */
export type EventMap = Record<string, unknown>;

export type EventHandler<P> = (payload: P) => void;

export type Unsubscribe = () => void;

export interface EventBus<E extends EventMap> {
  emit<K extends keyof E>(key: K, payload: E[K]): void;
  on<K extends keyof E>(key: K, handler: EventHandler<E[K]>): Unsubscribe;
  /**
   * Subscribe to every event keyed by `E`. Handlers receive the key plus the
   * (untyped) payload — used by diagnostic / tracing sinks. Prefer `on` for
   * feature code because the typed payload is what makes this primitive
   * valuable; `onAll` is the escape hatch.
   */
  onAll(handler: (key: keyof E, payload: E[keyof E]) => void): Unsubscribe;
  listenerCount<K extends keyof E>(key: K): number;
}

export function createEventBus<E extends EventMap>(): EventBus<E> {
  const listeners = new Map<keyof E, Set<EventHandler<unknown>>>();
  const wildcard = new Set<(key: keyof E, payload: E[keyof E]) => void>();

  return {
    emit(key, payload) {
      const set = listeners.get(key);
      if (set) {
        // Snapshot before invoking so handlers that unsubscribe mid-emit do
        // not mutate the set we're iterating.
        for (const handler of [...set]) {
          (handler as EventHandler<typeof payload>)(payload);
        }
      }
      if (wildcard.size > 0) {
        for (const handler of [...wildcard]) {
          handler(key, payload as E[keyof E]);
        }
      }
    },
    on(key, handler) {
      let set = listeners.get(key);
      if (!set) {
        set = new Set();
        listeners.set(key, set);
      }
      set.add(handler as EventHandler<unknown>);
      return () => {
        set?.delete(handler as EventHandler<unknown>);
      };
    },
    onAll(handler) {
      wildcard.add(handler);
      return () => {
        wildcard.delete(handler);
      };
    },
    listenerCount(key) {
      return listeners.get(key)?.size ?? 0;
    },
  };
}
