# `@tracex-dev/react`

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@tracex-dev/react.svg)](https://www.npmjs.com/package/@tracex-dev/react)

TraceX Crash Observability, DOM Interaction Tracking, and Error Boundary SDK for **React** (supports React 16.8+, React 18, and React 19).

Captures unhandled render crashes, records user click breadcrumbs with strict PII filtering, and monitors single-page application (SPA) client navigation.

---

## Features

- **`<TraceXErrorBoundary>`**: Catches React component render crashes, captures `componentStack`, emits `mechanism: react.error_boundary`, and renders customizable or default fallback UI with recovery reset triggers.
- **`withTraceXErrorBoundary` HOC**: Higher-Order Component wrapper for decorating components with error boundaries.
- **`<TraceXProvider>` & Hooks**: Context provider exposing `useTraceX()`, `useCaptureException()`, and `useAddBreadcrumb()`.
- **DOM Click Tracking**: Automatically captures click breadcrumbs on interactive elements (buttons, links, inputs). Strictly ignores password/email inputs and elements tagged `data-tracex-ignore` or `data-tracex-mask`.
- **SPA Navigation Tracking**: Automatically records route transition breadcrumbs by intercepting `history.pushState`, `history.replaceState`, `popstate`, and `hashchange`.
- **Full SSR Safety**: Safely initializes during Next.js, Remix, or Vite SSR without throwing when `window` is undefined.

---

## Installation

```bash
bun add @tracex-dev/react
# or
npm install @tracex-dev/react
```

---

## Quickstart

### 1. Root Initialization

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { TraceX, TraceXProvider, TraceXErrorBoundary } from '@tracex-dev/react';

// Initialize the global React client singleton
TraceX.init({
  projectKey: 'tracex_live_react_app_0123456789',
  endpoint: 'https://tracex-edge-ingest.kareemadel10110.workers.dev/api/v1/crashes',
  environment: 'production',
  instrumentClicks: true,
  instrumentNavigation: true,
  instrumentErrors: true,
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TraceXProvider>
      <TraceXErrorBoundary
        fallback={({ error, reset, eventId }) => (
          <div role="alert" className="error-card">
            <h2>Application Error</h2>
            <p>{error.message}</p>
            {eventId && <p>Reference ID: {eventId}</p>}
            <button onClick={reset}>Try again</button>
          </div>
        )}
      >
        <App />
      </TraceXErrorBoundary>
    </TraceXProvider>
  </React.StrictMode>
);
```

---

## Component & Hook Reference

### `<TraceXErrorBoundary>`

Catches exceptions thrown anywhere in its child component tree.

```tsx
<TraceXErrorBoundary
  fallback={({ error, reset, eventId }) => <CustomErrorCard error={error} onRetry={reset} refId={eventId} />}
  onError={(error, errorInfo) => console.log('Component stack:', errorInfo.componentStack)}
  onReset={() => console.log('Boundary reset')}
  resetKeys={[activeTabId]} // Automatically resets boundary when keys change
>
  <ProductFeed />
</TraceXErrorBoundary>
```

### `withTraceXErrorBoundary` HOC

```tsx
import { withTraceXErrorBoundary } from '@tracex-dev/react';

const ProtectedProfile = withTraceXErrorBoundary(UserProfile, {
  fallback: <div>Failed to load profile.</div>,
});
```

### React Hooks

```tsx
import { useTraceX, useCaptureException, useAddBreadcrumb } from '@tracex-dev/react';

export function CheckoutButton() {
  const captureException = useCaptureException();
  const addBreadcrumb = useAddBreadcrumb();

  const handleCheckout = async () => {
    addBreadcrumb({ category: 'cart', action: 'checkout_click', target: 'order_btn' });
    try {
      await processOrder();
    } catch (err) {
      captureException(err, { step: 'checkout_step_1' });
    }
  };

  return <button onClick={handleCheckout}>Pay Now</button>;
}
```

---

## DOM Privacy & Sensitivity Suppression

TraceX never logs sensitive inputs. You can control click breadcrumb capture using data attributes:

- **Automatic Suppression**: Clicks on `input[type="password"]` and `input[type="email"]` are automatically ignored.
- **`data-tracex-ignore`**: Completely ignores click events on the tagged element and all its children.
- **`data-tracex-mask`**: Completely suppresses click breadcrumbs for the target element.

```html
<!-- Ignored completely in breadcrumbs -->
<button data-tracex-ignore>Secret Admin Action</button>
```

---

## Configuration Options (`TraceXReactOptions`)

| Option | Type | Default | Description |
|---|---|---|---|
| `projectKey` | `string` | *Required* | Project key starting with `tracex_live_` or `tracex_test_`. |
| `endpoint` | `string` | Edge Gateway | Telemetry ingestion gateway URL. |
| `environment` | `string` | `'development'` | Active deployment stage. |
| `instrumentClicks` | `boolean` | `true` | Automatically track user DOM clicks as breadcrumbs. |
| `instrumentNavigation` | `boolean` | `true` | Automatically record client SPA history transitions. |
| `instrumentErrors` | `boolean` | `true` | Hook `window.onerror` and `window.unhandledrejection`. |

---

## License

MIT © 2026 TraceX Platform Team.
