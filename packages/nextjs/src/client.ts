'use client';

import type { BreadcrumbInput } from '@tracex/core';
import {
  TraceX,
  type TraceXReactClient,
  type TraceXReactOptions,
} from '@tracex/react';

// Export client components and helpers
export {
  TraceXClientProvider,
  DefaultErrorFallback,
} from './client/provider';
export { captureNextGlobalError } from './client/global-error';

// Re-export React components and hooks
export {
  TraceXProvider,
  TraceXErrorBoundary,
  withTraceXErrorBoundary,
  useTraceX,
  useCaptureException,
  useAddBreadcrumb,
  TraceXReactClient,
} from '@tracex/react';

// Export client TraceX facade
export { TraceX } from '@tracex/react';

// Convenience functional helpers
export const init = (options: TraceXReactOptions): TraceXReactClient =>
  TraceX.init(options);
export const getClient = (): TraceXReactClient | undefined =>
  TraceX.getClient();
export const captureException = (
  error: unknown,
  context?: Record<string, unknown>
): string | undefined => TraceX.captureException(error, context);
export const addBreadcrumb = (breadcrumb: BreadcrumbInput): void =>
  TraceX.addBreadcrumb(breadcrumb);
export const flush = (timeoutMs?: number): Promise<boolean> =>
  TraceX.flush(timeoutMs);
export const close = (timeoutMs?: number): Promise<boolean> =>
  TraceX.close(timeoutMs);
export const reset = (): void => TraceX.reset();

// Re-export types
export * from './types';

export default TraceX;
