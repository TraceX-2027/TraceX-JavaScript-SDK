import os from 'node:os';
import { ServerEnvironmentContext } from '../types';

/**
 * Detects whether the current runtime environment is Bun or standard Node.js.
 */
export function detectRuntime(
  targetGlobal: any = globalThis
): { runtime: 'bun' | 'node'; version: string; platform: string } {
  if (typeof targetGlobal.Bun !== 'undefined' && targetGlobal.Bun !== null) {
    return {
      runtime: 'bun',
      version: `Bun ${targetGlobal.Bun.version || 'unknown'}`,
      platform: 'bun',
    };
  }
  const nodeVersion =
    typeof process !== 'undefined' ? process.version || 'unknown' : 'unknown';
  return {
    runtime: 'node',
    version: `Node.js ${nodeVersion}`,
    platform: 'node',
  };
}

/**
 * Provides static server environment context and dynamic runtime forensics
 * (e.g., live RAM metrics, process uptime) for crash payloads.
 */
export class ServerEnvironmentProvider {
  private readonly targetGlobal: any;

  constructor(targetGlobal: any = globalThis) {
    this.targetGlobal = targetGlobal;
  }

  /**
   * Returns runtime detection info.
   */
  public detectRuntime(): { runtime: 'bun' | 'node'; version: string; platform: string } {
    return detectRuntime(this.targetGlobal);
  }

  /**
   * Returns static host and operating system metadata.
   * Completely safe and will not throw if native APIs fail.
   */
  public getStaticContext(): Partial<ServerEnvironmentContext> {
    try {
      const runtimeInfo = this.detectRuntime();
      let hostname: string | undefined;
      let osName = 'unknown';
      let osVersion = 'unknown';
      let deviceModel = 'unknown';
      let pid: number | undefined;
      let totalRamMb = 0;

      try {
        hostname = os.hostname();
      } catch {}

      try {
        osName = os.type();
      } catch {}

      try {
        osVersion = os.release();
      } catch {}

      try {
        deviceModel = `${os.type()} ${os.arch()}`;
      } catch {}

      try {
        pid = process.pid;
      } catch {}

      try {
        const total = typeof os.totalmem === 'function' ? os.totalmem() : 0;
        totalRamMb =
          typeof total === 'number' && !isNaN(total) && isFinite(total)
            ? Math.round(total / (1024 * 1024))
            : 0;
      } catch {}

      return {
        hostname,
        platform: runtimeInfo.platform,
        runtime: runtimeInfo.runtime,
        runtime_version: runtimeInfo.version,
        os_name: osName,
        os_version: osVersion,
        device_model: deviceModel,
        pid,
        total_ram_mb: totalRamMb,
      };
    } catch {
      const runtimeInfo = this.detectRuntime();
      return {
        platform: runtimeInfo.platform,
        runtime: runtimeInfo.runtime,
        runtime_version: runtimeInfo.version,
        os_name: 'unknown',
        os_version: 'unknown',
        device_model: 'unknown',
        total_ram_mb: 0,
      };
    }
  }

  /**
   * Samples dynamic memory and uptime metrics at the exact moment of crash capture.
   * Completely safe and will not throw if native APIs fail.
   */
  public getLiveMetrics(): {
    free_ram_mb: number;
    process_uptime_sec: number;
    is_low_memory: boolean;
  } {
    let freeRamMb = 0;
    let totalRamMb = 0;
    let processUptimeSec = 0;
    let isLowMemory = false;

    try {
      const free = typeof os.freemem === 'function' ? os.freemem() : 0;
      const total = typeof os.totalmem === 'function' ? os.totalmem() : 0;

      freeRamMb =
        typeof free === 'number' && !isNaN(free) && isFinite(free)
          ? Math.round(free / (1024 * 1024))
          : 0;
      totalRamMb =
        typeof total === 'number' && !isNaN(total) && isFinite(total)
          ? Math.round(total / (1024 * 1024))
          : 0;

      isLowMemory = totalRamMb > 0 ? freeRamMb < totalRamMb * 0.1 : false;
    } catch {}

    try {
      const uptime = typeof process.uptime === 'function' ? process.uptime() : 0;
      processUptimeSec =
        typeof uptime === 'number' && !isNaN(uptime) && isFinite(uptime)
          ? Math.round(uptime)
          : 0;
    } catch {}

    return {
      free_ram_mb: freeRamMb,
      process_uptime_sec: processUptimeSec,
      is_low_memory: isLowMemory,
    };
  }

  /**
   * Combines static metadata and current dynamic metrics into a full ServerEnvironmentContext.
   */
  public getEnvironmentContext(): ServerEnvironmentContext {
    return {
      ...this.getStaticContext(),
      ...this.getLiveMetrics(),
    } as ServerEnvironmentContext;
  }
}
