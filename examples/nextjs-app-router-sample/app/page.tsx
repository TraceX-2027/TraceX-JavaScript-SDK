'use client';

import React, { useState } from 'react';
import { TraceX } from '@tracex-dev/nextjs/client';
import { triggerServerActionFailure } from './actions';

interface BreadcrumbItem {
  id: string;
  category: string;
  action: string;
  target: string;
  timestamp: string;
}

export default function ShowcaseDashboard() {
  // State for Client Crash
  const [shouldCrashClient, setShouldCrashClient] = useState(false);

  // State for Server Action
  const [actionLoading, setActionLoading] = useState(false);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [actionDuration, setActionDuration] = useState<number | null>(null);

  // State for Route Handler
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeResponse, setRouteResponse] = useState<any | null>(null);

  // State for Breadcrumb Feed
  const [customBreadcrumb, setCustomBreadcrumb] = useState('');
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([
    {
      id: 'bc-1',
      category: 'lifecycle',
      action: 'init',
      target: 'showcase_dashboard',
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);

  // State for Telemetry Flush
  const [flushStatus, setFlushStatus] = useState<string | null>(null);

  // Client Render Crash Trigger
  if (shouldCrashClient) {
    throw new Error(
      'Simulated React Client Component Crash: Unhandled exception inside <ShowcaseDashboard> triggered by developer.'
    );
  }

  // Handlers
  const handleAddBreadcrumb = (category: string, action: string, target: string) => {
    TraceX.addBreadcrumb({ category, action, target });
    setBreadcrumbs((prev) => [
      {
        id: `bc-${Date.now()}`,
        category,
        action,
        target,
        timestamp: new Date().toLocaleTimeString(),
      },
      ...prev.slice(0, 9),
    ]);
  };

  const handleCustomBreadcrumbSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customBreadcrumb.trim()) return;
    handleAddBreadcrumb('user.custom', 'input', customBreadcrumb.trim());
    setCustomBreadcrumb('');
  };

  const handleTriggerServerAction = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setActionLoading(true);
    setActionResult(null);
    const start = Date.now();

    const formData = new FormData(e.currentTarget);
    try {
      await triggerServerActionFailure(formData);
      setActionResult('Action succeeded unexpectedly');
    } catch (err: any) {
      setActionDuration(Date.now() - start);
      setActionResult(err?.message || 'Server Action threw an uncaught error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleTriggerRouteHandler = async (type = 'db_exhausted') => {
    setRouteLoading(true);
    setRouteResponse(null);
    try {
      const res = await fetch(`/api/crash?type=${type}`);
      const data = await res.json();
      setRouteResponse({
        status: res.status,
        statusText: res.statusText,
        contentType: res.headers.get('content-type'),
        data,
      });
    } catch (err: any) {
      setRouteResponse({
        status: 'Error',
        data: { message: err?.message || 'Fetch failed' },
      });
    } finally {
      setRouteLoading(false);
    }
  };

  const handleCaptureHandledException = () => {
    const eventId = TraceX.captureException(
      new Error('Sample handled exception: Third-party API rate limit exceeded'),
      {
        endpoint: 'https://api.partner.example/v2/data',
        retryAfter: 30,
        trigger: 'dashboard_manual_button',
      }
    );
    handleAddBreadcrumb('telemetry', 'capture_exception', `Event ID: ${eventId}`);
    setFlushStatus(`Captured handled error: ${eventId}`);
  };

  const handleFlushTelemetry = async () => {
    setFlushStatus('Flushing telemetry queue...');
    const start = Date.now();
    const ok = await TraceX.flush(3000);
    setFlushStatus(`Flush finished in ${Date.now() - start}ms (success: ${ok})`);
  };

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      {/* Top Hero Banner */}
      <header className="mb-8 border-b border-surface-border pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-brand-500/20 text-brand-500 border border-brand-500/30">
              Next.js 16 App Router
            </span>
            <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-mono">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Gateway Online
            </span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            TraceX Full-Stack Observability
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Dual-runtime telemetry testbed for React Client Components, Next.js Server Actions, and Route Handlers.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-xs bg-surface p-3 rounded-lg border border-surface-border">
          <span className="text-slate-400">Project:</span>
          <span className="text-brand-500 font-bold">
            {process.env.NEXT_PUBLIC_TRACEX_PROJECT_KEY || 'tracex_live_demo_00000000'}
          </span>
          <button
            onClick={handleFlushTelemetry}
            className="ml-auto px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 transition"
          >
            Flush Queue
          </button>
        </div>
      </header>

      {flushStatus && (
        <div className="mb-6 p-3 rounded-lg bg-brand-500/10 border border-brand-500/30 text-xs font-mono text-brand-500 flex items-center justify-between">
          <span>{flushStatus}</span>
          <button onClick={() => setFlushStatus(null)} className="text-slate-400 hover:text-white">✕</button>
        </div>
      )}

      {/* Grid of Interactive Showcase Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Card 1: Client Component Crash */}
        <section className="bg-surface rounded-xl p-6 border border-surface-border shadow-lg flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
                Client Component Crash
              </h2>
              <span className="text-xs font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                &lt;TraceXClientProvider&gt;
              </span>
            </div>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Triggers an unhandled render exception inside this React tree. The root error boundary catches the crash, renders an interactive fallback with reference ID, captures <code className="text-slate-300">componentStack</code>, and provides a &quot;Try again&quot; recovery button.
            </p>
          </div>

          <div className="mt-4 pt-4 border-t border-surface-border">
            <button
              onClick={() => {
                handleAddBreadcrumb('ui.click', 'crash_trigger', 'Client Component Crash Button');
                setShouldCrashClient(true);
              }}
              className="w-full py-2.5 px-4 bg-red-600 hover:bg-red-500 text-white font-medium text-sm rounded-lg shadow-md shadow-red-950 transition cursor-pointer"
            >
              Trigger Client Render Crash
            </button>
          </div>
        </section>

        {/* Card 2: Server Action Failure */}
        <section className="bg-surface rounded-xl p-6 border border-surface-border shadow-lg flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                Server Action Crash
              </h2>
              <span className="text-xs font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                withTraceXServerAction
              </span>
            </div>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Executes a Next.js Server Action wrapped with TraceX. Profiles execution duration, scrubs sensitive password and token credentials, dispatches telemetry, and preserves the thrown error.
            </p>

            <form onSubmit={handleTriggerServerAction} className="space-y-3">
              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1">Username</label>
                <input
                  type="text"
                  name="username"
                  defaultValue="developer_alex"
                  className="w-full px-3 py-1.5 text-xs font-mono bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-mono text-slate-400">Password</label>
                  <span className="text-[10px] text-amber-400 font-mono bg-amber-500/10 px-1.5 py-0.2 rounded">
                    Auto-Scrubbed [REDACTED]
                  </span>
                </div>
                <input
                  type="password"
                  name="password"
                  defaultValue="SecretP@ssword123!"
                  className="w-full px-3 py-1.5 text-xs font-mono bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-400 mb-1">Simulated Failure Scenario</label>
                <select
                  name="scenario"
                  className="w-full px-3 py-1.5 text-xs font-mono bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-brand-500"
                >
                  <option value="database_lock">Database Transaction Deadlock</option>
                  <option value="upstream_auth">Upstream OAuth Gateway 502</option>
                  <option value="quota_exceeded">Account Quota Exceeded</option>
                </select>
              </div>

              <button
                type="submit"
                disabled={actionLoading}
                className="w-full py-2.5 px-4 bg-amber-600 hover:bg-amber-500 text-white font-medium text-sm rounded-lg shadow-md shadow-amber-950 transition cursor-pointer disabled:opacity-50"
              >
                {actionLoading ? 'Invoking Server Action...' : 'Trigger Server Action Failure'}
              </button>
            </form>
          </div>

          {actionResult && (
            <div className="mt-4 p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono">
              <div className="text-amber-400 font-semibold mb-1">Server Action Rethrow Caught:</div>
              <div className="text-slate-300 break-words">{actionResult}</div>
              {actionDuration !== null && (
                <div className="text-slate-500 mt-1">Duration: {actionDuration}ms</div>
              )}
            </div>
          )}
        </section>

        {/* Card 3: Route Handler Crash (RFC 7807) */}
        <section className="bg-surface rounded-xl p-6 border border-surface-border shadow-lg flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-violet-500"></span>
                Route Handler Crash (RFC 7807)
              </h2>
              <span className="text-xs font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                withTraceXRoute
              </span>
            </div>
            <p className="text-xs text-slate-400 mb-4 leading-relaxed">
              Invokes <code className="text-slate-300">/api/crash</code>. Wrapped with <code className="text-brand-500">withTraceXRoute</code>, which captures the exception, flushes telemetry, and formats an RFC 7807 Problem Details JSON response with correlating <code className="text-slate-300">trace_id</code>.
            </p>

            <div className="space-y-2">
              <button
                onClick={() => handleTriggerRouteHandler('db_exhausted')}
                disabled={routeLoading}
                className="w-full py-2.5 px-4 bg-violet-600 hover:bg-violet-500 text-white font-medium text-sm rounded-lg shadow-md shadow-violet-950 transition cursor-pointer disabled:opacity-50"
              >
                {routeLoading ? 'Calling Route...' : 'Trigger API Route Handler 500 (/api/crash)'}
              </button>

              <button
                onClick={() => handleTriggerRouteHandler('gateway_timeout')}
                disabled={routeLoading}
                className="w-full py-2 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono rounded border border-slate-700 transition"
              >
                Simulate Gateway Timeout (/api/crash?type=gateway_timeout)
              </button>
            </div>
          </div>

          {routeResponse && (
            <div className="mt-4 p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono">
              <div className="flex justify-between items-center mb-1 text-slate-400">
                <span>HTTP Response:</span>
                <span className="text-red-400 font-bold">{routeResponse.status} Internal Server Error</span>
              </div>
              <pre className="text-slate-300 text-[11px] overflow-x-auto p-2 bg-slate-900 rounded border border-slate-800/60 whitespace-pre-wrap">
                {JSON.stringify(routeResponse.data, null, 2)}
              </pre>
            </div>
          )}
        </section>

        {/* Card 4: Live Breadcrumb Feed */}
        <section className="bg-surface rounded-xl p-6 border border-surface-border shadow-lg flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                Breadcrumb Ring Buffer
              </h2>
              <span className="text-xs font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                FIFO Buffer (50 Max)
              </span>
            </div>
            <p className="text-xs text-slate-400 mb-3 leading-relaxed">
              Real-time breadcrumbs attached to every captured incident payload:
            </p>

            {/* Quick Breadcrumb Buttons */}
            <div className="flex flex-wrap gap-1.5 mb-3">
              <button
                onClick={() => handleAddBreadcrumb('user.action', 'click', 'Cart Checkout Button')}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[11px] font-mono text-slate-300 rounded border border-slate-700"
              >
                + Cart Click
              </button>
              <button
                onClick={() => handleAddBreadcrumb('navigation.route', 'push', '/settings/profile')}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[11px] font-mono text-slate-300 rounded border border-slate-700"
              >
                + Route Push
              </button>
              <button
                onClick={() => handleAddBreadcrumb('db.query', 'SELECT', 'users_cache')}
                className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[11px] font-mono text-slate-300 rounded border border-slate-700"
              >
                + DB Cache Query
              </button>
            </div>

            {/* Custom Breadcrumb Input */}
            <form onSubmit={handleCustomBreadcrumbSubmit} className="flex gap-2 mb-3">
              <input
                type="text"
                value={customBreadcrumb}
                onChange={(e) => setCustomBreadcrumb(e.target.value)}
                placeholder="Enter custom breadcrumb..."
                className="flex-1 px-3 py-1.5 text-xs font-mono bg-slate-950 border border-slate-800 rounded text-slate-200 focus:outline-none focus:border-brand-500"
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium rounded transition"
              >
                Add
              </button>
            </form>

            {/* Live Breadcrumb List */}
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {breadcrumbs.map((bc) => (
                <div
                  key={bc.id}
                  className="flex items-center justify-between p-2 rounded bg-slate-950 border border-slate-800/80 text-[11px] font-mono"
                >
                  <div className="flex items-center gap-2 overflow-hidden">
                    <span className="px-1.5 py-0.5 rounded bg-brand-500/20 text-brand-500 text-[10px] shrink-0">
                      {bc.category}
                    </span>
                    <span className="text-slate-300 truncate">{bc.target}</span>
                  </div>
                  <span className="text-slate-500 text-[10px] shrink-0 ml-2">{bc.timestamp}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-surface-border">
            <button
              onClick={handleCaptureHandledException}
              className="w-full py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded border border-slate-700 transition cursor-pointer"
            >
              Trigger Handled Error Capture (TraceX.captureException)
            </button>
          </div>
        </section>
      </div>

      {/* Footer */}
      <footer className="text-center text-xs text-slate-500 border-t border-surface-border pt-6">
        <p>TraceX Graduation Platform &copy; 2026 &mdash; Built with Next.js 16 App Router &amp; Tailwind CSS</p>
      </footer>
    </main>
  );
}
