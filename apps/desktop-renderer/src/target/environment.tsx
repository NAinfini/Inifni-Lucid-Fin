import React, { createContext, useContext } from 'react';
import type { TargetDesktopApiV1 } from '@lucid-fin/target-contracts';
import type { TargetLocale } from './copy.js';

export interface TargetEnvironment {
  readonly api: TargetDesktopApiV1;
  readonly createRequestId: () => string;
  readonly locale: TargetLocale;
}

const TargetEnvironmentContext = createContext<TargetEnvironment | null>(null);

export function TargetEnvironmentProvider({
  children,
  value,
}: {
  readonly children: React.ReactNode;
  readonly value: TargetEnvironment;
}) {
  return (
    <TargetEnvironmentContext.Provider value={value}>{children}</TargetEnvironmentContext.Provider>
  );
}

export function useTargetEnvironment(): TargetEnvironment {
  const value = useContext(TargetEnvironmentContext);
  if (value === null) throw new Error('TargetEnvironmentProvider is missing');
  return value;
}
