import { describe, expect, it } from 'bun:test';
import os from 'node:os';
import {
  ServerEnvironmentProvider,
  detectRuntime,
} from '../src/integrations/environment';

describe('ServerEnvironmentProvider & Runtime Detection', () => {
  describe('detectRuntime()', () => {
    it('detects Bun environment when global has Bun with version', () => {
      const mockGlobal = { Bun: { version: '1.4.2' } };
      const info = detectRuntime(mockGlobal);

      expect(info.runtime).toBe('bun');
      expect(info.platform).toBe('bun');
      expect(info.version).toBe('Bun 1.4.2');
    });

    it('falls back to Bun unknown when version is missing', () => {
      const mockGlobal = { Bun: {} };
      const info = detectRuntime(mockGlobal);

      expect(info.runtime).toBe('bun');
      expect(info.platform).toBe('bun');
      expect(info.version).toBe('Bun unknown');
    });

    it('detects Node.js environment when Bun is undefined', () => {
      const mockGlobal = {};
      const info = detectRuntime(mockGlobal);

      expect(info.runtime).toBe('node');
      expect(info.platform).toBe('node');
      expect(info.version).toBe(`Node.js ${process.version}`);
    });

    it('detects current runtime environment when no global is passed', () => {
      const info = detectRuntime();
      expect(['bun', 'node']).toContain(info.runtime);
      expect(['bun', 'node']).toContain(info.platform);
      expect(typeof info.version).toBe('string');
    });
  });

  describe('ServerEnvironmentProvider', () => {
    it('resolves static environment context fields safely', () => {
      const provider = new ServerEnvironmentProvider();
      const staticCtx = provider.getStaticContext();

      expect(staticCtx.platform).toBeDefined();
      expect(staticCtx.runtime).toBeDefined();
      expect(staticCtx.runtime_version).toBeDefined();
      expect(staticCtx.os_name).toBeDefined();
      expect(staticCtx.os_version).toBeDefined();
      expect(staticCtx.device_model).toBeDefined();
      expect(staticCtx.pid).toBe(process.pid);
      expect(typeof staticCtx.total_ram_mb).toBe('number');
      expect(staticCtx.total_ram_mb).toBeGreaterThan(0);
    });

    it('resolves static context for mock Node environment', () => {
      const mockGlobal = {};
      const provider = new ServerEnvironmentProvider(mockGlobal);
      const staticCtx = provider.getStaticContext();

      expect(staticCtx.runtime).toBe('node');
      expect(staticCtx.platform).toBe('node');
      expect(staticCtx.runtime_version).toBe(`Node.js ${process.version}`);
    });

    it('samples live memory and uptime metrics dynamically', () => {
      const provider = new ServerEnvironmentProvider();
      const live = provider.getLiveMetrics();

      expect(typeof live.free_ram_mb).toBe('number');
      expect(live.free_ram_mb).toBeGreaterThanOrEqual(0);
      expect(typeof live.process_uptime_sec).toBe('number');
      expect(live.process_uptime_sec).toBeGreaterThanOrEqual(0);
      expect(typeof live.is_low_memory).toBe('boolean');
    });

    it('combines static and live forensics into complete ServerEnvironmentContext', () => {
      const provider = new ServerEnvironmentProvider();
      const fullCtx = provider.getEnvironmentContext();

      expect(fullCtx.platform).toBeDefined();
      expect(fullCtx.runtime).toBeDefined();
      expect(fullCtx.runtime_version).toBeDefined();
      expect(fullCtx.os_name).toBeDefined();
      expect(fullCtx.os_version).toBeDefined();
      expect(fullCtx.device_model).toBeDefined();
      expect(fullCtx.pid).toBe(process.pid);
      expect(fullCtx.total_ram_mb).toBeGreaterThan(0);
      expect(fullCtx.free_ram_mb).toBeGreaterThanOrEqual(0);
      expect(fullCtx.process_uptime_sec).toBeGreaterThanOrEqual(0);
      expect(typeof fullCtx.is_low_memory).toBe('boolean');
    });

    it('gracefully handles non-numeric memory outputs and native API failures', () => {
      const origFreemem = os.freemem;
      const origTotalmem = os.totalmem;
      const origUptime = process.uptime;

      try {
        (os as any).freemem = () => {
          throw new Error('OS failure');
        };
        (os as any).totalmem = () => NaN;
        (process as any).uptime = () => 'invalid' as any;

        const provider = new ServerEnvironmentProvider();
        const live = provider.getLiveMetrics();

        expect(live.free_ram_mb).toBe(0);
        expect(live.process_uptime_sec).toBe(0);
        expect(live.is_low_memory).toBe(false);

        const staticCtx = provider.getStaticContext();
        expect(staticCtx.total_ram_mb).toBe(0);
      } finally {
        (os as any).freemem = origFreemem;
        (os as any).totalmem = origTotalmem;
        (process as any).uptime = origUptime;
      }
    });

    it('correctly sets is_low_memory flag when free RAM is below 10%', () => {
      const origFreemem = os.freemem;
      const origTotalmem = os.totalmem;

      try {
        // 1000MB total, 50MB free (5% free => is_low_memory true)
        (os as any).totalmem = () => 1000 * 1024 * 1024;
        (os as any).freemem = () => 50 * 1024 * 1024;

        const provider = new ServerEnvironmentProvider();
        const live = provider.getLiveMetrics();

        expect(live.free_ram_mb).toBe(50);
        expect(live.is_low_memory).toBe(true);

        // 1000MB total, 500MB free (50% free => is_low_memory false)
        (os as any).freemem = () => 500 * 1024 * 1024;
        const live2 = provider.getLiveMetrics();
        expect(live2.is_low_memory).toBe(false);
      } finally {
        (os as any).freemem = origFreemem;
        (os as any).totalmem = origTotalmem;
      }
    });
  });
});
