import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, execSync } from 'node:child_process';

const ROOT_DIR = path.resolve(__dirname, '..');
const TARBALLS_DIR = path.join(ROOT_DIR, 'dist', 'tarballs');

interface PackageConfig {
  name: string;
  dir: string;
  absDir: string;
  pkgJsonPath: string;
}

const PACKAGES: PackageConfig[] = [
  {
    name: '@tracex-dev/core',
    dir: 'packages/core',
    absDir: path.join(ROOT_DIR, 'packages', 'core'),
    pkgJsonPath: path.join(ROOT_DIR, 'packages', 'core', 'package.json'),
  },
  {
    name: '@tracex-dev/node',
    dir: 'packages/node',
    absDir: path.join(ROOT_DIR, 'packages', 'node'),
    pkgJsonPath: path.join(ROOT_DIR, 'packages', 'node', 'package.json'),
  },
  {
    name: '@tracex-dev/react',
    dir: 'packages/react',
    absDir: path.join(ROOT_DIR, 'packages', 'react'),
    pkgJsonPath: path.join(ROOT_DIR, 'packages', 'react', 'package.json'),
  },
  {
    name: '@tracex-dev/nextjs',
    dir: 'packages/nextjs',
    absDir: path.join(ROOT_DIR, 'packages', 'nextjs'),
    pkgJsonPath: path.join(ROOT_DIR, 'packages', 'nextjs', 'package.json'),
  },
];

interface ManifestSnapshot {
  pkgPath: string;
  originalRaw: string;
}

const originalManifests: ManifestSnapshot[] = [];
let manifestsRestored = false;

// Record original manifests
for (const pkg of PACKAGES) {
  const raw = fs.readFileSync(pkg.pkgJsonPath, 'utf8');
  originalManifests.push({ pkgPath: pkg.pkgJsonPath, originalRaw: raw });
}

export function restoreManifests(): void {
  if (manifestsRestored) return;
  manifestsRestored = true;
  for (const item of originalManifests) {
    try {
      fs.writeFileSync(item.pkgPath, item.originalRaw, 'utf8');
    } catch (err) {
      console.error(`[ERROR] Failed to restore manifest at ${item.pkgPath}:`, err);
    }
  }
}

let hooksRegistered = false;
export function registerProcessHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;

  process.on('SIGINT', () => {
    restoreManifests();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    restoreManifests();
    process.exit(143);
  });
  process.on('exit', () => {
    restoreManifests();
  });
  process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT EXCEPTION]:', err);
    restoreManifests();
    process.exit(1);
  });
}

