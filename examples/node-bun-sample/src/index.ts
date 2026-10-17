import * as readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import process from 'node:process';
import os from 'node:os';
import { TraceX } from '@tracex/node';

/**
 * Detect active runtime and format runtime forensics banner.
 */
function printBanner(mode: 'Automated Walkthrough' | 'Interactive Menu') {
  const isBun = typeof (globalThis as any).Bun !== 'undefined';
  const runtimeName = isBun ? 'Bun' : 'Node.js';
  const runtimeVersion = isBun ? (globalThis as any).Bun.version : process.version;

  console.log('\n============================================================');
  console.log('       TraceX Node.js & Bun Server SDK Showcase');
  console.log('============================================================');
  console.log(`  Runtime       : ${runtimeName} (${runtimeVersion})`);
  console.log(`  Architecture  : ${process.arch}`);
  console.log(`  Platform      : ${process.platform} (${os.release()})`);
  console.log(`  Process ID    : ${process.pid}`);
  console.log(`  Execution Mode: ${mode}`);
  console.log('============================================================\n');
}

/**
 * Configures and initializes the TraceX SDK client.
 */
function initTraceX() {
  const projectKey = process.env.TRACEX_PROJECT_KEY || 'tracex_live_demo_00000000';
  const endpoint =
    process.env.TRACEX_ENDPOINT ||
    'https://tracex-edge-ingest.kareemadel10110.workers.dev/api/v1/crashes';
  const environment = process.env.TRACEX_ENVIRONMENT || 'development';
  const release = process.env.TRACEX_RELEASE || '1.0.0';

  console.log(`[TraceX] Initializing client...`);
  console.log(`  Project Key : ${projectKey}`);
  console.log(`  Endpoint    : ${endpoint}`);
  console.log(`  Environment : ${environment}`);
  console.log(`  Release     : ${release}\n`);

  return TraceX.init({
    projectKey,
    endpoint,
    environment: environment,
    release,
    captureUncaughtExceptions: true,
    captureUnhandledRejections: true,
    instrumentHttp: true,
    instrumentLifecycle: true,
    debug: false,
  });
}

/**
 * Executes default automated walkthrough demonstrating breadcrumbs, network tracking, and crash capture.
 */
async function runAutomatedWalkthrough() {
  printBanner('Automated Walkthrough');
  initTraceX();

  console.log('--- Step 1: Recording Lifecycle & User Breadcrumbs ---');
  TraceX.addBreadcrumb({
    category: 'lifecycle',
    action: 'startup',
    target: 'server.init',
    data: { timestamp: new Date().toISOString(), memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) },
  });
  console.log('  ✔ Recorded lifecycle breadcrumb: server.init');

  TraceX.addBreadcrumb({
    category: 'auth',
    action: 'authenticate',
    target: 'api/v1/login',
    data: { user: 'developer_demo', status: 'authenticated' },
  });
  console.log('  ✔ Recorded auth breadcrumb: user authenticated');

  console.log('\n--- Step 2: Simulating HTTP Request & Breadcrumb ---');
  TraceX.addBreadcrumb({
    category: 'http.request',
    action: 'GET',
    target: 'https://api.example.internal/health',
    data: { status_code: 200, latency_ms: 18 },
  });
  console.log('  ✔ Recorded HTTP breadcrumb: GET /health (200 OK)');

  console.log('\n--- Step 3: Triggering Handled Exception Telemetry ---');
  const sampleError = new Error('Database connection pool exhausted: timeout after 5000ms');
  const eventId = TraceX.captureException(sampleError, {
    query: 'SELECT * FROM accounts WHERE status = active',
    poolCapacity: 20,
    activeConnections: 20,
    waitQueueLength: 42,
  });
  console.log(`  ✔ Captured Handled Exception: "${sampleError.message}"`);
  console.log(`  ✔ Incident Event ID: ${eventId}`);

  console.log('\n--- Step 4: Flushing Telemetry Dispatcher Queue ---');
  const flushStart = Date.now();
  const flushed = await TraceX.flush(3000);
  const flushDuration = Date.now() - flushStart;
  console.log(`  ✔ Telemetry flush completed in ${flushDuration}ms (flushed: ${flushed})`);

  console.log('\n============================================================');
  console.log('  Automated Walkthrough successfully completed!');
  console.log('  Run with `--interactive` or `-i` to enter interactive menu.');
  console.log('============================================================\n');

  await TraceX.close();
}

