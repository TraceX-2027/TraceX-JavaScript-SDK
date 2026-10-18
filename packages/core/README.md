# `@tracex/core`

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@tracex/core.svg)](https://www.npmjs.com/package/@tracex/core)

The core client engine and telemetry pipeline powering all TraceX SDKs (`@tracex/node`, `@tracex/react`, and `@tracex/nextjs`).

Provides thread-safe FIFO circular ring buffers, comprehensive PII sanitization (Luhn credit cards, Bearer tokens, secrets), and an asynchronous non-blocking HTTP telemetry dispatcher with exponential backoff and HTTP 429 rate-limit handling.

---

## Features

- **Isomorphic Architecture**: Runs identically across Node.js, Bun, browser runtimes, Cloudflare Workers, and edge functions.
- **`BreadcrumbRingBuffer`**: Fixed-capacity (default 50) circular buffer assigning strictly monotonic sequence orders and enforcing FIFO eviction.
- **`DataScrubber`**: Deep recursive data sanitizer redacting passwords, API keys, Bearer tokens, Luhn-valid card numbers (`[CARD_REDACTED]`), and user directories (`[PATH_REDACTED]`).
- **`HttpTelemetryDispatcher`**: Resilient background dispatch queue with automatic jitter backoff, max retries, and dynamic `Retry-After` header parsing on HTTP 429 responses.
- **`TraceX` Facade**: Non-blocking singleton facade pattern with full SSR safety.

---

## Installation

```bash
bun add @tracex/core
# or
npm install @tracex/core
```

---

## Usage Example

```typescript
import { TraceX, type TraceXOptions } from '@tracex/core';

// 1. Initialize client
const client = TraceX.init({
  projectKey: 'tracex_live_my_project_1234567890',
  endpoint: 'https://tracex-edge-ingest.kareemadel10110.workers.dev/api/v1/crashes',
  environment: 'production',
  release: '2.1.0',
});

// 2. Record breadcrumbs into circular buffer
TraceX.addBreadcrumb({
  category: 'auth',
  action: 'login',
  target: 'user_session',
  data: { userId: 'usr_445' },
});

// 3. Capture an exception
try {
  throw new Error('Database connection failed');
} catch (error) {
  const eventId = TraceX.captureException(error, {
    database: 'postgres-primary',
    query: 'SELECT * FROM accounts',
  });
  console.log(`Incident captured: ${eventId}`);
}

// 4. Drain queue
await TraceX.flush(3000);
```

---

## Core Classes & API Reference

### `TraceXClient`
The primary client orchestrator. Manages breadcrumbs, sanitization, and dispatch.

```typescript
const client = new TraceXClient(options: TraceXOptions);
client.addBreadcrumb(breadcrumb: BreadcrumbInput): Breadcrumb;
client.captureException(error: unknown, context?: Record<string, unknown>): string;
client.flush(timeoutMs?: number): Promise<boolean>;
client.close(timeoutMs?: number): Promise<boolean>;
```

### `BreadcrumbRingBuffer`
Circular FIFO buffer maintaining fresh contextual telemetry without unbound memory leaks.

```typescript
import { BreadcrumbRingBuffer } from '@tracex/core';

const buffer = new BreadcrumbRingBuffer(50);
buffer.add({ category: 'action', action: 'click', target: 'button' });
const items = buffer.getItems();
```

### `DataScrubber`
Deep recursive data sanitizer for strings, objects, and full payloads.

```typescript
import { DataScrubber } from '@tracex/core';

const scrubber = new DataScrubber();
const sanitizedString = scrubber.scrubString('Token: Bearer secret_123'); // "Token: Bearer [REDACTED]"
const sanitizedObj = scrubber.scrub({ password: '123', publicField: 'ok' });
```

### `HttpTelemetryDispatcher`
Non-blocking background queue with retry logic and rate-limit backoff.

```typescript
import { HttpTelemetryDispatcher } from '@tracex/core';

const dispatcher = new HttpTelemetryDispatcher({
  projectKey: 'tracex_live_...',
  endpoint: 'https://...',
  maxRetries: 3,
});
```

---

## Configuration (`TraceXOptions`)

| Option | Type | Required | Description |
|---|---|---|---|
| `projectKey` | `string` | **Yes** | Project key starting with `tracex_live_` or `tracex_test_`. |
| `endpoint` | `string` | No | Target ingestion endpoint URL. |
| `environment` | `string` | No | Active deployment environment (default: `development`). |
| `release` | `string` | No | Application release version string. |
| `maxBreadcrumbs` | `number` | No | Circular buffer size limit (default: `50`). |
| `debug` | `boolean` | No | Enable verbose console logging (default: `false`). |
| `transport` | `ITransport`| No | Custom network transport implementation. |

---

## License

MIT © 2026 TraceX Platform Team.
