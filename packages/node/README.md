# `@tracex-dev/node`

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@tracex-dev/node.svg)](https://www.npmjs.com/package/@tracex-dev/node)

TraceX Crash Telemetry and Runtime Forensics SDK for **Node.js** (`>=18.0.0`) and **Bun** server runtimes.

Automatically catches unhandled process crashes, tracks outgoing HTTP/HTTPS client requests as breadcrumbs, samples live memory metrics, and hooks process lifecycle signals for zero-loss graceful shutdowns.

---

## Features

- **Dual-Runtime Support**: First-class detection and execution on both Node.js and Bun.
- **Uncaught Exception & Rejection Interception**: Hooks `uncaughtException` and `unhandledRejection` to capture crash stack traces before process termination.
- **HTTP Client Breadcrumb Instrumentation**: Patches native `http.request` and `https.request` to automatically capture outgoing network calls, duration, and status codes.
- **Process Lifecycle Management**: Listens to `beforeExit`, `SIGINT`, and `SIGTERM` signals to cleanly drain queued telemetry events before shutdown.
- **Live Server Forensics**: Enriches every crash payload with memory utilization (`heapUsed`, `rss`, `heapTotal`), load averages, and system uptime.

---

## Installation

```bash
bun add @tracex-dev/node
# or
npm install @tracex-dev/node
```

---

## Quickstart

```typescript
import { TraceX } from '@tracex-dev/node';

// Initialize the SDK early in your application lifecycle
TraceX.init({
  projectKey: process.env.TRACEX_PROJECT_KEY || 'tracex_live_server_demo_0123',
  endpoint: 'https://tracex-edge-ingest.kareemadel10110.workers.dev/api/v1/crashes',
  environment: process.env.NODE_ENV || 'production',
  release: '1.4.0',

  // Automated Integrations (enabled by default)
  captureUncaughtExceptions: true,
  captureUnhandledRejections: true,
  instrumentHttp: true,
  instrumentLifecycle: true,
});

// Outgoing HTTP requests are automatically tracked as breadcrumbs
await fetch('https://api.github.com/zen');

// Manual exception capture
try {
  // Complex operation...
} catch (error) {
  TraceX.captureException(error, {
    jobId: 'queue_task_902',
    tenant: 'enterprise_client_1',
  });
}
```

---

## Configuration Options (`TraceXNodeOptions`)

Extends `TraceXOptions` with Node.js and Bun server integrations:

| Option | Type | Default | Description |
|---|---|---|---|
| `projectKey` | `string` | *Required* | Valid project key (`tracex_live_*` or `tracex_test_*`). |
| `endpoint` | `string` | Cloudflare Edge Ingest | TraceX ingestion gateway URL. |
| `environment` | `string` | `'development'` | Active deployment environment. |
| `captureUncaughtExceptions` | `boolean` | `true` | Intercept uncaught exceptions and capture stack traces. |
| `captureUnhandledRejections` | `boolean` | `true` | Intercept unhandled promise rejections. |
| `instrumentHttp` | `boolean` | `true` | Automatically record breadcrumbs for outgoing HTTP/HTTPS requests. |
| `instrumentLifecycle` | `boolean` | `true` | Hook process termination signals to drain queue before exit. |
| `hookSignals` | `boolean` | `false` | Register handlers for `SIGINT` and `SIGTERM`. |
| `maxBreadcrumbs` | `number` | `50` | Maximum capacity of the circular FIFO ring buffer. |

---

## Teardown and Queue Draining

When managing custom process termination or running in serverless environments, await `TraceX.flush()` or `TraceX.close()`:

```typescript
// Flush pending events up to 5000ms
await TraceX.flush(5000);

// Close client, restore original global handlers, and drain queue
await TraceX.close(5000);
```

---

## License

MIT © 2026 TraceX Platform Team.
