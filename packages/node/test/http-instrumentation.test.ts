import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import http from 'node:http';
import https from 'node:https';
import { TraceXClient } from '@tracex/core';
import {
  HttpBreadcrumbInterceptor,
  isInternalTraceXRequest,
} from '../src/integrations/http-instrumentation';

describe('HttpBreadcrumbInterceptor', () => {
  let server: http.Server;
  let serverPort: number;
  let serverBaseUrl: string;
  let client: TraceXClient;
  let interceptor: HttpBreadcrumbInterceptor;
  let initialHttpRequest: typeof http.request;
  let initialFetch: typeof globalThis.fetch;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = http.createServer((req, res) => {
        if (req.url === '/api/v1/crashes') {
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'accepted' }));
          return;
        }

        if (req.url === '/error') {
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Server internal error');
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, url: req.url }));
      });

      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as { port: number };
        serverPort = address.port;
        serverBaseUrl = `http://127.0.0.1:${serverPort}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(() => {
    initialHttpRequest = http.request;
    initialFetch = globalThis.fetch;

    client = new TraceXClient({
      projectKey: 'tracex_test_http_instrumentation',
      endpoint: `${serverBaseUrl}/api/v1/crashes`,
    });
    interceptor = new HttpBreadcrumbInterceptor(client, `${serverBaseUrl}/api/v1/crashes`);
    interceptor.install();
  });

  afterEach(() => {
    interceptor.uninstall();
  });

  describe('isInternalTraceXRequest()', () => {
    it('identifies crash ingestion endpoint path as internal', () => {
      expect(isInternalTraceXRequest('http://api.domain.com/api/v1/crashes')).toBe(true);
      expect(
        isInternalTraceXRequest('https://custom.gateway.internal/api/v1/crashes/bulk')
      ).toBe(true);
    });

    it('identifies configured endpoint prefix as internal', () => {
      expect(
        isInternalTraceXRequest(
          'https://my-backend.org/tracex/events',
          'https://my-backend.org/tracex'
        )
      ).toBe(true);
    });

    it('identifies X-TraceX-Key header as internal in object, Headers, and array formats', () => {
      expect(
        isInternalTraceXRequest('https://external.service.com/webhook', undefined, {
          'x-tracex-key': 'tracex_live_secret',
        })
      ).toBe(true);

      const headers = new Headers();
      headers.set('X-TraceX-Key', 'tracex_live_secret');
      expect(
        isInternalTraceXRequest('https://external.service.com/webhook', undefined, headers)
      ).toBe(true);

      expect(
        isInternalTraceXRequest('https://external.service.com/webhook', undefined, [
          ['X-TraceX-Key', 'tracex_live_secret'],
        ])
      ).toBe(true);
    });

    it('returns false for normal external HTTP requests', () => {
      expect(isInternalTraceXRequest('https://api.github.com/repos')).toBe(false);
      expect(isInternalTraceXRequest('http://127.0.0.1:8080/users')).toBe(false);
      expect(isInternalTraceXRequest('')).toBe(false);
    });
  });

  describe('HTTP & HTTPS request interception', () => {
    it('records network.http breadcrumb on successful http.get', async () => {
      const responseBody = await new Promise<string>((resolve, reject) => {
        http
          .get(`${serverBaseUrl}/external/data`, (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => resolve(data));
          })
          .on('error', reject);
      });

      const parsed = JSON.parse(responseBody);
      expect(parsed.success).toBe(true);

      const breadcrumbs = client.getRingBuffer().getItems();
      expect(breadcrumbs.length).toBe(1);

      const b = breadcrumbs[0];
      expect(b.category).toBe('network.http');
      expect(b.action).toBe('GET');
      expect(b.target).toBe(`${serverBaseUrl}/external/data`);
      expect(b.data?.status_code).toBe(200);
      expect(typeof b.data?.duration).toBe('number');
      expect(typeof b.data?.duration_ms).toBe('number');
      expect(b.data?.method).toBe('GET');
    });

    it('records network.http breadcrumb on http.request with POST and 500 status', async () => {
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          `${serverBaseUrl}/error`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve());
          }
        );
        req.on('error', reject);
        req.write(JSON.stringify({ test: 123 }));
        req.end();
      });

      const breadcrumbs = client.getRingBuffer().getItems();
      expect(breadcrumbs.length).toBe(1);

      const b = breadcrumbs[0];
      expect(b.category).toBe('network.http');
      expect(b.action).toBe('POST');
      expect(b.data?.status_code).toBe(500);
    });

    it('records network.http breadcrumb when network error occurs without swallowing error', async () => {
      const nonExistentUrl = 'http://127.0.0.1:1';

      let caughtError: any = null;
      try {
        await new Promise<void>((resolve, reject) => {
          const req = http.get(nonExistentUrl, (res) => {
            res.resume();
            resolve();
          });
          req.on('error', (err) => {
            reject(err);
          });
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).not.toBeNull();

      const breadcrumbs = client.getRingBuffer().getItems();
      expect(breadcrumbs.length).toBe(1);
      expect(breadcrumbs[0].category).toBe('network.http');
      expect(breadcrumbs[0].data?.status_code).toBe(0);
      expect(breadcrumbs[0].data?.error).toBeDefined();
    });

    it('strictly filters out internal TraceX crash ingestion endpoint requests', async () => {
      await new Promise<void>((resolve, reject) => {
        const req = http.request(
          `${serverBaseUrl}/api/v1/crashes`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-TraceX-Key': 'tracex_test_internal',
            },
          },
          (res) => {
            res.resume();
            res.on('end', () => resolve());
          }
        );
        req.on('error', reject);
        req.write(JSON.stringify({ event_id: 'test' }));
        req.end();
      });

      const breadcrumbs = client.getRingBuffer().getItems();
      expect(breadcrumbs.length).toBe(0);
    });

    it('intercepts https.request, deduplicates without double logging, and records single breadcrumb', async () => {
      const req = https.request({
        host: 'api.external-service.com',
        path: '/v1/resource',
        method: 'GET',
      });
      req.on('error', () => {});

      req.emit('response', { statusCode: 200 });

      const breadcrumbs = client.getRingBuffer().getItems();
      expect(breadcrumbs.length).toBe(1);
      expect(breadcrumbs[0].category).toBe('network.http');
      expect(breadcrumbs[0].action).toBe('GET');
      expect(breadcrumbs[0].target).toBe('https://api.external-service.com/v1/resource');
      expect(breadcrumbs[0].data?.status_code).toBe(200);

      req.emit('close');
      expect(client.getRingBuffer().getItems().length).toBe(1);

      req.destroy();
    });

    it('sanitizes basic auth credentials from target URLs in breadcrumbs', async () => {
      const req = http.request('http://admin:secret123@127.0.0.1:8080/secure/api');
      req.on('error', () => {});
      req.emit('response', { statusCode: 200 });
      req.destroy();

      const breadcrumbs = client.getRingBuffer().getItems();
      expect(breadcrumbs.length).toBe(1);
      expect(breadcrumbs[0].target).not.toContain('secret123');
      expect(breadcrumbs[0].target).not.toContain('admin:');
      expect(breadcrumbs[0].target).toBe('http://127.0.0.1:8080/secure/api');
    });
  });

  describe('fetch interception', () => {
    it('records network.http breadcrumb on successful fetch call', async () => {
      const res = await fetch(`${serverBaseUrl}/api/v1/items`);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);

      const breadcrumbs = client.getRingBuffer().getItems();
      expect(breadcrumbs.length).toBe(1);

      const b = breadcrumbs[0];
      expect(b.category).toBe('network.http');
      expect(b.action).toBe('GET');
      expect(b.target).toBe(`${serverBaseUrl}/api/v1/items`);
      expect(b.data?.status_code).toBe(200);
      expect(typeof b.data?.duration).toBe('number');
    });

    it('strictly ignores fetch calls to internal TraceX ingestion endpoint', async () => {
      const res = await fetch(`${serverBaseUrl}/api/v1/crashes`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TraceX-Key': 'tracex_test_fetch',
        },
        body: JSON.stringify({ crash: true }),
      });

      expect(res.status).toBe(202);

      const breadcrumbs = client.getRingBuffer().getItems();
      expect(breadcrumbs.length).toBe(0);
    });

    it('records breadcrumb with status 0 on fetch network failure and rethrows error', async () => {
      let threw = false;
      try {
        await fetch('http://127.0.0.1:1/nonexistent');
      } catch {
        threw = true;
      }

      expect(threw).toBe(true);

      const breadcrumbs = client.getRingBuffer().getItems();
      expect(breadcrumbs.length).toBe(1);
      expect(breadcrumbs[0].data?.status_code).toBe(0);
      expect(breadcrumbs[0].data?.error).toBeDefined();
    });
  });

  describe('Teardown & Cleanup', () => {
    it('uninstalls interceptors cleanly, restores http.request and globalThis.fetch, and stops recording breadcrumbs', async () => {
      interceptor.uninstall();

      // Assert http.request and globalThis.fetch are restored
      expect(http.request).toBe(initialHttpRequest);
      expect(globalThis.fetch).toBe(initialFetch);

      const res = await fetch(`${serverBaseUrl}/after-uninstall`);
      expect(res.status).toBe(200);

      const breadcrumbs = client.getRingBuffer().getItems();
      expect(breadcrumbs.length).toBe(0);
    });
  });
});
