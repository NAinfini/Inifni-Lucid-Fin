import React, { createContext, useContext } from 'react';
import type { DesktopApiV1 } from '@lucid-fin/contracts';
import type { Locale } from './copy.js';

export interface DesktopEnvironment {
  readonly api: DesktopApiV1;
  readonly createRequestId: () => string;
  readonly locale: Locale;
}

const DesktopEnvironmentContext = createContext<DesktopEnvironment | null>(null);

export function DesktopEnvironmentProvider({
  children,
  value,
}: {
  readonly children: React.ReactNode;
  readonly value: DesktopEnvironment;
}) {
  return (
    <DesktopEnvironmentContext.Provider value={value}>
      {children}
    </DesktopEnvironmentContext.Provider>
  );
}

export function useDesktopEnvironment(): DesktopEnvironment {
  const value = useContext(DesktopEnvironmentContext);
  if (value === null) throw new Error('DesktopEnvironmentProvider is missing');
  return value;
}
