import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOT_DIR = path.resolve(__dirname, '..');
const TARBALLS_DIR = path.join(ROOT_DIR, 'dist', 'tarballs');

// Dynamic version discovery from package manifest
const corePkgPath = path.join(ROOT_DIR, 'packages', 'core', 'package.json');
const currentVersion: string = JSON.parse(fs.readFileSync(corePkgPath, 'utf8')).version;

const EXPECTED_TARBALLS = [
  `tracex-dev-core-${currentVersion}.tgz`,
  `tracex-dev-node-${currentVersion}.tgz`,
  `tracex-dev-react-${currentVersion}.tgz`,
  `tracex-dev-nextjs-${currentVersion}.tgz`,
];

function runCommandOrThrow(
  command: string,
  args: string[],
  cwd: string,
  desc: string
): { stdout: string; stderr: string } {
  console.log(`\n▶ ${desc} (${command} ${args.join(' ')})...`);
  const res = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env },
  });

  if (res.status !== 0) {
    throw new Error(`${desc} failed with exit code ${res.status}`);
  }

  return { stdout: '', stderr: '' };
}

export function runSandboxVerification(): void {
  console.log('====================================================');
  console.log(` TraceX SDK External Sandbox Verification Runner (v${currentVersion})`);
  console.log('====================================================');

  // 1. Verify that tarballs exist or generate them
  const missingTarball = EXPECTED_TARBALLS.some(
    (name) => !fs.existsSync(path.join(TARBALLS_DIR, name))
  );

  if (missingTarball) {
    console.log('\n📦 Packaged tarballs missing. Running "bun run pack:all" first...');
    const packRes = spawnSync('bun', ['scripts/publish.ts', '--pack'], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env },
    });
    if (packRes.status !== 0) {
      throw new Error(`Failed to generate release tarballs (exit ${packRes.status})`);
    }
  }

  // 2. Create isolated sandbox directory outside monorepo
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracex-consumer-sandbox-'));
  console.log(`\n📁 Isolated sandbox created at: ${sandboxDir}`);

  let success = false;

  try {
    // 3. Copy tarballs into sandbox
    const sandboxTarballsDir = path.join(sandboxDir, 'tarballs');
    fs.mkdirSync(sandboxTarballsDir, { recursive: true });

    for (const tarball of EXPECTED_TARBALLS) {
      const srcPath = path.join(TARBALLS_DIR, tarball);
      const destPath = path.join(sandboxTarballsDir, tarball);
      fs.copyFileSync(srcPath, destPath);
    }
    console.log(`📋 Copied 4 tarballs to sandbox local cache.`);

    // 4. Create consumer package.json
    const consumerPkgJson = {
      name: 'tracex-sandbox-consumer',
      version: '1.0.0',
      private: true,
      type: 'module',
      dependencies: {
        '@tracex-dev/core': `./tarballs/tracex-dev-core-${currentVersion}.tgz`,
        '@tracex-dev/node': `./tarballs/tracex-dev-node-${currentVersion}.tgz`,
        '@tracex-dev/react': `./tarballs/tracex-dev-react-${currentVersion}.tgz`,
        '@tracex-dev/nextjs': `./tarballs/tracex-dev-nextjs-${currentVersion}.tgz`,
        react: '^19.3.1',
        'react-dom': '^19.3.1',
      },
      devDependencies: {
        '@types/node': '^22.10.1',
        '@types/react': '^19.3.0',
        '@types/react-dom': '^19.3.0',
        typescript: '^5.7.3',
      },
    };

    fs.writeFileSync(
      path.join(sandboxDir, 'package.json'),
      JSON.stringify(consumerPkgJson, null, 2) + '\n',
      'utf8'
    );

    // 5. Run npm install
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    runCommandOrThrow(
      npmCmd,
      ['install', '--no-audit', '--no-fund'],
      sandboxDir,
      'Executing npm install on packed SDK tarballs'
    );

    // 6. Write tsconfig.json
    const tsconfigJson = {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: false,
        jsx: 'react-jsx',
      },
      include: ['consumer.ts'],
    };

    fs.writeFileSync(
      path.join(sandboxDir, 'tsconfig.json'),
      JSON.stringify(tsconfigJson, null, 2) + '\n',
      'utf8'
    );

    // 7. Write consumer.ts importing all 4 packages
    const consumerTs = `
import {
  BreadcrumbRingBuffer,
  DataScrubber,
  HttpTelemetryDispatcher,
  type Breadcrumb,
  type CrashEventPayload,
} from '@tracex-dev/core';

import {
  TraceX as TraceXNode,
  TraceXNodeClient,
  type TraceXNodeOptions,
} from '@tracex-dev/node';

import {
  TraceX as TraceXReact,
  TraceXProvider,
  TraceXErrorBoundary,
  type TraceXReactOptions,
} from '@tracex-dev/react';

import {
  withTraceXServerAction,
  withTraceXRoute,
  TraceXClientProvider,
} from '@tracex-dev/nextjs';

import {
  withTraceXServerAction as serverActionFn,
  withTraceXRoute as routeFn,
} from '@tracex-dev/nextjs/server';

import {
  TraceXClientProvider as ClientProviderComp,
} from '@tracex-dev/nextjs/client';

// 1. @tracex-dev/core type checking & API verification
const ringBuffer = new BreadcrumbRingBuffer(20);
const breadcrumb: Breadcrumb = {
  sequence_order: 1,
  timestamp: new Date().toISOString(),
  category: 'sandbox',
  action: 'verify_types',
  target: 'typecheck',
  data: { verified: true },
};
ringBuffer.add(breadcrumb);

const scrubber = new DataScrubber();
const scrubbed = scrubber.scrub('Authorization: Bearer secret_jwt_token_xyz');

const dispatcher = new HttpTelemetryDispatcher({
  endpoint: 'https://telemetry.tracex.dev/api/v1/crashes',
  projectKey: 'tracex_test_key_00000000',
});

// 2. @tracex-dev/node type checking & API verification
const nodeOpts: TraceXNodeOptions = {
  projectKey: 'tracex_test_node_sandbox_key',
  captureUncaughtExceptions: false,
  captureUnhandledRejections: false,
  instrumentHttp: false,
};
TraceXNode.init(nodeOpts);
TraceXNode.addBreadcrumb({ category: 'sandbox', action: 'test_node', target: 'node_sandbox' });
const nodeClient: TraceXNodeClient | undefined = TraceXNode.getClient();

// 3. @tracex-dev/react type checking & API verification
const reactOpts: TraceXReactOptions = {
  projectKey: 'tracex_test_react_sandbox_key',
  instrumentClicks: false,
  instrumentNavigation: false,
};
TraceXReact.init(reactOpts);

// 4. @tracex-dev/nextjs type checking & API verification
const action = withTraceXServerAction('sampleAction', async (input: { id: string }) => {
  return { success: true, id: input.id };
});

const subpathAction = serverActionFn('subpathAction', async () => {
  return { status: 'healthy' };
});

console.log('[TYPECHECK] Consumer TypeScript assertions passed');
`;

    fs.writeFileSync(path.join(sandboxDir, 'consumer.ts'), consumerTs, 'utf8');

    // 8. Run tsc --noEmit
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    runCommandOrThrow(
      npxCmd,
      ['tsc', '--noEmit'],
      sandboxDir,
      'Compiling consumer TypeScript with tsc --noEmit'
    );
    console.log('✅ TypeScript compilation produced 0 errors!');

    // 9. Write consumer.mjs (ESM Node.js consumer covering all 4 packages)
    const consumerMjs = `
import assert from 'node:assert';
import { BreadcrumbRingBuffer, DataScrubber } from '@tracex-dev/core';
import { TraceX as TraceXNode } from '@tracex-dev/node';
import { TraceX as TraceXReact, TraceXErrorBoundary, TraceXProvider } from '@tracex-dev/react';
import { withTraceXServerAction, withTraceXRoute, TraceXClientProvider } from '@tracex-dev/nextjs';
import { withTraceXServerAction as serverActionFn, withTraceXRoute as routeFn, TraceX as TraceXServer } from '@tracex-dev/nextjs/server';

console.log('▶ [ESM] Testing @tracex-dev/core, @tracex-dev/node, @tracex-dev/react, and @tracex-dev/nextjs under Node.js runtime...');

// 1. Test BreadcrumbRingBuffer
const ring = new BreadcrumbRingBuffer(5);
ring.add({ category: 'sandbox', action: 'esm_ring', target: 'buffer', data: { text: 'Hello from ESM' } });
assert.strictEqual(ring.size, 1, 'Ring buffer size should be 1');
const items = ring.toArray();
assert.strictEqual(items.length, 1);
assert.strictEqual(items[0].target, 'buffer');

// 2. Test DataScrubber
const scrubber = new DataScrubber();
const redacted = scrubber.scrub('Authorization: Bearer secret_jwt_token_12345');
assert.ok(redacted.includes('[REDACTED]'), 'Bearer token was not redacted');

// 3. Test TraceX Node
TraceXNode.init({
  projectKey: 'tracex_test_esm_sandbox_key',
  captureUncaughtExceptions: false,
  captureUnhandledRejections: false,
  instrumentHttp: false,
  instrumentLifecycle: false,
});
TraceXNode.addBreadcrumb({ category: 'sandbox', action: 'esm_executed', target: 'node_sandbox' });
const client = TraceXNode.getClient();
assert.ok(client !== undefined && client !== null, 'TraceXNode client is null');
const breadcrumbs = client.getRingBuffer().toArray();
assert.strictEqual(breadcrumbs.length, 1);
assert.strictEqual(breadcrumbs[0].action, 'esm_executed');

// 4. Test @tracex-dev/react runtime exports & facade
TraceXReact.init({
  projectKey: 'tracex_test_react_esm_key',
  instrumentClicks: false,
  instrumentNavigation: false,
});
assert.ok(typeof TraceXReact.init === 'function', 'TraceXReact.init should be a function');
assert.ok(typeof TraceXErrorBoundary !== 'undefined', 'TraceXErrorBoundary should be defined');
assert.ok(typeof TraceXProvider !== 'undefined', 'TraceXProvider should be defined');

// 5. Test @tracex-dev/nextjs and @tracex-dev/nextjs/server runtime wrappers
assert.ok(typeof TraceXClientProvider !== 'undefined', 'TraceXClientProvider should be defined');
assert.ok(typeof withTraceXRoute === 'function', 'withTraceXRoute should be a function');
assert.ok(typeof routeFn === 'function', 'routeFn from /server should be a function');

const testAction = withTraceXServerAction('sampleAction', async (input) => {
  return { echo: input, processed: true };
});
assert.ok(typeof testAction === 'function', 'withTraceXServerAction should return a wrapped function');
const actionResult = await testAction('esm_payload');
assert.deepStrictEqual(actionResult, { echo: 'esm_payload', processed: true });

const testSubpathAction = serverActionFn('subpathAction', async () => {
  return { status: 'subpath_healthy' };
});
const subpathResult = await testSubpathAction();
assert.deepStrictEqual(subpathResult, { status: 'subpath_healthy' });

assert.ok(typeof TraceXServer.init === 'function', 'TraceXServer.init should be a function');

console.log('✅ [ESM] ESM verification script executed successfully!');
`;
    fs.writeFileSync(path.join(sandboxDir, 'consumer.mjs'), consumerMjs, 'utf8');

    // Execute ESM consumer with Node.js
    runCommandOrThrow(
      'node',
      ['consumer.mjs'],
      sandboxDir,
      'Executing ESM consumer (node consumer.mjs)'
    );

    // 10. Write consumer.cjs (CommonJS Node.js consumer covering all 4 packages)
    const consumerCjs = `
const assert = require('node:assert');
const { BreadcrumbRingBuffer, DataScrubber } = require('@tracex-dev/core');
const { TraceX: TraceXNode } = require('@tracex-dev/node');
const { TraceX: TraceXReact, TraceXErrorBoundary, TraceXProvider } = require('@tracex-dev/react');
const { withTraceXServerAction, withTraceXRoute, TraceXClientProvider } = require('@tracex-dev/nextjs');
const { withTraceXServerAction: serverActionFn, withTraceXRoute: routeFn, TraceX: TraceXServer } = require('@tracex-dev/nextjs/server');

console.log('▶ [CJS] Testing @tracex-dev/core, @tracex-dev/node, @tracex-dev/react, and @tracex-dev/nextjs under CommonJS runtime...');

async function run() {
  // 1. Test BreadcrumbRingBuffer
  const ring = new BreadcrumbRingBuffer(5);
  ring.add({ category: 'sandbox', action: 'cjs_ring', target: 'buffer', data: { text: 'Hello from CJS' } });
  assert.strictEqual(ring.size, 1, 'Ring buffer size should be 1');
  const items = ring.toArray();
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].target, 'buffer');

  // 2. Test DataScrubber
  const scrubber = new DataScrubber();
  const redacted = scrubber.scrub('Authorization: Bearer secret_jwt_token_67890');
  assert.ok(redacted.includes('[REDACTED]'), 'Bearer token was not redacted in CJS');

  // 3. Test TraceX Node
  TraceXNode.init({
    projectKey: 'tracex_test_cjs_sandbox_key',
    captureUncaughtExceptions: false,
    captureUnhandledRejections: false,
    instrumentHttp: false,
    instrumentLifecycle: false,
  });
  TraceXNode.addBreadcrumb({ category: 'sandbox', action: 'cjs_executed', target: 'node_sandbox' });
  const client = TraceXNode.getClient();
  assert.ok(client !== undefined && client !== null, 'TraceXNode client is null');
  const breadcrumbs = client.getRingBuffer().toArray();
  assert.strictEqual(breadcrumbs.length, 1);
  assert.strictEqual(breadcrumbs[0].action, 'cjs_executed');

  // 4. Test @tracex-dev/react runtime exports & facade
  TraceXReact.init({
    projectKey: 'tracex_test_react_cjs_key',
    instrumentClicks: false,
    instrumentNavigation: false,
  });
  assert.ok(typeof TraceXReact.init === 'function', 'TraceXReact.init should be a function');
  assert.ok(typeof TraceXErrorBoundary !== 'undefined', 'TraceXErrorBoundary should be defined');
  assert.ok(typeof TraceXProvider !== 'undefined', 'TraceXProvider should be defined');

  // 5. Test @tracex-dev/nextjs and @tracex-dev/nextjs/server runtime wrappers
  assert.ok(typeof TraceXClientProvider !== 'undefined', 'TraceXClientProvider should be defined');
  assert.ok(typeof withTraceXRoute === 'function', 'withTraceXRoute should be a function');
  assert.ok(typeof routeFn === 'function', 'routeFn from /server should be a function');

  const testAction = withTraceXServerAction('sampleAction', async (input) => {
    return { echo: input, processed: true };
  });
  assert.ok(typeof testAction === 'function', 'withTraceXServerAction should return a wrapped function');
  const actionResult = await testAction('cjs_payload');
  assert.deepStrictEqual(actionResult, { echo: 'cjs_payload', processed: true });

  const testSubpathAction = serverActionFn('subpathAction', async () => {
    return { status: 'subpath_healthy' };
  });
  const subpathResult = await testSubpathAction();
  assert.deepStrictEqual(subpathResult, { status: 'subpath_healthy' });

  assert.ok(typeof TraceXServer.init === 'function', 'TraceXServer.init should be a function');

  console.log('✅ [CJS] CommonJS verification script executed successfully!');
}

run().catch((err) => {
  console.error('CJS test failed:', err);
  process.exit(1);
});
`;
    fs.writeFileSync(path.join(sandboxDir, 'consumer.cjs'), consumerCjs, 'utf8');

    // Execute CJS consumer with Node.js
    runCommandOrThrow(
      'node',
      ['consumer.cjs'],
      sandboxDir,
      'Executing CJS consumer (node consumer.cjs)'
    );

    success = true;
    console.log('\n====================================================');
    console.log('🎉 External Sandbox Verification PASSED 100%!');
    console.log('====================================================\n');
  } finally {
    if (success) {
      try {
        fs.rmSync(sandboxDir, { recursive: true, force: true });
        console.log(`🧹 Cleaned up temporary sandbox directory.`);
      } catch {
        // ignore cleanup error
      }
    } else {
      console.error(`\n⚠️ Sandbox verification failed. Sandbox preserved for inspection at: ${sandboxDir}`);
    }
  }
}

if (import.meta.main) {
  try {
    runSandboxVerification();
  } catch (err: any) {
    console.error('\n❌ Sandbox verification failed:', err.message || err);
    process.exit(1);
  }
}
