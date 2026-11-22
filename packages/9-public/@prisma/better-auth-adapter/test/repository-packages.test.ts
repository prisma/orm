import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'pathe';
import { describe, expect, it } from 'vitest';

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const thisFile = fileURLToPath(import.meta.url);
const allowedRepositoryPackages = ['@repo/tsconfig', '@repo/tsdown'];
const repositoryPackageName = /@repo\/[a-z0-9-]+/g;

async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => path !== thisFile);
}

async function repositoryPackagesNamedIn(path: string): Promise<string[]> {
  const text = await readFile(path, 'utf8');
  return [...text.matchAll(repositoryPackageName)].map(([name]) => name);
}

describe('repository packages', () => {
  it('the manifest names only the shared build and TypeScript configs, as dev dependencies', async () => {
    const manifest: Record<string, Record<string, string> | undefined> = JSON.parse(
      await readFile(join(packageRoot, 'package.json'), 'utf8'),
    );
    const named = await repositoryPackagesNamedIn(join(packageRoot, 'package.json'));
    expect(named.filter((name) => !allowedRepositoryPackages.includes(name))).toEqual([]);
    for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      expect(
        Object.keys(manifest[section] ?? {}).filter((name) => name.startsWith('@repo/')),
      ).toEqual([]);
    }
  });

  it('no source or test file names a repository package', async () => {
    const files = [
      ...(await filesUnder(join(packageRoot, 'src'))),
      ...(await filesUnder(join(packageRoot, 'test'))),
    ];
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const file of files) {
      for (const name of await repositoryPackagesNamedIn(file)) {
        offenders.push(`${relative(packageRoot, file)}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
