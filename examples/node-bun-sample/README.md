# TraceX Node.js & Bun Sample Application (`@tracex-dev/example-node-bun`)

A dual-runtime reference CLI application showcasing the `@tracex-dev/node` SDK running across both **Bun** and **Node.js** server environments.

---

## Features

- **Dual-Runtime Compatibility**: Native execution in Bun (`bun run start:bun`) and compiled ESM execution in Node.js (`bun run start:node`).
- **Dynamic Runtime Forensics Banner**: Automatically detects and displays active runtime (`Bun.version` vs `process.version`), CPU architecture, OS platform, and PID.
- **Default Automated Walkthrough**: Runs end-to-end telemetry capture out-of-the-box (lifecycle breadcrumbs, auth breadcrumbs, HTTP requests, handled exception capture, and queue flush) and exits cleanly with code 0.
- **Interactive Terminal Menu Mode**: Run with `--interactive` or `-i` to trigger individual crash types (handled exceptions, uncaught errors, unhandled rejections, memory forensics, and manual breadcrumbs) interactively.
- **Resilient Edge Dispatch**: Integrates with the TraceX Qualifiers Edge Ingestion Gateway with graceful non-blocking offline fallback.

---

## Getting Started

### 1. Configuration

Copy the example environment configuration:

```bash
cp .env.example .env
```

Configuration variables:

| Variable | Description | Default |
|---|---|---|
| `TRACEX_PROJECT_KEY` | TraceX project identifier | `tracex_live_demo_00000000` |
| `TRACEX_ENDPOINT` | Edge ingestion gateway URL | `https://tracex-edge-ingest.kareemadel10110.workers.dev/api/v1/crashes` |
| `TRACEX_ENVIRONMENT` | Active deployment stage | `development` |
| `TRACEX_RELEASE` | Semantic application release version | `1.0.0` |

### 2. Execution

#### Running with Bun (Native TypeScript)

Execute the automated walkthrough:

```bash
bun run start:bun
```

Or from the monorepo root:

```bash
bun run example:bun
```

#### Running with Node.js (Compiled ESM)

Builds the application via `tsup` into `./dist` and executes under Node.js:

```bash
bun run start:node
```

Or from the monorepo root:

```bash
bun run example:node
```

#### Running in Interactive Menu Mode

Launch the interactive prompt to explore crashes and view live memory forensics:

```bash
bun run start:interactive
```

Or pass `-i` / `--interactive` directly:

```bash
bun run src/index.ts --interactive
node dist/index.js --interactive
```

---

## Code Overview

```typescript
import { TraceX } from '@tracex-dev/node';

// 1. Initialize client
TraceX.init({
  projectKey: process.env.TRACEX_PROJECT_KEY || 'tracex_live_demo_00000000',
  endpoint: process.env.TRACEX_ENDPOINT,
  captureUncaughtExceptions: true,
  captureUnhandledRejections: true,
  instrumentHttp: true,
});

// 2. Record breadcrumbs
TraceX.addBreadcrumb({
  category: 'lifecycle',
  action: 'startup',
  target: 'server.init',
});

// 3. Capture handled exceptions
try {
  // Database or third-party call...
  throw new Error('Connection timeout');
} catch (error) {
  const eventId = TraceX.captureException(error, { query: 'SELECT * FROM users' });
  console.log(`Reported crash with event ID: ${eventId}`);
}

// 4. Await flush before termination
await TraceX.flush(3000);
```
