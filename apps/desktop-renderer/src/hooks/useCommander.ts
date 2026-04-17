/**
 * `hooks/useCommander.ts` — Phase E split-2.
 *
 * Thin React glue: instantiates `CommanderSessionService`, wires up the
 * transport subscription inside a `useEffect`, and exposes `{ sendMessage,
 * cancel, isStreaming }` to the panel. All business logic moved into the
 * service so this hook stays small and predictable across re-renders.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { store, type AppDispatch, type RootState } from '../store/index.js';
import { getLocale, t } from '../i18n.js';
import { getAPI } from '../utils/api.js';
import { CommanderTransport } from '../commander/transport/CommanderTransport.js';
import {
  CommanderSessionService,
  syncCommanderEntitiesForTool,
} from '../commander/service/CommanderSessionService.js';

// Re-export for existing callers that pulled this helper from this module.
export { syncCommanderEntitiesForTool };

export function useCommander(): {
  sendMessage: (message: string) => Promise<void>;
  cancel: () => Promise<void>;
  isStreaming: boolean;
} {
  const dispatch = useDispatch<AppDispatch>();
  const isStreaming = useSelector((state: RootState) => state.commander.streaming);
  const serviceRef = useRef<CommanderSessionService | null>(null);

  // Build the service lazily — `getAPI()` only resolves after preload runs.
  const service = useMemo(() => {
    const api = getAPI();
    const transport = new CommanderTransport(api?.commander);
    const instance = new CommanderSessionService({
      transport,
      api,
      dispatch,
      getState: () => store.getState(),
      t,
      getLocale,
    });
    serviceRef.current = instance;
    return instance;
  }, [dispatch]);

  useEffect(() => service.subscribe(), [service]);

  const sendMessage = useCallback(
    async (message: string) => service.start(message),
    [service],
  );
  const cancel = useCallback(async () => service.cancel(), [service]);

  return { sendMessage, cancel, isStreaming };
}
