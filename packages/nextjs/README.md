# `@tracex-dev/nextjs`

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@tracex-dev/nextjs.svg)](https://www.npmjs.com/package/@tracex-dev/nextjs)

Full-stack Crash Telemetry and Observability SDK for **Next.js** (supporting **App Router** and **Pages Router**).

Provides universal isomorphic routing, Client Component error boundaries, Server Action latency profiling & PII sanitization, RFC 7807 Problem Details Route Handler protection, and automatic Vercel hosting forensics.

---

## Features

- **Isomorphic Architecture**: Dynamically routes calls to `@tracex-dev/react` in browser hydration and `@tracex-dev/node` on the server runtime.
- **`<TraceXClientProvider>`**: Drop-in Client Component for `app/layout.tsx` combining context propagation and React error boundaries with hydration safety.
- **`withTraceXServerAction`**: Wraps Next.js Server Actions to track execution latency, sanitize sensitive `FormData` fields (passwords, tokens), capture crash telemetry, and rethrow original errors.
- **`withTraceXRoute`**: Wraps App Router API Route Handlers (`app/api/**/route.ts`). Intercepts unhandled exceptions and formats compliant RFC 7807 Problem Details responses (HTTP 500) containing correlating `trace_id`.
- **`captureNextGlobalError`**: Captures unhandled crashes in Next.js root error boundaries (`app/global-error.tsx`).
- **Vercel Hosting Forensics**: Automatically detects and enriches server crash payloads with `VERCEL_ENV`, `VERCEL_REGION`, `VERCEL_GIT_COMMIT_SHA`, and `NEXT_RUNTIME`.

---

## Installation

```bash
bun add @tracex-dev/nextjs
# or
npm install @tracex-dev/nextjs
```

---

## App Router Setup

### 1. Root Layout (`app/layout.tsx`)

Wrap your application in `<TraceXClientProvider>`:

```tsx
import { TraceXClientProvider } from '@tracex-dev/nextjs/client';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TraceXClientProvider
          options={{
            projectKey: process.env.NEXT_PUBLIC_TRACEX_PROJECT_KEY || 'tracex_live_demo_00000000',
            endpoint: process.env.NEXT_PUBLIC_TRACEX_ENDPOINT,
          }}
        >
          {children}
        </TraceXClientProvider>
      </body>
    </html>
  );
}
```

### 2. Server Actions (`app/actions.ts`)

Wrap Server Actions with `withTraceXServerAction`:

```typescript
'use server';

import { withTraceXServerAction } from '@tracex-dev/nextjs/server';

export const submitOrder = withTraceXServerAction('submitOrder', async (formData: FormData) => {
  // Sensitive FormData fields (password, token, etc.) are automatically scrubbed in telemetry
  const customerId = formData.get('customerId');
  if (!customerId) {
    throw new Error('Customer ID missing from submission');
  }

  return { success: true };
});
```

### 3. Route Handlers (`app/api/crash/route.ts`)

Wrap API Route Handlers with `withTraceXRoute`:

```typescript
import { withTraceXRoute } from '@tracex-dev/nextjs/server';

export const GET = withTraceXRoute(async (request: Request) => {
  throw new Error('Database pool exhausted during search');
});
```

On an uncaught error, `withTraceXRoute` captures the incident and returns:

```json
HTTP/1.1 500 Internal Server Error
Content-Type: application/problem+json

{
  "type": "https://tracex.dev/errors/internal-server-error",
  "title": "Internal Server Error",
  "status": 500,
  "detail": "An unhandled server error occurred while processing the request.",
  "trace_id": "evt_49a023b18e7d41f0a20"
}
```

### 4. Root Global Error Boundary (`app/global-error.tsx`)

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import { captureNextGlobalError } from '@tracex-dev/nextjs/client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [eventId, setEventId] = useState<string | null>(null);

  useEffect(() => {
    captureNextGlobalError(error).then((id) => setEventId(id));
  }, [error]);

  return (
    <html>
      <body>
        <h2>Application Fatal Error</h2>
        <p>{error.message}</p>
        {eventId && <p>Reference ID: {eventId}</p>}
        <button onClick={() => reset()}>Try again</button>
      </body>
    </html>
  );
}
```

---

## Configuration Options (`TraceXNextOptions`)

Extends core and node options with Next.js specific settings:

| Option | Type | Default | Description |
|---|---|---|---|
| `projectKey` | `string` | *Required* | Project key (`tracex_live_*` or `tracex_test_*`). |
| `endpoint` | `string` | Edge Gateway | Telemetry ingestion gateway URL. |
| `autoDetectVercel` | `boolean` | `true` | Harvest Vercel deployment variables on server. |
| `captureUncaughtExceptions`| `boolean` | `true` | Intercept uncaught server exceptions. |
| `instrumentHttp` | `boolean` | `true` | Intercept outgoing server HTTP/HTTPS requests. |
| `instrumentClicks` | `boolean` | `true` | Intercept browser DOM clicks. |
| `instrumentNavigation` | `boolean` | `true` | Intercept browser SPA route navigation. |

---

## Subpath Imports

- `@tracex-dev/nextjs`: Isomorphic universal exports.
- `@tracex-dev/nextjs/client`: Client components (`<TraceXClientProvider>`, hooks, `captureNextGlobalError`).
- `@tracex-dev/nextjs/server`: Server-only utilities (`withTraceXServerAction`, `withTraceXRoute`).

---

## License

MIT © 2026 TraceX Platform Team.
