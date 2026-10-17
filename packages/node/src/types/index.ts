import { EnvironmentContext, TraceXOptions } from '@tracex/core';

/**
 * Server environment context capturing Node.js / Bun runtime and OS forensics.
 * Conforms to TraceX API Specification Section 3.1.
 */
export interface ServerEnvironmentContext extends EnvironmentContext {
  hostname?: string;
  platform: 'bun' | 'node' | string;
  runtime: 'bun' | 'node';
  runtime_version: string;
  os_name: string;
  os_version: string;
  device_model?: string;
  pid?: number;
  total_ram_mb: number;
  free_ram_mb: number;
  process_uptime_sec: number;
  is_low_memory: boolean;
  [key: string]: unknown;
}

/**
 * Configuration options for initializing TraceX Node / Bun SDK.
 */
export interface TraceXNodeOptions extends TraceXOptions {
  /**
   * Whether to exit the process when an uncaughtException is caught.
   * Defaults to true.
   */
  exitOnUncaughtException?: boolean;

  /**
   * Maximum timeout in milliseconds to wait for telemetry to flush on uncaughtException.
   * Defaults to 2000ms.
   */
  uncaughtExceptionTimeoutMs?: number;

  /**
   * Whether to instrument outgoing HTTP and HTTPS requests to emit breadcrumbs.
   * Defaults to true.
   */
  instrumentHttp?: boolean;

  /**
   * Whether to instrument global fetch requests to emit breadcrumbs.
   * Defaults to true.
   */
  instrumentFetch?: boolean;

  /**
   * Whether to catch unhandled exceptions via process.on('uncaughtException').
   * Defaults to true.
   */
  captureUncaughtExceptions?: boolean;

  /**
   * Whether to catch unhandled promise rejections via process.on('unhandledRejection').
   * Defaults to true.
   */
  captureUnhandledRejections?: boolean;

  /**
   * Whether to hook process.on('beforeExit') to drain telemetry queue before shutdown.
   * Defaults to true.
   */
  instrumentLifecycle?: boolean;

  /**
   * Whether to hook termination signals (SIGTERM, SIGINT) to flush telemetry on shutdown.
   * Defaults to false.
   */
  hookSignals?: boolean;

  /**
   * Custom process exit handler, useful for unit testing process termination.
   * Defaults to (code) => process.exit(code).
   */
  exitFn?: (code: number) => void;
}
