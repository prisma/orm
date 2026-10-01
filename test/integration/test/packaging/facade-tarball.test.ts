import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicShells, type ShellName } from '@internal/publish-surface/shells';
import {
  bundledSources,
  findInternalImportSpecifiers,
  findInternalNames,
  importSubpaths,
  installShells,
  type PackedShell,
  packShell,
  runInScratch,
} from '@repo/tsdown/shell-testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const facade = '@prisma/orm-postgres';
const platform: ShellName[] = [
  '@prisma/orm-framework',
  '@prisma/orm-toolchain',
  '@prisma/orm-family-sql',
  '@prisma/orm-target-postgres',
];

function pack(scratch: string, names: readonly ShellName[]): PackedShell[] {
  return names.map((name) => {
    const shell = publicShells.get(name);
    if (shell === undefined) throw new Error(`unknown shell ${name}`);
    return packShell(join(repoRoot, shell.dir), scratch);
  });
}

describe('an application that installs only the Postgres facade', () => {
  let scratch: string;
  let installedDir: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'orm-postgres-facade-'));
    installShells(scratch, pack(scratch, [facade, ...platform]), { direct: [facade] });
    installedDir = join(scratch, 'node_modules', '@prisma', 'orm-postgres');
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('resolves and imports every facade entrypoint', () => {
    const subpaths = importSubpaths(installedDir);
    expect(subpaths.length).toBeGreaterThan(60);
    // The surfaces an application reaches for by hand, as opposed to the ones
    // only generated files name. An application depends on the facade and
    // nothing else, so a missing name here is a package it cannot import at
    // all (ADR 242).
    expect(subpaths).toEqual(
      expect.arrayContaining([
        './orm-client',
        './builder',
        './relational-core',
        './family-runtime',
        './family/control',
        './utils/casts',
        './vite-plugin-contract-emit',
      ]),
    );
    const script = [
      `const subpaths = ${JSON.stringify(subpaths)};`,
      'for (const subpath of subpaths) {',
      `  await import('${facade}' + subpath.slice(1));`,
      '}',
      `console.log('resolved ' + subpaths.length);`,
    ].join('\n');
    expect(runInScratch(scratch, script)).toContain(`resolved ${subpaths.length}`);
  });

  it('pulls every platform shell in transitively', () => {
    const script = [
      "import { createRequire } from 'node:module';",
      `const require = createRequire(import.meta.resolve('${facade}/package.json'));`,
      `const shells = ${JSON.stringify(platform)};`,
      'for (const shell of shells) require.resolve(shell + "/package.json");',
      `console.log('platform ok');`,
    ].join('\n');
    expect(runInScratch(scratch, script)).toContain('platform ok');
  });

  it('puts no prisma-next command on PATH — the unified prisma CLI is the only binary', () => {
    // The published surface is bin-less (the facade forwards no launcher);
    // the unified `prisma` CLI imports the orm command family from
    // @prisma/orm-toolchain/cli instead.
    expect(existsSync(join(scratch, 'node_modules', '.bin', 'prisma-next'))).toBe(false);
  });

  it('installs the catalog-backed Node types required by pg declarations without a helper override', () => {
    const workspaceYaml = readFileSync(join(scratch, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspaceYaml).not.toContain('"@types/node"');
    const output = runInScratch(
      scratch,
      [
        "import { createRequire } from 'node:module';",
        `const require = createRequire(import.meta.resolve('${facade}/package.json'));`,
        "const manifest = require('@types/node/package.json');",
        "console.log(JSON.stringify({ version: manifest.version, undiciTypes: manifest.dependencies?.['undici-types'] }));",
      ].join('\n'),
    );
    expect(JSON.parse(output)).toEqual({ version: '26.1.2', undiciTypes: '~8.3.0' });
  });

  it('bundles only its own wiring code', () => {
    const sources = bundledSources(installedDir);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).toMatch(/^3-extensions\/postgres\//);
    }
  });

  it('ships no unrecorded internal package name in dist', async () => {
    expect(await findInternalNames(installedDir)).toEqual([]);
  });

  it('ships no @internal import specifier in dist', async () => {
    expect(await findInternalImportSpecifiers(installedDir)).toEqual([]);
  });
});

