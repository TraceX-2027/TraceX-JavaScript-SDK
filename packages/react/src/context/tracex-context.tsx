'use client';

import React, { createContext, useContext, useMemo, useCallback } from 'react';
import type { BreadcrumbInput } from '@tracex/core';
import type { TraceXReactClient } from '../client/react-client';
import { TraceX } from '../index';

export interface TraceXContextValue {
  client?: TraceXReactClient;
}

/**
 * React Context providing the active TraceXReactClient.
 */
export const TraceXContext = createContext<TraceXContextValue | undefined>(undefined);

export interface TraceXProviderProps {
  /**
   * Custom TraceXReactClient instance. Defaults to dynamic resolution of the global TraceX.getClient() singleton.
   */
  client?: TraceXReactClient;
  children?: React.ReactNode;
}

/**
 * Idiomatic React Context Provider for TraceX.
 */
export const TraceXProvider: React.FC<TraceXProviderProps> = ({ client, children }) => {
  const value = useMemo<TraceXContextValue>(() => {
    if (client) {
      return { client };
    }
    return {
      get client() {
        return TraceX.getClient() as TraceXReactClient | undefined;
      },
    };
  }, [client]);

  return <TraceXContext.Provider value={value}>{children}</TraceXContext.Provider>;
};

/**
 * Idiomatic React hook to access the active TraceX client.
 */
export function useTraceX(): TraceXReactClient | undefined {
  const context = useContext(TraceXContext);
  return context?.client ?? (TraceX.getClient() as TraceXReactClient | undefined);
}

/**
 * Convenience hook returning a stable captureException function bound to the active TraceX client.
 */
export function useCaptureException(): (
  error: unknown,
  context?: Record<string, unknown>
) => string | undefined {
  const client = useTraceX();
  return useCallback(
    (error: unknown, context?: Record<string, unknown>) => {
      return client?.captureException(error, context);
    },
    [client]
  );
}

/**
 * Convenience hook returning a stable addBreadcrumb function bound to the active TraceX client.
 */
export function useAddBreadcrumb(): (breadcrumb: BreadcrumbInput) => void {
  const client = useTraceX();
  return useCallback(
    (breadcrumb: BreadcrumbInput) => {
      client?.addBreadcrumb(breadcrumb);
    },
    [client]
  );
}
