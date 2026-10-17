import { CrashEventPayload, HttpDispatcherOptions, ITransport, TransportResponse } from '../types';

/**
 * Default transport implementation delegating to globalThis.fetch with keepalive enabled.
 */
export class DefaultFetchTransport implements ITransport {
  public async send(url: string, projectKey: string, payload: CrashEventPayload): Promise<TransportResponse> {
    const fetchFn = globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      throw new Error('TraceX requires a global fetch implementation');
    }

    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-TraceX-Key': projectKey,
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });

    const body = await response.text().catch(() => '');
    return {
      status: response.status,
      headers: response.headers,
      body,
    };
  }
}

interface QueueItem {
  payload: CrashEventPayload;
  retries: number;
  nextAttemptTime: number;
}

/**
 * Non-blocking HTTP telemetry dispatcher with exponential backoff (2s, 4s, 8s),
 * 429 Retry-After parsing, and graceful queue draining.
 */
export class HttpTelemetryDispatcher {
  private readonly endpoint: string;
  private readonly projectKey: string;
  private readonly transport: ITransport;
  private readonly maxRetries: number;
  private readonly backoffDelays: number[];
  private readonly jitterMax: number;
  private readonly maxQueueSize: number;
  private readonly debug: boolean;
  private readonly onDropped?: (payload: CrashEventPayload, reason: string) => void;

  private queue: QueueItem[] = [];
  private isProcessing = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isClosed = false;

  constructor(options: HttpDispatcherOptions) {
    this.endpoint = options.endpoint || 'https://api.tracex.dev/api/v1/crashes';
    this.projectKey = options.projectKey;
    this.transport = options.transport || new DefaultFetchTransport();
    this.maxRetries = options.maxRetries !== undefined ? options.maxRetries : 3;
    this.backoffDelays = options.backoffDelays || [2000, 4000, 8000];
    this.jitterMax = options.jitterMax !== undefined ? options.jitterMax : 100;
    this.maxQueueSize = options.maxQueueSize !== undefined ? options.maxQueueSize : 100;
    this.debug = Boolean(options.debug);
    this.onDropped = options.onDropped;
  }

  /**
   * Enqueues a scrubbed crash telemetry payload for asynchronous dispatch.
   * Never blocks execution of the host application.
   */
  public enqueue(payload: CrashEventPayload): void {
    if (this.isClosed) {
      if (this.debug) {
        console.warn('[TraceX] Dispatcher is closed; ignoring enqueue call');
      }
      return;
    }

    if (this.queue.length >= this.maxQueueSize) {
      const dropped = this.queue.shift();
      if (dropped) {
        if (this.debug) {
          console.warn('[TraceX] Queue overflow; discarding oldest item');
        }
        this.onDropped?.(dropped.payload, 'QUEUE_OVERFLOW');
      }
    }

    this.queue.push({
      payload,
      retries: 0,
      nextAttemptTime: 0,
    });

    this.scheduleProcess(0);
  }

  /**
   * Returns current count of queued items.
   */
  public get queueLength(): number {
    return this.queue.length;
  }

  /**
   * Returns whether a network request is currently active.
   */
  public get active(): boolean {
    return this.isProcessing;
  }

  /**
   * Awaits in-flight and queued telemetry events up to the specified timeout in milliseconds.
   * Resolves true if the queue drained completely, false if the timeout elapsed.
   */
  public async flush(timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (this.queue.length > 0 || this.isProcessing) {
      if (Date.now() >= deadline) {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return true;
  }

  /**
   * Gracefully shuts down the dispatcher, clearing active timers and draining remaining queue.
   */
  public async close(timeoutMs = 5000): Promise<boolean> {
    this.isClosed = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.queue.length > 0 && !this.isProcessing) {
      void this.processQueue();
    }
    return this.flush(timeoutMs);
  }

  private scheduleProcess(delayMs: number): void {
    if (this.isClosed && this.queue.length === 0) {
      return;
    }

    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.processQueue();
    }, Math.max(0, delayMs));
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    const item = this.queue[0];
    const now = Date.now();