export function substituteManifests(): Map<string, string> {
  manifestsRestored = false;
  const packageVersions = new Map<string, string>();

  // Extract versions first
  for (const pkg of PACKAGES) {
    const raw = fs.readFileSync(pkg.pkgJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    packageVersions.set(pkg.name, parsed.version);
  }

  // Substitute workspace:* with ^<version>
  for (const pkg of PACKAGES) {
    const raw = fs.readFileSync(pkg.pkgJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    let mutated = false;

    for (const depKey of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
      const deps = parsed[depKey];
      if (deps && typeof deps === 'object') {
        for (const [depName, version] of Object.entries(deps)) {
          if (typeof version === 'string' && (version === 'workspace:*' || version.startsWith('workspace:'))) {
            const targetVersion = packageVersions.get(depName) || parsed.version;
            deps[depName] = `^${targetVersion}`;
            mutated = true;
          }
        }
      }
    }

    if (mutated) {
      fs.writeFileSync(pkg.pkgJsonPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
    }
  }

  return packageVersions;
}

export function withSubstitutedManifests<T>(action: (versions: Map<string, string>) => T): T {
  const versions = substituteManifests();
  try {
    return action(versions);
  } finally {
    restoreManifests();
  }
}

export function verifyTarball(tarballPath: string, expectedPkgName: string, expectedVersion: string): void {
  if (!fs.existsSync(tarballPath)) {
    throw new Error(`Tarball not found: ${tarballPath}`);
  }
  const stat = fs.statSync(tarballPath);
  if (stat.size === 0) {
    throw new Error(`Tarball is empty (0 bytes): ${tarballPath}`);
  }

  const hash = crypto.createHash('sha256').update(fs.readFileSync(tarballPath)).digest('hex');

  // Extract package/package.json from the tarball
  const extractCmd = `tar -xOf "${tarballPath}" "package/package.json"`;
  let rawPkgJson: string;
  try {
    rawPkgJson = execSync(extractCmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err: any) {
    throw new Error(`Failed to extract package.json from ${tarballPath}: ${err.message}`);
  }

  const pkgJson = JSON.parse(rawPkgJson);
  if (pkgJson.name !== expectedPkgName) {
    throw new Error(`Expected package name "${expectedPkgName}", found "${pkgJson.name}"`);
  }
  if (pkgJson.version !== expectedVersion) {
    throw new Error(`Expected package version "${expectedVersion}", found "${pkgJson.version}"`);
  }

  // Check dependencies and peerDependencies specifically for workspace: references
  for (const depKey of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
    const deps = pkgJson[depKey];
    if (deps && typeof deps === 'object') {
      for (const [depName, version] of Object.entries(deps)) {
        if (typeof version === 'string' && version.includes('workspace:')) {
          throw new Error(
            `Verification FAILED: ${tarballPath} contains forbidden "workspace:" reference in ${depKey}['${depName}']: "${version}"`
          );
        }
        if (depName.startsWith('@tracex-dev/')) {
          if (!String(version).startsWith('^')) {
            throw new Error(`Verification FAILED: ${depName} version "${version}" does not start with "^"`);
          }
        }
      }
    }
  }

  const sizeKb = (stat.size / 1024).toFixed(1);
  console.log(`  📦 Verified ${expectedPkgName}@${expectedVersion} -> ${path.basename(tarballPath)} (${sizeKb} kB, sha256: ${hash.slice(0, 12)}...)`);
}

export function packAllPackages(skipBuild = false): { tarballsDir: string; versions: Map<string, string> } {
  if (!skipBuild) {
    console.log('\n🔨 Building packages before packaging...');
    const buildRes = spawnSync('bun', ['run', 'build'], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      shell: true,
      env: { ...process.env },
    });
    if (buildRes.status !== 0) {
      throw new Error(`Package build failed with code ${buildRes.status}`);
    }
  }

  fs.mkdirSync(TARBALLS_DIR, { recursive: true });

  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  const versions = withSubstitutedManifests((pkgVersions) => {
    console.log(`\n📦 Packaging tarballs into ${TARBALLS_DIR} (Topological Order)...`);
    for (const pkg of PACKAGES) {
      const pkgVersion = pkgVersions.get(pkg.name)!;
      console.log(`  > Packing ${pkg.name}@${pkgVersion}...`);
      const packRes = spawnSync(npmCmd, ['pack', '--pack-destination', TARBALLS_DIR], {
        cwd: pkg.absDir,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env },
      });
      if (packRes.status !== 0) {
        throw new Error(`npm pack failed for ${pkg.name} with code ${packRes.status}`);
      }
    }
    return pkgVersions;
  });

  console.log('\n🔍 Verifying generated tarballs (0 workspace references, resolved semver ranges)...');
  for (const pkg of PACKAGES) {
    const pkgVersion = versions.get(pkg.name)!;
    const cleanPkgName = pkg.name.replace('@', '').replace('/', '-');
    const tarballPath = path.join(TARBALLS_DIR, `${cleanPkgName}-${pkgVersion}.tgz`);
    verifyTarball(tarballPath, pkg.name, pkgVersion);
  }

  console.log('✅ All 4 tarballs successfully created and verified!\n');
  return { tarballsDir: TARBALLS_DIR, versions };
}

function runGate(desc: string, command: string, args: string[]): void {
  console.log(`\n⏳ Gate Check: ${desc} (${command} ${args.join(' ')})...`);
  const res = spawnSync(command, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env },
  });
  if (res.status !== 0) {
    throw new Error(`Gate failed: ${desc} exited with code ${res.status}`);
  }
  console.log(`✅ Gate passed: ${desc}`);
}

