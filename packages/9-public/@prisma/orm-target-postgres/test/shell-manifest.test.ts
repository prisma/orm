import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ShellConfigError, validateShellManifest } from '@repo/tsdown/shell-build';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../../../..');
const siblings = [
  '@prisma/orm-family-sql',
  '@prisma/orm-framework',
  '@prisma/orm-target-postgres',
  '@prisma/orm-toolchain',
];

interface Manifest {
  readonly version: string;
  readonly dependencies: Record<string, string>;
  readonly peerDependencies: Record<string, string>;
  readonly [field: string]: unknown;
}

function facadeManifest(): Manifest {
  const manifest: Manifest = JSON.parse(
    readFileSync(join(repoRoot, 'packages/9-public/@prisma/orm-postgres/package.json'), 'utf8'),
  );
  const dependencies = { ...manifest.dependencies };
  const peerDependencies = { ...manifest.peerDependencies };
  for (const sibling of siblings) {
    delete dependencies[sibling];
    peerDependencies[sibling] = `workspace:${manifest.version}`;
  }
  return { ...manifest, dependencies, peerDependencies };
}

function validate(manifest: Manifest): () => void {
  return () => validateShellManifest('@prisma/orm-postgres', manifest, repoRoot);
}

describe('the shell build checks a shell manifest against its bundle', () => {
  it('accepts a manifest that names every sibling it reaches as an exact peer', () => {
    expect(validate(facadeManifest())).not.toThrow();
  });

  it('refuses a sibling under dependencies', () => {
    const manifest = facadeManifest();
    const { '@prisma/orm-framework': range, ...peerDependencies } = manifest.peerDependencies;
    const moved = {
      ...manifest,
      dependencies: { ...manifest.dependencies, '@prisma/orm-framework': range },
      peerDependencies,
    };

    expect(validate(moved)).toThrow(ShellConfigError);
    expect(validate(moved)).toThrow(
      'dependencies["@prisma/orm-framework"] names a sibling package; move it to peerDependencies',
    );
  });

  it('refuses a sibling under optionalDependencies', () => {
    const manifest = facadeManifest();
    const optional = {
      ...manifest,
      optionalDependencies: { '@prisma/orm-toolchain': `workspace:${manifest.version}` },
    };

    expect(validate(optional)).toThrow(
      'optionalDependencies["@prisma/orm-toolchain"] names a sibling package; move it to peerDependencies',
    );
  });

  it('refuses a manifest missing the peer on a sibling it reaches', () => {
    const manifest = facadeManifest();
    const { '@prisma/orm-family-sql': _, ...peerDependencies } = manifest.peerDependencies;

    expect(validate({ ...manifest, peerDependencies })).toThrow(
      `peerDependencies["@prisma/orm-family-sql"] should be "workspace:${manifest.version}", got undefined`,
    );
  });

  it('refuses a sibling peer that is not exact to the shell version', () => {
    const manifest = facadeManifest();
    const loose = {
      ...manifest,
      peerDependencies: {
        ...manifest.peerDependencies,
        '@prisma/orm-target-postgres': 'workspace:*',
      },
    };

    expect(validate(loose)).toThrow(ShellConfigError);
  });
});
