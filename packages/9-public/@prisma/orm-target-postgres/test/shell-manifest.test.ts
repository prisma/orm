import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
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
  readonly devDependencies: Record<string, string>;
  readonly [field: string]: unknown;
}

function facadeManifest(): Manifest {
  const manifest: Manifest = JSON.parse(
    readFileSync(join(repoRoot, 'packages/9-public/@prisma/orm-postgres/package.json'), 'utf8'),
  );
  const dependencies = { ...manifest.dependencies };
  const peerDependencies = { ...manifest.peerDependencies };
  const devDependencies = { ...manifest.devDependencies };
  for (const sibling of siblings) {
    delete dependencies[sibling];
    peerDependencies[sibling] = `workspace:${manifest.version}`;
    devDependencies[sibling] = `workspace:${manifest.version}`;
  }
  return { ...manifest, dependencies, peerDependencies, devDependencies };
}

/** Links every entry of `from` into `to`, except `except`, which `to` gets as an empty folder. */
function linkAllBut(from: string, to: string, except: string): void {
  mkdirSync(join(to, except), { recursive: true });
  for (const entry of readdirSync(from)) {
    if (entry !== except) symlinkSync(join(from, entry), join(to, entry));
  }
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

    expect(validate(loose)).toThrow(
      `peerDependencies["@prisma/orm-target-postgres"] should be "workspace:${manifest.version}", got "workspace:*"`,
    );
  });

  it('refuses a sibling peer missing from devDependencies', () => {
    const manifest = facadeManifest();
    const { '@prisma/orm-toolchain': _, ...devDependencies } = manifest.devDependencies;

    expect(validate({ ...manifest, devDependencies })).toThrow(
      `devDependencies["@prisma/orm-toolchain"] should be "workspace:${manifest.version}", got undefined`,
    );
  });

  it('refuses a sibling peer marked optional', () => {
    const manifest = facadeManifest();
    const optionalPeer = {
      ...manifest,
      peerDependenciesMeta: { '@prisma/orm-framework': { optional: true } },
    };

    expect(validate(optionalPeer)).toThrow(
      'peerDependenciesMeta["@prisma/orm-framework"] marks a sibling package optional; an application must list it',
    );
  });

  it('requires the release plan’s range on the levels line, under peers and development copies', () => {
    const atRange = (range: string): Manifest => {
      const manifest = facadeManifest();
      return {
        ...manifest,
        peerDependencies: Object.fromEntries(
          Object.entries(manifest.peerDependencies).map(([name, spec]) => [
            name,
            siblings.includes(name) ? `workspace:${range}` : spec,
          ]),
        ),
        devDependencies: Object.fromEntries(
          Object.entries(manifest.devDependencies).map(([name, spec]) => [
            name,
            siblings.includes(name) ? `workspace:${range}` : spec,
          ]),
        ),
      };
    };

    expect(() =>
      validateShellManifest('@prisma/orm-postgres', atRange('~8.1.0'), repoRoot, '8.1.0'),
    ).not.toThrow();
    expect(() =>
      validateShellManifest('@prisma/orm-postgres', atRange('8.1.0'), repoRoot, '8.1.0'),
    ).toThrow(
      'peerDependencies["@prisma/orm-framework"] should be "workspace:~8.1.0", got "workspace:8.1.0"',
    );
  });

  it('names the pair and their levels when a package names one of ours at a lower level', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'shell-manifest-levels-'));
    try {
      linkAllBut(repoRoot, scratch, 'packages');
      linkAllBut(join(repoRoot, 'packages'), join(scratch, 'packages'), '9-public');
      linkAllBut(
        join(repoRoot, 'packages/9-public'),
        join(scratch, 'packages/9-public'),
        '@prisma',
      );
      const published = join(scratch, 'packages/9-public/@prisma');
      for (const dir of readdirSync(join(repoRoot, 'packages/9-public/@prisma'))) {
        mkdirSync(join(published, dir), { recursive: true });
        cpSync(
          join(repoRoot, 'packages/9-public/@prisma', dir, 'package.json'),
          join(published, dir, 'package.json'),
        );
      }
      const postgres = join(published, 'orm-postgres/package.json');
      const manifest = JSON.parse(readFileSync(postgres, 'utf8'));
      manifest.peerDependencies['@prisma/orm-mongo'] = `workspace:${manifest.version}`;
      writeFileSync(postgres, JSON.stringify(manifest));

      expect(() =>
        validateShellManifest('@prisma/orm-postgres', facadeManifest(), scratch, '8.1.0'),
      ).toThrow('@prisma/orm-postgres (ga) names @prisma/orm-mongo (ea)');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
