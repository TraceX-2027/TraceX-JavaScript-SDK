import type {
  Breadcrumb,
  BreadcrumbInput,
  CrashEventPayload,
  EnvironmentContext,
  HttpDispatcherOptions,
  ITransport,
  TraceXOptions,
  TransportResponse,
} from '@tracex-dev/core';
import type {
  ServerEnvironmentContext,
  TraceXNodeOptions,
} from '@tracex-dev/node';
import type {
  BrowserEnvironmentContext,
  FallbackProps,
  FallbackRender,
  TraceXErrorBoundaryProps,
  TraceXErrorBoundaryState,
  TraceXReactClient,
  TraceXReactOptions,
} from '@tracex-dev/react';
import type React from 'react';

/**
 * Forensics metadata harvested from Vercel hosting and Next.js serverless runtimes.
 */
export interface VercelEnvironmentContext {
  vercel_env?: string;
  vercel_region?: string;
  vercel_commit_sha?: string;
  runtime?: string;
  next_runtime?: string;
  [key: string]: unknown;
}

/**
 * Unified configuration options for TraceX in Next.js applications.
 */
export interface TraceXNextOptions extends TraceXOptions {
  /**
   * Automatically harvest Vercel environment variables (VERCEL_ENV, VERCEL_REGION, VERCEL_GIT_COMMIT_SHA, NEXT_RUNTIME).
   * Defaults to true.
   */
  autoDetectVercel?: boolean;

  // Server (Node/Bun) options
  captureUncaughtExceptions?: boolean;
  captureUnhandledRejections?: boolean;
  instrumentHttp?: boolean;
  instrumentFetch?: boolean;
  instrumentLifecycle?: boolean;
  hookSignals?: boolean;

  // Client (React/Browser) options
  instrumentClicks?: boolean;
  instrumentNavigation?: boolean;
  instrumentErrors?: boolean;
  captureErrors?: boolean;
  captureUnhandledRejectionsInBrowser?: boolean;
}

/**
 * Options for withTraceXRoute wrapper.
 */
export interface TraceXRouteOptions {
  /**
   * If true, rethrows the caught error instead of returning an RFC 7807 JSON 500 response.
   * Defaults to false.
   */
  rethrow?: boolean;
}

/**
 * App Router API Route handler signature.
 */
export type RouteHandler<TContext = any> = (
  request: Request,
  context?: TContext
) => Promise<Response> | Response;

/**
 * RFC 7807 Problem Details object schema.
 */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  trace_id?: string;
  [key: string]: unknown;
}

/**
 * Context payload attached when capturing crashes in Server Actions.
 */
export interface TraceXServerActionContext {
  mechanism: 'nextjs.server_action';
  action_name: string;
  duration_ms: number;
  arguments?: unknown[];
  args?: unknown[];
  [key: string]: unknown;
}

/**
 * Context payload attached when capturing crashes in Route Handlers.
 */
export interface TraceXRouteContext {
  mechanism: 'nextjs.route_handler';
  url?: string;
  method?: string;
  params?: unknown;
  [key: string]: unknown;
}

/**
 * Context payload attached when capturing crashes in Next.js global-error.tsx.
 */
export interface TraceXGlobalErrorContext {
  mechanism: 'nextjs.global_error';
  digest?: string;
  [key: string]: unknown;
}

/**
 * Props for the <TraceXClientProvider> drop-in Client Component.
 */
export interface TraceXClientProviderProps {
  /**
   * Optional configuration to automatically initialize the client singleton if not already initialized.
   */
  options?: TraceXReactOptions | TraceXNextOptions;

  /**
   * Custom client instance. Defaults to active TraceX singleton.
   */
  client?: TraceXReactClient;

  /**
   * Custom fallback UI to render on uncaught render error.
   */
  fallback?: React.ReactNode | FallbackRender;

  /**
   * Callback invoked when a component error is caught.
   */
  onError?: TraceXErrorBoundaryProps['onError'];

  /**
   * Callback invoked when the error boundary is reset.
   */
  onReset?: () => void;

  /**
   * Keys whose change triggers an automatic boundary reset.
   */
  resetKeys?: readonly unknown[];

  /**
   * Child elements to render.
   */
  children?: React.ReactNode;
}

export type {
  Breadcrumb,
  BreadcrumbInput,
  CrashEventPayload,
  EnvironmentContext,
  HttpDispatcherOptions,
  ITransport,
  TraceXOptions,
  TransportResponse,
  ServerEnvironmentContext,
  TraceXNodeOptions,
  BrowserEnvironmentContext,
  FallbackProps,
  FallbackRender,
  TraceXErrorBoundaryProps,
  TraceXErrorBoundaryState,
  TraceXReactClient,
  TraceXReactOptions,
};
