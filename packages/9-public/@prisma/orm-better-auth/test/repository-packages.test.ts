import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, normalize, relative } from 'pathe';
import { describe, expect, it } from 'vitest';

type Manifest = Record<string, Record<string, string> | undefined>;

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const thisFile = normalize(fileURLToPath(import.meta.url));
const allowedRepositoryPackages = ['@repo/tsconfig', '@repo/tsdown'];
const repositoryPackageName = /@repo\/[a-z0-9-]+/g;
const publishedSections = ['dependencies', 'peerDependencies', 'optionalDependencies'];

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

function repositoryPackagesInPublishedSections(manifest: Manifest): string[] {
  return publishedSections.flatMap((section) =>
    Object.entries(manifest[section] ?? {})
      .filter(([name, target]) => name.startsWith('@repo/') || target.includes('@repo/'))
      .map(([name, target]) => `${section}: ${name} ${target}`),
  );
}

describe('repository packages', () => {
  it('the manifest names only the shared build and TypeScript configs, as dev dependencies', async () => {
    const manifest: Manifest = JSON.parse(
      await readFile(join(packageRoot, 'package.json'), 'utf8'),
    );
    const named = await repositoryPackagesNamedIn(join(packageRoot, 'package.json'));
    expect(named.filter((name) => !allowedRepositoryPackages.includes(name))).toEqual([]);
    expect(repositoryPackagesInPublishedSections(manifest)).toEqual([]);
  });

  it('a repository package aliased under another name counts as a repository package', () => {
    expect(
      repositoryPackagesInPublishedSections({
        devDependencies: { '@repo/tsdown': 'workspace:*' },
        optionalDependencies: { buildConfig: 'npm:@repo/tsdown@8.0.0-rc.24' },
      }),
    ).toEqual(['optionalDependencies: buildConfig npm:@repo/tsdown@8.0.0-rc.24']);
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
