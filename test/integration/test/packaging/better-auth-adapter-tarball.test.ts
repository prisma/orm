import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicShells, type ShellName } from '@internal/publish-surface/shells';
import {
  installShells,
  type PackedShell,
  packShell,
  packShellAtVersion,
  runInScratch,
  tryInstallShells,
} from '@repo/tsdown/shell-testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const workspaceVersion = (
  JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }
).version;
const skewedVersion = workspaceVersion.replace(/\d+$/, (patch) => String(Number(patch) + 1));
const adapter = '@prisma/better-auth-adapter';
const adapterDir = join(repoRoot, 'packages/9-public/@prisma/better-auth-adapter');
const facade = '@prisma/orm-sqlite';
const familySql = '@prisma/orm-family-sql';
const platform: ShellName[] = [
  '@prisma/orm-framework',
  '@prisma/orm-toolchain',
  '@prisma/orm-family-sql',
  '@prisma/orm-target-sqlite',
];

function pack(scratch: string, names: readonly ShellName[]): PackedShell[] {
  return names.map((name) => {
    const shell = publicShells.get(name);
    if (shell === undefined) throw new Error(`unknown shell ${name}`);
    return packShell(join(repoRoot, shell.dir), scratch);
  });
}

const corePsl = readFileSync(join(repoRoot, 'examples/better-auth/prisma/contract.prisma'), 'utf8');

// The install the adapter's README gives: the adapter at the database
// package's version, and Better Auth 1.7 from the registry. The adapter's
// two Prisma peers are declared too, because pnpm resolves a peer through
// the registry rather than through the tarball overrides, and these exact
// versions are not on the registry until they are released. From the
// registry the peers and the database package's dependencies are the same
// packages; the one-copy assertion below checks that here.
describe('the Better Auth adapter installed next to the SQLite database package', () => {
  let scratch: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'better-auth-adapter-'));
    installShells(
      scratch,
      [packShell(adapterDir, scratch), ...pack(scratch, [facade, ...platform])],
      {
        direct: [adapter, facade, familySql, '@prisma/orm-framework'],
        registryDependencies: { 'better-auth': '1.7' },
      },
    );
    writeFileSync(join(scratch, 'contract.prisma'), corePsl);
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('loads one copy of the ORM client and of Better Auth core', () => {
    const script = `
      import { strict as assert } from 'node:assert';
      import { createRequire } from 'node:module';
      import { realpathSync } from 'node:fs';
      const from = (specifier) => createRequire(import.meta.resolve(specifier));
      const where = (requireFrom, specifier) => realpathSync(requireFrom.resolve(specifier));
      const viaAdapter = from('${adapter}');
      assert.equal(where(viaAdapter, '${familySql}/package.json'), where(from('${facade}/runtime'), '${familySql}/package.json'));
      assert.equal(where(viaAdapter, '@better-auth/core/error'), where(from('better-auth'), '@better-auth/core/error'));
      console.log('one copy');
    `;
    expect(runInScratch(scratch, script)).toContain('one copy');
  });

  it('signs a user up through Better Auth', () => {
    const script = `
      import { strict as assert } from 'node:assert';
      import { mkdirSync } from 'node:fs';
      import { betterAuth } from 'better-auth';
      import { prismaAdapter } from '${adapter}';
      import { defineConfig } from '${facade}/config';
      import { createSqliteControlClient } from '${facade}/control';
      import sqlite from '${facade}/runtime';
      import { contractFromJson } from '${facade}/static';

      const { contract: contractConfig } = defineConfig({ contract: './contract.prisma' });
      const emitted = await createSqliteControlClient().emit({ contractConfig });
      if (!emitted.ok) throw new Error(JSON.stringify(emitted.failure));
      const json = JSON.parse(emitted.value.contractJson);
      mkdirSync('./migrations', { recursive: true });
      const control = createSqliteControlClient({ connection: './auth.db' });
      const init = await control.dbInit({
        invocation: { cwd: process.cwd(), configPath: undefined, dbGiven: false },
        contract: json,
        mode: 'apply',
        migrationsDir: './migrations',
      });
      await control.close();
      if (!init.ok) throw new Error(JSON.stringify(init.failure));

      const db = sqlite({ contract: contractFromJson(json), path: './auth.db' });
      const auth = betterAuth({
        database: prismaAdapter(db),
        emailAndPassword: { enabled: true },
        secret: 'a-test-secret-that-is-long-enough-for-better-auth',
        baseURL: 'http://localhost:3000',
      });
      const { user } = await auth.api.signUpEmail({
        body: { email: 'ada@example.com', password: 'a-long-password', name: 'Ada' },
      });
      assert.equal(user.email, 'ada@example.com');
      await db.close();
      console.log('signed up');
    `;
    expect(runInScratch(scratch, script)).toContain('signed up');
  });
});

// What the exact peers buy: an application that upgrades its database
// package and not the adapter gets an install error under strict peers,
// instead of a second copy of the ORM client's filter functions.
describe('the Better Auth adapter next to an ORM client of a different version', () => {
  let scratch: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'better-auth-adapter-skew-'));
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('fails to install under strict peers', () => {
    const familyDir = publicShells.get(familySql)?.dir;
    if (familyDir === undefined) throw new Error(`unknown shell ${familySql}`);
    const packed = [
      packShell(adapterDir, scratch),
      ...pack(scratch, ['@prisma/orm-framework', '@prisma/orm-toolchain']),
      packShellAtVersion(join(repoRoot, familyDir), scratch, skewedVersion),
    ];
    const result = tryInstallShells(scratch, packed, {
      direct: [adapter, familySql, '@prisma/orm-framework'],
      registryDependencies: { '@better-auth/core': '1.7' },
      npmrc: ['strict-peer-dependencies=true', 'auto-install-peers=false'],
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain(`unmet peer ${familySql}`);
    expect(result.output).toContain(skewedVersion);
  });
});
