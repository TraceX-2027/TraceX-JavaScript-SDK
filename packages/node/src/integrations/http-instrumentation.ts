import http from 'node:http';
import https from 'node:https';
import { AsyncLocalStorage } from 'node:async_hooks';
import { TraceXClient } from '@tracex/core';

const httpScope = new AsyncLocalStorage<boolean>();
const TRACEX_INTERCEPTED = Symbol('tracex_intercepted');

/**
 * Checks if a requested URL or header set corresponds to internal TraceX telemetry ingestion,
 * preventing infinite recursive request logging.
 */
export function isInternalTraceXRequest(
  url: string,
  endpoint?: string,
  headers?: any
): boolean {
  if (!url) return false;

  // Scoped /api/v1/crashes path matching
  try {
    const parsed = new URL(url.startsWith('http') ? url : `http://${url}`);
    if (
      parsed.pathname === '/api/v1/crashes' ||
      parsed.pathname.startsWith('/api/v1/crashes/')
    ) {
      return true;
    }
  } catch {
    const pathPart = url.split(/[?#]/)[0];
    if (pathPart.endsWith('/api/v1/crashes') || pathPart.includes('/api/v1/crashes/')) {
      return true;
    }
  }

  if (endpoint) {
    const cleanEndpoint = endpoint.replace(/\/$/, '');
    if (url.startsWith(cleanEndpoint)) {
      return true;
    }
  }

  if (url.startsWith('https://api.tracex.dev')) {
    return true;
  }

  // Check headers for TraceX project key (support object, Headers, or [string, string][] array)
  if (headers) {
    if (Array.isArray(headers)) {
      for (const entry of headers) {
        if (Array.isArray(entry) && typeof entry[0] === 'string') {
          if (entry[0].toLowerCase() === 'x-tracex-key') {
            return true;
          }
        }
      }
    } else if (typeof headers.get === 'function') {
      if (headers.get('x-tracex-key') || headers.get('X-TraceX-Key')) {
        return true;
      }
    } else if (typeof headers === 'object') {
      for (const key of Object.keys(headers)) {
        if (key.toLowerCase() === 'x-tracex-key') {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Strips basic auth userinfo (username:password) from URL string.
 */
function sanitizeUrlUserinfo(urlStr: string): string {
  try {
    const parsed = new URL(urlStr);
    if (parsed.username || parsed.password) {
      parsed.username = '';
      parsed.password = '';
      return parsed.toString();
    }
    return urlStr;
  } catch {
    return urlStr.replace(/^(https?:\/\/)[^/@]+@/, '$1');
  }
}

/**
 * Parses variable arguments passed to http.request / https.request
 */
function parseHttpArgs(
  defaultProtocol: string,
  args: any[]
): {
  url: string;
  method: string;
  headers?: any;
} {
  let url = '';
  let method = 'GET';
  let headers: any = undefined;

  const arg0 = args[0];
  const arg1 = args[1];

  const formatHostWithPort = (hostOrHostname: string, port?: string | number): string => {
    if (!port) return hostOrHostname;
    if (typeof hostOrHostname === 'string' && hostOrHostname.includes(':')) {
      return hostOrHostname;
    }
    return `${hostOrHostname}:${port}`;
  };

  const resolvePath = (options: any): string => {
    if (options.path) return options.path;
    const pathname = options.pathname || '/';
    const search = options.search || '';
    return `${pathname}${search}`;
  };

  if (typeof arg0 === 'string') {
    if (arg0.startsWith('http://') || arg0.startsWith('https://')) {
      url = arg0;
    } else {
      const rawHost = arg1?.host || arg1?.hostname || 'localhost';
      const host = formatHostWithPort(rawHost, arg1?.port);
      let protocol = arg1?.protocol || defaultProtocol;
      if (!protocol.endsWith(':')) protocol += ':';
      const path = arg0.startsWith('/') ? arg0 : `/${arg0}`;
      url = `${protocol}//${host}${path}`;
    }
    if (arg1 && typeof arg1 === 'object') {
      if (arg1.method) method = arg1.method;
      if (arg1.headers) headers = arg1.headers;
    }
  } else if (arg0 instanceof URL) {
    url = arg0.toString();
    if (arg1 && typeof arg1 === 'object') {
      if (arg1.method) method = arg1.method;
      if (arg1.headers) headers = arg1.headers;
    }
  } else if (arg0 && typeof arg0 === 'object') {
    const options = arg0;
    if (options.method) method = options.method;
    if (options.headers) headers = options.headers;

    let protocol = options.protocol || defaultProtocol;
    if (!protocol.endsWith(':')) protocol += ':';
    const rawHost = options.host || options.hostname || 'localhost';
    const host = formatHostWithPort(rawHost, options.port);
    const path = resolvePath(options);
    url = `${protocol}//${host}${path.startsWith('/') ? path : '/' + path}`;
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `${defaultProtocol}//${url}`;
  }

  url = sanitizeUrlUserinfo(url);

  return {
    url,
    method: (method || 'GET').toUpperCase(),
    headers,
  };
}

/**
 * Wraps ClientRequest.emit to capture network telemetry breadcrumb without consuming stream or altering errors.
 */
function attachBreadcrumbInterceptor(
  req: any,
  client: TraceXClient,
  method: string,
  url: string
): void {
  if (!req || typeof req.emit !== 'function') {
    return;
  }

  const startTime = Date.now();
  let recorded = false;

  const record = (statusCode: number, error?: unknown) => {
    if (recorded) return;
    recorded = true;

    try {
      const durationMs = Math.max(0, Date.now() - startTime);

      client.addBreadcrumb({
        category: 'network.http',
        action: method,
        target: url,
        data: {
          status_code: statusCode,
          duration: durationMs,
          duration_ms: durationMs,
          method,
          url,
          ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
        },
      });
    } catch {
      // Safe against breadcrumb recording failure
    }
  };

  const origEmit = req.emit;
  req.emit = function (this: any, event: string, ...args: any[]) {
    try {
      if (event === 'response') {
        const res = args[0];
        const statusCode = typeof res?.statusCode === 'number' ? res.statusCode : 200;
        record(statusCode);
      } else if (event === 'error') {
        const err = args[0];
        record(0, err);
      } else if (event === 'abort' || event === 'close') {
        if (!recorded) {
          record(0);
        }
      }
    } catch {
      // Prevent interceptor logic from interrupting req.emit
    }
    return origEmit.call(this, event, ...args);
  };
}

/**
 * Instruments outgoing HTTP/HTTPS and global fetch calls to record breadcrumbs.
 * Strictly avoids infinite recursion by ignoring TraceX ingestion endpoints.
 */
export class HttpBreadcrumbInterceptor {
  private readonly client: TraceXClient;
  private readonly endpoint?: string;
  private readonly instrumentHttpEnabled: boolean;
  private readonly instrumentFetchEnabled: boolean;

  private originalHttpRequest?: typeof http.request;
  private originalHttpGet?: typeof http.get;
  private originalHttpsRequest?: typeof https.request;
  private originalHttpsGet?: typeof https.get;
  private originalFetch?: typeof globalThis.fetch;

  private wrappedHttpRequest?: any;
  private wrappedHttpGet?: any;
  private wrappedHttpsRequest?: any;
  private wrappedHttpsGet?: any;
  private wrappedFetch?: any;

  private isInstalled = false;

  constructor(
    client: TraceXClient,
    endpoint?: string,
    options?: { instrumentHttp?: boolean; instrumentFetch?: boolean }
  ) {
    this.client = client;
    this.endpoint = endpoint;
    this.instrumentHttpEnabled = options?.instrumentHttp !== false;
    this.instrumentFetchEnabled = options?.instrumentFetch !== false;
  }

  public install(): void {
    if (this.isInstalled) return;

    const self = this;
    const client = this.client;
    const endpoint = this.endpoint;

    // 1. Intercept http.request and http.get
    if (this.instrumentHttpEnabled) {
      this.originalHttpRequest = http.request;
      this.originalHttpGet = http.get;
      const origHttpRequest = this.originalHttpRequest;

      this.wrappedHttpRequest = function (this: any, ...args: any[]) {
        const callerThis = this;
        if (!self.isInstalled || httpScope.getStore()) {
          return origHttpRequest.apply(callerThis, args as any);
        }

        const { url, method, headers } = parseHttpArgs('http:', args);
        if (isInternalTraceXRequest(url, endpoint, headers)) {
          return origHttpRequest.apply(callerThis, args as any);
        }

        return httpScope.run(true, () => {
          const req = origHttpRequest.apply(callerThis, args as any);
          if (req && (req as any)[TRACEX_INTERCEPTED]) {
            return req;
          }
          if (req) {
            (req as any)[TRACEX_INTERCEPTED] = true;
          }

          attachBreadcrumbInterceptor(req, client, method, url);
          return req;
        });
      };
      http.request = this.wrappedHttpRequest;

      this.wrappedHttpGet = function (this: any, ...args: any[]) {
        const req = http.request.apply(this, args as any);
        if (req && typeof req.end === 'function') {
          req.end();
        }
        return req;
      };
      http.get = this.wrappedHttpGet;

      // 2. Intercept https.request and https.get
      this.originalHttpsRequest = https.request;
      this.originalHttpsGet = https.get;
      const origHttpsRequest = this.originalHttpsRequest;

      this.wrappedHttpsRequest = function (this: any, ...args: any[]) {
        const callerThis = this;
        if (!self.isInstalled || httpScope.getStore()) {
          return origHttpsRequest.apply(callerThis, args as any);
        }

        const { url, method, headers } = parseHttpArgs('https:', args);
        if (isInternalTraceXRequest(url, endpoint, headers)) {
          return origHttpsRequest.apply(callerThis, args as any);
        }

        return httpScope.run(true, () => {
          const req = origHttpsRequest.apply(callerThis, args as any);
          if (req && (req as any)[TRACEX_INTERCEPTED]) {
            return req;
          }
          if (req) {
            (req as any)[TRACEX_INTERCEPTED] = true;
          }

          attachBreadcrumbInterceptor(req, client, method, url);
          return req;
        });
      };
      https.request = this.wrappedHttpsRequest;

      this.wrappedHttpsGet = function (this: any, ...args: any[]) {
        const req = https.request.apply(this, args as any);
        if (req && typeof req.end === 'function') {
          req.end();
        }
        return req;
      };
      https.get = this.wrappedHttpsGet;
    }

    // 3. Intercept global fetch
    if (this.instrumentFetchEnabled && typeof globalThis.fetch === 'function') {
      this.originalFetch = globalThis.fetch;
      const origFetch = this.originalFetch;

      const wrappedFetch = async function (
        this: any,
        input: RequestInfo | URL,
        init?: RequestInit
      ): Promise<Response> {
        const callerThis = this;
        if (!self.isInstalled || httpScope.getStore()) {
          return origFetch.call(callerThis, input, init);
        }

        let url = '';
        let method = 'GET';

        if (typeof input === 'string') {
          url = input;
        } else if (input instanceof URL) {
          url = input.toString();
        } else if (input && typeof input === 'object') {
          url = (input as Request).url || '';
          method = (input as Request).method || 'GET';
        }

        if (init && init.method) {
          method = init.method;
        }
        method = method.toUpperCase();

        const headers =
          init?.headers ||
          (input && typeof input === 'object' ? (input as Request).headers : undefined);

        if (isInternalTraceXRequest(url, endpoint, headers)) {
          return origFetch.call(callerThis, input, init);
        }

        url = sanitizeUrlUserinfo(url);

        const startTime = Date.now();
        return httpScope.run(true, async () => {
          try {
            const response = await origFetch.call(callerThis, input, init);
            const durationMs = Math.max(0, Date.now() - startTime);

            client.addBreadcrumb({
              category: 'network.http',
              action: method,
              target: url,
              data: {
                status_code: response.status,
                duration: durationMs,
                duration_ms: durationMs,
                method,
                url,
              },
            });
            return response;
          } catch (error) {
            const durationMs = Math.max(0, Date.now() - startTime);

            client.addBreadcrumb({
              category: 'network.http',
              action: method,
              target: url,
              data: {
                status_code: 0,
                duration: durationMs,
                duration_ms: durationMs,
                method,
                url,
                error: error instanceof Error ? error.message : String(error),
              },
            });
            throw error;
          }
        });
      };

      Object.assign(wrappedFetch, origFetch);
      this.wrappedFetch = wrappedFetch;
      globalThis.fetch = wrappedFetch as any;
    }

    this.isInstalled = true;
  }

  public uninstall(): void {
    if (!this.isInstalled) return;
    this.isInstalled = false;

    if (this.originalHttpRequest) {
      if (http.request === this.wrappedHttpRequest) {
        http.request = this.originalHttpRequest;
      }
      this.originalHttpRequest = undefined;
    }
    if (this.originalHttpGet) {
      if (http.get === this.wrappedHttpGet) {
        http.get = this.originalHttpGet;
      }
      this.originalHttpGet = undefined;
    }
    if (this.originalHttpsRequest) {
      if (https.request === this.wrappedHttpsRequest) {
        https.request = this.originalHttpsRequest;
      }
      this.originalHttpsRequest = undefined;
    }
    if (this.originalHttpsGet) {
      if (https.get === this.wrappedHttpsGet) {
        https.get = this.originalHttpsGet;
      }
      this.originalHttpsGet = undefined;
    }
    if (this.originalFetch && typeof globalThis !== 'undefined') {
      if (globalThis.fetch === this.wrappedFetch) {
        globalThis.fetch = this.originalFetch;
      }
      this.originalFetch = undefined;
    }
  }
}