    if (item.nextAttemptTime > now) {
      this.scheduleProcess(item.nextAttemptTime - now);
      return;
    }

    this.isProcessing = true;

    let response: TransportResponse;
    try {
      response = await this.transport.send(this.endpoint, this.projectKey, item.payload);
    } catch (networkError) {
      response = {
        status: 500,
        body: networkError instanceof Error ? networkError.message : String(networkError),
      };
    }

    this.isProcessing = false;

    // 1. Success (200 - 299, e.g. 202 Accepted)
    if (response.status >= 200 && response.status < 300) {
      this.queue.shift();
      this.scheduleProcess(0);
      return;
    }

    // 2. Rate limiting (429 Too Many Requests)
    if (response.status === 429) {
      item.retries += 1;
      if (item.retries > this.maxRetries) {
        if (this.debug) {
          console.warn('[TraceX] Max retries exhausted for rate-limited event. Dropping.');
        }
        this.onDropped?.(item.payload, 'MAX_RETRIES_EXHAUSTED');
        this.queue.shift();
        this.scheduleProcess(0);
        return;
      }

      let delaySeconds = 2;
      const rawHeader = this.getHeader(response.headers, 'retry-after');
      if (rawHeader) {
        const parsedSec = parseFloat(rawHeader);
        if (!isNaN(parsedSec) && parsedSec >= 0) {
          delaySeconds = parsedSec;
        } else {
          const parsedDate = Date.parse(rawHeader);
          if (!isNaN(parsedDate)) {
            delaySeconds = Math.max(0, (parsedDate - Date.now()) / 1000);
          }
        }
      }

      const delayMs = Math.max(10, Math.round(delaySeconds * 1000));
      item.nextAttemptTime = Date.now() + delayMs;
      this.scheduleProcess(delayMs);
      return;
    }

    // 3. Client authentication errors (401 Unauthorized / 403 Forbidden)
    if (response.status === 401 || response.status === 403) {
      if (this.debug) {
        console.warn(`[TraceX] Telemetry rejected with HTTP ${response.status}. Dropping event.`);
      }
      this.onDropped?.(item.payload, `HTTP_${response.status}`);
      this.queue.shift();
      this.scheduleProcess(0);
      return;
    }

    // 4. Server errors (5xx) or network dropped
    if (response.status >= 500 || response.status === 0) {
      item.retries += 1;
      if (item.retries > this.maxRetries) {
        if (this.debug) {
          console.warn('[TraceX] Max retries exhausted for telemetry event. Dropping.');
        }
        this.onDropped?.(item.payload, 'MAX_RETRIES_EXHAUSTED');
        this.queue.shift();
        this.scheduleProcess(0);
        return;
      }

      const baseDelay = this.backoffDelays[item.retries - 1] ?? (2000 * Math.pow(2, item.retries - 1));
      const jitter = this.jitterMax > 0 ? Math.floor(Math.random() * this.jitterMax) : 0;
      const delayMs = baseDelay + jitter;
      item.nextAttemptTime = Date.now() + delayMs;
      this.scheduleProcess(delayMs);
      return;
    }

    // 5. Other client errors (400, etc.)
    if (this.debug) {
      console.warn(`[TraceX] Telemetry rejected with client error HTTP ${response.status}. Dropping event.`);
    }
    this.onDropped?.(item.payload, `HTTP_${response.status}`);
    this.queue.shift();
    this.scheduleProcess(0);
  }

  private getHeader(headers: unknown, name: string): string | null {
    if (!headers) return null;
    if (typeof (headers as { get: (name: string) => string | null }).get === 'function') {
      return (headers as { get: (name: string) => string | null }).get(name);
    }
    if (typeof headers === 'object') {
      const lower = name.toLowerCase();
      for (const [key, value] of Object.entries(headers as Record<string, string>)) {
        if (key.toLowerCase() === lower) {
          return String(value);
        }
      }
    }
    return null;
  }
}
