import { useCallback } from 'react';

type ApiDomain = Record<string, (...args: unknown[]) => Promise<unknown>>;

export function useIpc<T>(domain: string, action: string) {
  return useCallback(
    async (...args: unknown[]): Promise<T> => {
      const api = (window.lucidAPI as unknown as Record<string, ApiDomain>)?.[domain];
      if (!api?.[action]) throw new Error(`IPC not available: ${domain}.${action}`);
      return api[action](...args) as Promise<T>;
    },
    [domain, action],
  );
}
