/**
 * Breadcrumb representing a chronological trail event (e.g., UI tap, network request, console log).
 * Conforms to TraceX API Specification Section 3.1.
 */
export interface Breadcrumb {
  sequence_order: number;
  timestamp: string;
  category: string;
  action: string;
  target: string;
  data?: Record<string, unknown>;
}

/**
 * Input format when capturing a breadcrumb. sequence_order and timestamp can be auto-assigned.
 */
export interface BreadcrumbInput {
  category: string;
  action: string;
  target: string;
  data?: Record<string, unknown>;
  timestamp?: string;
  sequence_order?: number;
}

/**
 * Environment details captured with telemetry payloads.
 * Conforms to TraceX API Specification Section 3.1.
 */
export interface EnvironmentContext {
  environment_name?: string;
  app_version?: string;
  runtime_version?: string;
  os_name?: string;
  os_version?: string;
  device_model?: string;
  is_physical_device?: boolean;
  free_ram_mb?: number;
  total_ram_mb?: number;
  battery_level?: number;
  is_low_memory?: boolean;
  [key: string]: unknown;
}

/**
 * Crash telemetry payload sent to the TraceX Ingestion Gateway.
 * Conforms to TraceX API Specification Section 3.1.
 */
export interface CrashEventPayload {
  event_id?: string;
  project_key: string;
  occurred_at: string;
  platform: string;
  language?: string;
  exception_type: string;
  error_message: string;
  stack_trace: string;
  environment: EnvironmentContext;
  breadcrumbs: Breadcrumb[];
}

/**
 * Response returned from the HTTP transport layer.
 */
export interface TransportResponse {
  status: number;
  headers?: Record<string, string> | Headers | { get(name: string): string | null };
  body?: string;
}

/**
 * Pluggable transport interface for sending telemetry payloads to TraceX Ingestion Gateway.
 */
export interface ITransport {
  send(url: string, projectKey: string, payload: CrashEventPayload): Promise<TransportResponse>;
}

/**
 * Configuration options for initializing TraceX client.
 */
export interface TraceXOptions {
  projectKey: string;
  environment?: string | EnvironmentContext;
  endpoint?: string;
  maxBreadcrumbs?: number;
  debug?: boolean;
  transport?: ITransport;
  platform?: string;
  language?: string;
  release?: string;
  beforeSend?: (payload: CrashEventPayload) => CrashEventPayload | null | undefined | Promise<CrashEventPayload | null | undefined>;
}

/**
 * Configuration options for the HTTP telemetry dispatcher.
 */
export interface HttpDispatcherOptions {
  endpoint?: string;
  projectKey: string;
  transport?: ITransport;
  maxRetries?: number;
  backoffDelays?: number[];
  jitterMax?: number;
  maxQueueSize?: number;
  debug?: boolean;
  onDropped?: (payload: CrashEventPayload, reason: string) => void;
}
