import { describe, test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { packAllPackages } from '../scripts/publish';

const ROOT_DIR = path.resolve(__dirname, '..');
const TARBALLS_DIR = path.join(ROOT_DIR, 'dist', 'tarballs');

const PACKAGES = [
  { name: '@tracex-dev/core', dir: path.join(ROOT_DIR, 'packages', 'core') },
  { name: '@tracex-dev/node', dir: path.join(ROOT_DIR, 'packages', 'node') },
  { name: '@tracex-dev/react', dir: path.join(ROOT_DIR, 'packages', 'react') },
  { name: '@tracex-dev/nextjs', dir: path.join(ROOT_DIR, 'packages', 'nextjs') },
];

describe('NPM Release Pipeline & Manifest Invariance', () => {
  test('on-disk package manifests preserve workspace:* dependencies for local development', () => {
    // 1. Core manifest verification
    const corePkg = JSON.parse(
      fs.readFileSync(path.join(ROOT_DIR, 'packages', 'core', 'package.json'), 'utf8')
    );
    expect(corePkg.name).toBe('@tracex-dev/core');
    expect(corePkg.publishConfig?.access).toBe('public');
    expect(corePkg.license).toBe('MIT');
    expect(corePkg.author).toContain('TraceX Platform Team');
    expect(corePkg.files).toEqual(['dist', 'README.md', 'LICENSE']);

    // 2. Node manifest verification
    const nodePkg = JSON.parse(
      fs.readFileSync(path.join(ROOT_DIR, 'packages', 'node', 'package.json'), 'utf8')
    );
    expect(nodePkg.dependencies?.['@tracex-dev/core']).toBe('workspace:*');
    expect(nodePkg.publishConfig?.access).toBe('public');
    expect(nodePkg.files).toEqual(['dist', 'README.md', 'LICENSE']);

    // 3. React manifest verification
    const reactPkg = JSON.parse(
      fs.readFileSync(path.join(ROOT_DIR, 'packages', 'react', 'package.json'), 'utf8')
    );
    expect(reactPkg.dependencies?.['@tracex-dev/core']).toBe('workspace:*');
    expect(reactPkg.publishConfig?.access).toBe('public');
    expect(reactPkg.files).toEqual(['dist', 'README.md', 'LICENSE']);

    // 4. Next.js manifest verification
    const nextPkg = JSON.parse(
      fs.readFileSync(path.join(ROOT_DIR, 'packages', 'nextjs', 'package.json'), 'utf8')
    );
    expect(nextPkg.dependencies?.['@tracex-dev/core']).toBe('workspace:*');
    expect(nextPkg.dependencies?.['@tracex-dev/node']).toBe('workspace:*');
    expect(nextPkg.dependencies?.['@tracex-dev/react']).toBe('workspace:*');
    expect(nextPkg.publishConfig?.access).toBe('public');
    expect(nextPkg.files).toEqual(['dist', 'README.md', 'LICENSE']);
  });

  test('tarball packaging resolves workspace:* to semver ranges and restores on-disk manifests identically', () => {
    // 1. Snapshot original manifest contents from disk
    const originalContents = new Map<string, string>();
    for (const pkg of PACKAGES) {
      const manifestPath = path.join(pkg.dir, 'package.json');
      originalContents.set(manifestPath, fs.readFileSync(manifestPath, 'utf8'));
    }

    // 2. Run packaging engine
    const { versions } = packAllPackages(true);
    const coreVersion = versions.get('@tracex-dev/core')!;

    // 3. Verify on-disk manifests were immediately and identically restored
    for (const pkg of PACKAGES) {
      const manifestPath = path.join(pkg.dir, 'package.json');
      const postPackContent = fs.readFileSync(manifestPath, 'utf8');
      expect(postPackContent).toBe(originalContents.get(manifestPath)!);
    }

    // 4. Verify tarball contents internally contain resolved semver ranges
    for (const pkg of PACKAGES) {
      const pkgVersion = versions.get(pkg.name)!;
      const cleanPkgName = pkg.name.replace('@', '').replace('/', '-');
      const tarballPath = path.join(TARBALLS_DIR, `${cleanPkgName}-${pkgVersion}.tgz`);

      expect(fs.existsSync(tarballPath)).toBe(true);
      expect(fs.statSync(tarballPath).size).toBeGreaterThan(0);

      // Extract internal package.json
      const extractCmd = `tar -xOf "${tarballPath}" "package/package.json"`;
      const rawPkg = execSync(extractCmd, { encoding: 'utf8' });
      const internalPkg = JSON.parse(rawPkg);

      expect(internalPkg.name).toBe(pkg.name);
      expect(internalPkg.version).toBe(pkgVersion);

      // Verify no workspace: references exist in dependencies
      for (const depKey of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const) {
        const deps = internalPkg[depKey];
        if (deps) {
          for (const [depName, version] of Object.entries(deps)) {
            expect(String(version)).not.toContain('workspace:');
            if (depName.startsWith('@tracex-dev/')) {
              expect(String(version)).toBe(`^${coreVersion}`);
            }
          }
        }
      }
    }
  });

  test('generated tarballs contain README, LICENSE, sourcemaps, and type definitions', () => {
    const coreVersion = JSON.parse(
      fs.readFileSync(path.join(ROOT_DIR, 'packages', 'core', 'package.json'), 'utf8')
    ).version;

    for (const pkg of PACKAGES) {
      const cleanPkgName = pkg.name.replace('@', '').replace('/', '-');
      const tarballPath = path.join(TARBALLS_DIR, `${cleanPkgName}-${coreVersion}.tgz`);

      const listCmd = `tar -tf "${tarballPath}"`;
      const fileList = execSync(listCmd, { encoding: 'utf8' });

      // Must include README.md and LICENSE
      expect(fileList).toContain('package/README.md');
      expect(fileList).toContain('package/LICENSE');
      expect(fileList).toContain('package/package.json');

      // Must include sourcemaps
      expect(fileList).toMatch(/package\/dist\/.*\.map/);

      // Must include typescript types
      expect(fileList).toMatch(/package\/dist\/.*\.d\.ts/);
    }
  });
});