export function runRelease(options: { dryRun?: boolean; skipGates?: boolean; skipBuild?: boolean; provenance?: boolean }): void {
  const isDryRun = options.dryRun ?? false;
  const skipGates = options.skipGates ?? false;
  const skipBuild = options.skipBuild ?? false;
  const useProvenance = options.provenance ?? (process.env.GITHUB_ACTIONS === 'true');

  console.log('====================================================');
  console.log(` TraceX SDK Suite Release Pipeline [${isDryRun ? 'DRY-RUN' : 'PRODUCTION'}]`);
  console.log('====================================================');

  if (!skipGates) {
    runGate('TypeScript Typecheck', 'bun', ['run', 'typecheck']);
    runGate('Unit & E2E Tests', 'bun', ['test']);
    if (!skipBuild) {
      runGate('Package Compilation', 'bun', ['run', 'build']);
    }
    packAllPackages(true);
    runGate('External Sandbox Verification', 'bun', ['run', 'test:sandbox']);
  } else if (!skipBuild) {
    runGate('Package Compilation', 'bun', ['run', 'build']);
  }

  // Pre-publish auth check if not dry-run
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const publishEnv = { ...process.env };
  if (!isDryRun) {
    const token = process.env.NPM_TOKEN || process.env.NODE_AUTH_TOKEN;
    if (token) {
      publishEnv.NODE_AUTH_TOKEN = token;
      publishEnv.NPM_TOKEN = token;
    } else {
      const whoami = spawnSync(npmCmd, ['whoami'], {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        shell: true,
        env: publishEnv,
      });
      if (whoami.status !== 0) {
        throw new Error(
          'Missing npm authentication! Set NPM_TOKEN environment variable or run "npm login" before publishing.'
        );
      }
    }
  }

  // Read current package versions
  const pkgVersions = new Map<string, string>();
  for (const pkg of PACKAGES) {
    const raw = fs.readFileSync(pkg.pkgJsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    pkgVersions.set(pkg.name, parsed.version);
  }

  // Ensure all tarballs exist in dist/tarballs (pack them if missing)
  const missingTarball = PACKAGES.some((pkg) => {
    const cleanPkgName = pkg.name.replace('@', '').replace('/', '-');
    const version = pkgVersions.get(pkg.name)!;
    return !fs.existsSync(path.join(TARBALLS_DIR, `${cleanPkgName}-${version}.tgz`));
  });

  if (missingTarball) {
    packAllPackages(skipBuild);
  }

  console.log(`\n🚀 Executing npm publish for pre-packaged tarballs (Topological Order${isDryRun ? ' - Dry Run' : ''})...\n`);

  for (const pkg of PACKAGES) {
    const pkgVersion = pkgVersions.get(pkg.name)!;
    const cleanPkgName = pkg.name.replace('@', '').replace('/', '-');
    const tarballPath = path.join(TARBALLS_DIR, `${cleanPkgName}-${pkgVersion}.tgz`);

    console.log(`----------------------------------------------------`);
    console.log(`📦 Publishing Tarball: ${cleanPkgName}-${pkgVersion}.tgz (${pkg.name}@${pkgVersion})`);
    console.log(`----------------------------------------------------`);

    const publishArgs = ['publish', tarballPath, '--access', 'public'];
    if (isDryRun) {
      publishArgs.push('--dry-run');
    }
    if (useProvenance && !isDryRun) {
      publishArgs.push('--provenance');
    }

    const pubRes = spawnSync(npmCmd, publishArgs, {
      cwd: ROOT_DIR,
      stdio: 'pipe',
      shell: true,
      encoding: 'utf8',
      env: publishEnv,
    });

    if (pubRes.stdout) {
      process.stdout.write(pubRes.stdout);
    }
    if (pubRes.stderr) {
      process.stderr.write(pubRes.stderr);
    }

    if (pubRes.status !== 0) {
      const output = `${pubRes.stdout || ''} ${pubRes.stderr || ''}`;
      const isAlreadyPublished =
        output.includes('cannot publish over previously published versions') ||
        output.includes('You cannot publish over the previously published versions') ||
        output.includes('E403') ||
        output.includes('EPUBLISHCONFLICT') ||
        (output.includes('403 Forbidden') && output.includes('previously published'));

      if (isAlreadyPublished) {
        console.warn(`\n⚠️  [ALREADY PUBLISHED] ${pkg.name}@${pkgVersion} is already published on registry. Skipping...\n`);
      } else {
        throw new Error(
          `Publish failed for ${pkg.name}@${pkgVersion} with exit code ${pubRes.status}. Cascade halted!`
        );
      }
    }
  }

  console.log('\n====================================================');
  console.log(`🎉 Release pipeline completed successfully for all 4 packages!`);
  console.log('====================================================\n');
}

// CLI Execution Entrypoint
if (import.meta.main) {
  registerProcessHooks();
  const args = process.argv.slice(2);
  const isPackOnly = args.includes('--pack') || args.includes('pack');
  const isDryRun = args.includes('--dry-run') || args.includes('dry-run');
  const skipGates = args.includes('--skip-gates');
  const skipBuild = args.includes('--skip-build');
  const provenance = args.includes('--provenance');

  try {
    if (isPackOnly) {
      packAllPackages(skipBuild);
    } else {
      runRelease({
        dryRun: isDryRun,
        skipGates,
        skipBuild,
        provenance,
      });
    }
  } catch (err: any) {
    console.error('\n❌ Release script failed:', err.message || err);
    process.exit(1);
  }
}
