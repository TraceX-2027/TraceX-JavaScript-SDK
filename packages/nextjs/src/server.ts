import type { BreadcrumbInput } from '@tracex/core';
import type { TraceXNodeClient } from '@tracex/node';
import { TraceXServer } from './server/tracex-server';
import type { TraceXNextOptions } from './types';

// Export wrappers and server utilities
export { withTraceXServerAction } from './server/server-action';
export { withTraceXRoute } from './server/route-handler';
export { VercelEnvironmentProvider } from './server/environment';

// Export server TraceX facade
export { TraceXServer as TraceX } from './server/tracex-server';

// Convenience top-level functions for server
export const init = (options: TraceXNextOptions): TraceXNodeClient =>
  TraceXServer.init(options);
export const getClient = (): TraceXNodeClient | undefined =>
  TraceXServer.getClient();
export const captureException = (
  error: unknown,
  context?: Record<string, unknown>
): string | undefined => TraceXServer.captureException(error, context);
export const addBreadcrumb = (breadcrumb: BreadcrumbInput): void =>
  TraceXServer.addBreadcrumb(breadcrumb);
export const flush = (timeoutMs?: number): Promise<boolean> =>
  TraceXServer.flush(timeoutMs);
export const close = (timeoutMs?: number): Promise<boolean> =>
  TraceXServer.close(timeoutMs);
export const reset = (): void => TraceXServer.reset();

// Re-export all types
export * from './types';

export default TraceXServer;
