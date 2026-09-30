import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicShells } from '@internal/publish-surface/shells';
import {
  bundledSources,
  findInternalImportSpecifiers,
  findInternalNames,
  importSubpaths,
  installShells,
  knownInternalNamesInDist,
  packShell,
  runInScratch,
} from '@repo/tsdown/shell-testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const allShells = [...publicShells.keys()];
const uncoveredElsewhere = [
  '@prisma/orm-family-mongo',
  '@prisma/orm-target-mongo',
  '@prisma/orm-target-sqlite',
  '@prisma/orm-sqlite',
  '@prisma/orm-mongo',
  '@prisma/orm-extension-postgis',
  '@prisma/orm-extension-paradedb',
  '@prisma/orm-extension-supabase',
  '@prisma/orm-extension-arktype-json',
  '@prisma/orm-extension-middleware-cache',
];
const adrExampleNames = [
  '@prisma/orm-framework/contract',
  '@prisma/orm-framework/components',
  '@prisma/orm-framework/psl-parser',
  '@prisma/orm-family-sql/contract',
  '@prisma/orm-family-sql/runtime',
  '@prisma/orm-family-sql/orm-client',
  '@prisma/orm-target-postgres/target',
  '@prisma/orm-target-postgres/target/runtime',
  '@prisma/orm-target-postgres/adapter',
  '@prisma/orm-target-postgres/driver',
  '@prisma/orm-target-postgres/driver/runtime',
  '@prisma/orm-toolchain/cli',
  '@prisma/orm-postgres/runtime',
  '@prisma/orm-postgres/contract',
  '@prisma/orm-postgres/components',
  '@prisma/orm-sqlite/runtime',
  '@prisma/orm-mongo/runtime',
];

describe('all publish shells packed and installed together', () => {
  let scratch: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'orm-all-shells-smoke-'));
    installShells(
      scratch,
      allShells.map((name) => {
        const shell = publicShells.get(name);
        if (shell === undefined) throw new Error(`unknown shell ${name}`);
        return packShell(join(repoRoot, shell.dir), scratch);
      }),
    );
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('installs every shell', () => {
    for (const name of allShells) {
      expect(existsSync(join(scratch, 'node_modules', name, 'package.json'))).toBe(true);
    }
  });

  it('resolves and imports every entrypoint of the shells not covered by the chain test', () => {
    const imports: string[] = [];
    for (const name of uncoveredElsewhere) {
      const installedDir = join(scratch, 'node_modules', name);
      for (const subpath of importSubpaths(installedDir)) {
        imports.push(`${name}${subpath.slice(1)}`);
      }
    }
    const script = [
      `const specifiers = ${JSON.stringify(imports)};`,
      'for (const specifier of specifiers) {',
      '  await import(specifier);',
      '}',
      "console.log('resolved ' + specifiers.length);",
    ].join('\n');
    expect(runInScratch(scratch, script)).toContain(`resolved ${imports.length}`);
  });

  it('resolves the aggregate entrypoint names promised by ADR 242', () => {
    const script = [
      `const specifiers = ${JSON.stringify(adrExampleNames)};`,
      'for (const specifier of specifiers) {',
      '  const mod = await import(specifier);',
      '  if (Object.keys(mod).length === 0) throw new Error(specifier + " is empty");',
      '}',
      "console.log('adr names ok');",
    ].join('\n');
    expect(runInScratch(scratch, script)).toContain('adr names ok');
  });

  it('ships no unrecorded internal package name in any shell dist', async () => {
    for (const name of allShells) {
      const installedDir = join(scratch, 'node_modules', name);
      expect(await findInternalNames(installedDir)).toEqual([]);
    }
  });

  it('ships no @internal import specifier in any shell dist', async () => {
    for (const name of allShells) {
      const installedDir = join(scratch, 'node_modules', name);
      expect(await findInternalImportSpecifiers(installedDir)).toEqual([]);
    }
  });

  // The toolchain publishes the shell map so that emission can resolve
  // import roots at run time, which puts every internal package name into a
  // published dist as string data. The scan above has to keep passing
  // *without* those names joining the baseline allowlist: absorbing ~50
  // entries there would stop the scan noticing an internal name anywhere
  // else in any shell. This states how much of the table is passing on the
  // data allowance rather than on the allowlist.
  it('carries the shell map’s internal names as data rather than on the allowlist', () => {
    const toolchainDist = join(scratch, 'node_modules', '@prisma/orm-toolchain', 'dist');
    const carried = new Set<string>();
    for (const file of readdirSync(toolchainDist)) {
      if (!file.endsWith('.mjs')) continue;
      for (const match of readFileSync(join(toolchainDist, file), 'utf8').matchAll(
        /["'](@internal\/[^"'\s]+)["']/g,
      )) {
        carried.add(match[1] ?? '');
      }
    }

    const mapped = [...publicShells.values()].flatMap((shell) =>
      shell.packages.map((pkg) => pkg.name),
    );
    expect(mapped.filter((name) => carried.has(name)).length).toBeGreaterThan(40);
    const onDataAllowanceOnly = mapped.filter(
      (name) => carried.has(name) && !knownInternalNamesInDist.includes(name),
    );
    expect(onDataAllowanceOnly.length).toBeGreaterThan(25);
  });

  // The identity rule of ADR 242: an internal module is published from
  // exactly one package. A shell that bundled a module mapped to another
  // shell would ship a second copy of it, breaking shared registries and
  // `instanceof` for anyone who installs both.
  it('bundles only the internal packages mapped to it', () => {
    const strays: string[] = [];
    for (const name of allShells) {
      const shell = publicShells.get(name);
      if (shell === undefined) throw new Error(`unknown shell ${name}`);
      const owned = shell.packages.map((pkg) => `${pkg.dir}/`);
      const sources = bundledSources(join(scratch, 'node_modules', name));
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        const path = `packages/${source}`;
        if (!owned.some((dir) => path.startsWith(dir))) strays.push(`${name}: ${path}`);
      }
    }
    expect(strays).toEqual([]);
  });
});