describe('the Postgres facade alongside its platform shells', () => {
  let scratch: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'orm-postgres-identity-'));
    installShells(scratch, pack(scratch, [facade, ...platform]));
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('shares one module instance across every facade to shell boundary', () => {
    const script = `
      import { strict as assert } from 'node:assert';
      const facadeContract = await import('${facade}/contract/is-plain-record');
      const frameworkContract = await import('@prisma/orm-framework/contract/is-plain-record');
      assert.equal(facadeContract.isPlainRecord, frameworkContract.isPlainRecord);

      const facadeComponents = await import('${facade}/components/execution');
      const frameworkComponents = await import('@prisma/orm-framework/components/execution');
      assert.equal(facadeComponents.instantiateExecutionStack, frameworkComponents.instantiateExecutionStack);

      const facadeFamily = await import('${facade}/family-contract/entity-kinds');
      const familyShell = await import('@prisma/orm-family-sql/contract/entity-kinds');
      assert.equal(facadeFamily.tableEntityKind, familyShell.tableEntityKind);

      const facadeAdapter = await import('${facade}/adapter/runtime');
      const targetAdapter = await import('@prisma/orm-target-postgres/adapter/runtime');
      assert.equal(facadeAdapter.default, targetAdapter.default);

      const facadeTarget = await import('${facade}/target');
      const targetPack = await import('@prisma/orm-target-postgres/target/pack');
      assert.equal(facadeTarget.default, targetPack.default);
      console.log('identity ok');
    `;
    expect(runInScratch(scratch, script)).toContain('identity ok');
  });

  it('reaches the ORM client only through the SQL family shell', () => {
    const facadeSources = bundledSources(join(scratch, 'node_modules', '@prisma', 'orm-postgres'));
    expect(facadeSources.filter((s) => s.includes('sql-orm-client'))).toEqual([]);
    const script = `
      import { strict as assert } from 'node:assert';
      const { orm } = await import('@prisma/orm-family-sql/orm-client');
      assert.equal(typeof orm, 'function');
      console.log('orm-client ok');
    `;
    expect(runInScratch(scratch, script)).toContain('orm-client ok');
  });

  // The entrypoints an application reaches for by hand. Each has to be the
  // same module the platform shell publishes, not a second copy: the ORM
  // client's collection registry, the runtime's middleware chain and the
  // family's IR classes are all compared by reference.
  it('shares one module instance for every hand-reached surface', () => {
    const script = `
      import { strict as assert } from 'node:assert';
      const pairs = [
        ['orm-client', '@prisma/orm-family-sql/orm-client', 'orm'],
        ['builder/runtime', '@prisma/orm-family-sql/builder/runtime', 'sql'],
        ['family-runtime', '@prisma/orm-family-sql/runtime', 'withTransaction'],
        ['relational-core/ast', '@prisma/orm-family-sql/relational-core/ast', 'SelectAst'],
        ['family/control', '@prisma/orm-family-sql/family/control', 'default'],
        ['utils/casts', '@prisma/orm-framework/utils/casts', 'castAs'],
      ];
      for (const [subpath, platform, name] of pairs) {
        const viaFacade = await import('@prisma/orm-postgres/' + subpath);
        const viaPlatform = await import(platform);
        assert.equal(typeof viaFacade[name], typeof viaPlatform[name], subpath);
        assert.equal(viaFacade[name], viaPlatform[name], subpath);
      }
      console.log('forwarded identity ok');
    `;
    expect(runInScratch(scratch, script)).toContain('forwarded identity ok');
  });
});
