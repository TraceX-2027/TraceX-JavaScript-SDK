'use client';

import React from 'react';
import {
  TraceXProvider,
  TraceXErrorBoundary,
  TraceX,
  type TraceXReactClient,
  type FallbackProps,
  type FallbackRender,
} from '@tracex-dev/react';
import type { TraceXClientProviderProps } from '../types/index';

/**
 * Default fallback UI rendered when an unhandled component error is caught.
 */
export const DefaultErrorFallback: FallbackRender = ({
  error,
  reset,
  eventId,
}: FallbackProps): React.ReactNode => (
  <div
    role="alert"
    data-tracex-error="true"
    style={{
      padding: '1.5rem',
      margin: '1rem',
      border: '1px solid #ef4444',
      borderRadius: '0.375rem',
      backgroundColor: '#fef2f2',
      color: '#991b1b',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}
  >
    <h2 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 600 }}>
      Application Error
    </h2>
    <p style={{ margin: '0 0 0.5rem', fontSize: '0.875rem' }}>
      {error?.message || 'An unexpected client error occurred.'}
    </p>
    {eventId && (
      <p style={{ margin: '0 0 1rem', fontSize: '0.75rem', opacity: 0.8 }}>
        Reference ID: {eventId}
      </p>
    )}
    {reset && (
      <button
        onClick={reset}
        type="button"
        style={{
          padding: '0.5rem 1rem',
          backgroundColor: '#ef4444',
          color: '#ffffff',
          border: 'none',
          borderRadius: '0.25rem',
          cursor: 'pointer',
          fontWeight: 500,
        }}
      >
        Try again
      </button>
    )}
  </div>
);

/**
 * Drop-in client component combining TraceXProvider and TraceXErrorBoundary.
 * Ensures hydration safety and automatic singleton initialization in Next.js root layout.
 */
export const TraceXClientProvider: React.FC<TraceXClientProviderProps> = ({
  options,
  client,
  fallback,
  onError,
  onReset,
  resetKeys,
  children,
}) => {
  // Automatic singleton initialization if options are provided and no client exists
  if (typeof window !== 'undefined' && options && !client && !TraceX.getClient()) {
    try {
      TraceX.init(options as any);
    } catch {
      // Guard against configuration errors or SSR execution
    }
  }

  const activeClient = client || (TraceX.getClient() as TraceXReactClient | undefined);
  const effectiveFallback = fallback !== undefined ? fallback : DefaultErrorFallback;

  return (
    <TraceXProvider client={activeClient}>
      <TraceXErrorBoundary
        client={activeClient}
        fallback={effectiveFallback}
        onError={onError}
        onReset={onReset}
        resetKeys={resetKeys}
      >
        {children}
      </TraceXErrorBoundary>
    </TraceXProvider>
  );
};