/**
 * Interactive menu mode for manual exploratory testing.
 */
async function runInteractiveMenu() {
  printBanner('Interactive Menu');
  initTraceX();

  const rl = readline.createInterface({ input, output });

  let running = true;
  while (running) {
    console.log('\nSelect an action:');
    console.log('  [1] Trigger Handled Exception');
    console.log('  [2] Trigger Uncaught Exception (will exit process)');
    console.log('  [3] Trigger Unhandled Promise Rejection');
    console.log('  [4] Record Custom Breadcrumb');
    console.log('  [5] View System & Memory Forensics');
    console.log('  [6] Flush Telemetry Queue');
    console.log('  [0] Flush & Exit');

    const answer = (await rl.question('\nEnter option (0-6): ')).trim();

    switch (answer) {
      case '1': {
        const error = new Error('Manual Handled Error: Payment gateway timeout');
        const id = TraceX.captureException(error, { triggeredBy: 'interactive_cli', timestamp: new Date().toISOString() });
        console.log(`\n  ✔ Captured exception with Event ID: ${id}`);
        break;
      }
      case '2': {
        console.log('\n  💥 Throwing uncaught exception in 100ms...');
        rl.close();
        setTimeout(() => {
          throw new Error('FATAL: Uncaught CLI Exception Demo');
        }, 100);
        return;
      }
      case '3': {
        console.log('\n  💥 Rejecting promise without catch handler...');
        Promise.reject(new Error('CRITICAL: Unhandled Rejection Demo'));
        break;
      }
      case '4': {
        const message = (await rl.question('Enter breadcrumb message: ')).trim() || 'Manual breadcrumb action';
        TraceX.addBreadcrumb({
          category: 'cli.action',
          action: 'user_input',
          target: 'terminal',
          data: { note: message },
        });
        console.log(`\n  ✔ Added breadcrumb: "${message}"`);
        break;
      }
      case '5': {
        const mem = process.memoryUsage();
        console.log('\n--- System & Memory Forensics ---');
        console.log(`  RSS Memory      : ${(mem.rss / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Heap Used       : ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Heap Total      : ${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  System Load Avg : ${os.loadavg().map((l) => l.toFixed(2)).join(', ')}`);
        console.log(`  Free OS Memory  : ${(os.freemem() / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  Total OS Memory : ${(os.totalmem() / 1024 / 1024).toFixed(2)} MB`);
        break;
      }
      case '6': {
        console.log('\n  ⏳ Flushing telemetry queue...');
        const ok = await TraceX.flush(3000);
        console.log(`  ✔ Telemetry queue flushed (success: ${ok})`);
        break;
      }
      case '0': {
        console.log('\n  ⏳ Draining telemetry queue and exiting...');
        await TraceX.close(3000);
        console.log('  👋 Goodbye!\n');
        running = false;
        rl.close();
        process.exit(0);
        break;
      }
      default:
        console.log('\n  ⚠ Invalid choice. Please enter a number between 0 and 6.');
        break;
    }
  }
}

// Entrypoint dispatcher
const isInteractive = process.argv.includes('--interactive') || process.argv.includes('-i');
if (isInteractive) {
  runInteractiveMenu().catch((err) => {
    console.error('[TraceX CLI Error]:', err);
    process.exit(1);
  });
} else {
  runAutomatedWalkthrough().catch((err) => {
    console.error('[TraceX CLI Error]:', err);
    process.exit(1);
  });
}
