# TraceX Next.js 16 App Router Sample (`@tracex/example-nextjs`)

A full-stack reference application demonstrating production crash telemetry and observability in **Next.js 16 App Router** using `@tracex/nextjs`.

---

## Features

- **Client Component Crash Interception**: Handled by `<TraceXClientProvider>`, capturing `componentStack`, emitting `mechanism: react.error_boundary`, rendering interactive fallback UI with a support reference ID, and supporting instantaneous tree recovery with "Try again".
- **Server Action Observability**: Wrapped with `withTraceXServerAction`. Automatically profiles execution latency, sanitizes sensitive `FormData` fields (e.g. passwords, bearer tokens scrubbed to `[REDACTED]`), captures server crash telemetry, and preserves native error rethrow semantics.
- **RFC 7807 Route Handler Crash Protection**: Wrapped with `withTraceXRoute` (`/api/crash`). Automatically formats unhandled server exceptions into RFC 7807 Problem Details JSON (HTTP 500) containing correlating `trace_id`.
- **Root Global Error Boundary**: Demonstrates `captureNextGlobalError` in `app/global-error.tsx`.
- **Live Breadcrumb Stream**: Interactive feed demonstrating FIFO circular ring buffer (max 50) capturing user actions, navigation, and database queries.
- **Dark Developer Aesthetics**: Designed with modern dark theme UI using Tailwind CSS.

---

## Getting Started

### 1. Configuration

Copy the example environment configuration:

```bash
cp .env.example .env.local
```

Configuration variables:

| Variable | Description | Default |
|---|---|---|
| `NEXT_PUBLIC_TRACEX_PROJECT_KEY` | Public project key for client hydration | `tracex_live_demo_00000000` |
| `NEXT_PUBLIC_TRACEX_ENDPOINT` | Edge ingestion gateway URL | `https://tracex-edge-ingest.kareemadel10110.workers.dev/api/v1/crashes` |
| `NEXT_PUBLIC_TRACEX_ENVIRONMENT`| Active environment stage | `development` |

### 2. Development Server

Start the Next.js development server:

```bash
bun run dev
```

Or from the monorepo root:

```bash
bun run example:next
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 3. Production Build

Build and start the Next.js production server:

```bash
bun run build
bun run start
```

---

## Interactive Showcase Guide

1. **Client Component Crash**: Click **"Trigger Client Render Crash"**. The `<TraceXClientProvider>` boundary catches the render error and displays the fallback card with the generated reference ID (`evt_...`). Click **"Try again"** to reset and restore the dashboard.
2. **Server Action Failure**: Click **"Trigger Server Action Failure"**. The server action executes on the Next.js server, records execution duration, redacts the password field to `[REDACTED]`, captures the crash to the edge gateway, and displays the caught error.
3. **Route Handler Crash**: Click **"Trigger API Route Handler 500"**. Invokes `/api/crash`, returning an RFC 7807 Problem Details response with `trace_id`.
4. **Breadcrumb Stream**: Click quick action buttons or enter custom breadcrumbs to inspect live events in the circular ring buffer.
