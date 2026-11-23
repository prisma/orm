import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
const adapter = '@prisma/orm-better-auth';
const adapterDir = join(repoRoot, 'packages/9-public/@prisma/orm-better-auth');
const betterAuthFloor = (() => {
  const manifest = JSON.parse(readFileSync(join(adapterDir, 'package.json'), 'utf8')) as {
    peerDependencies: Record<string, string>;
  };
  const floor = /^>=(\S+) /.exec(manifest.peerDependencies['@better-auth/core'] ?? '')?.[1];
  if (floor === undefined) throw new Error('The adapter declares no lowest @better-auth/core');
  return floor;
})();
const facade = '@prisma/orm-sqlite';
const familySql = '@prisma/orm-family-sql';
const toolchain = '@prisma/orm-toolchain';
const cliEngine = '@prisma/cli-engine';
const cliEngineVersion = (() => {
  const toolchainDir = publicShells.get(toolchain)?.dir;
  if (toolchainDir === undefined) throw new Error(`unknown shell ${toolchain}`);
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, toolchainDir, 'package.json'), 'utf8'),
  ) as {
    peerDependencies: Record<string, string>;
  };
  const version = manifest.peerDependencies[cliEngine];
  if (version === undefined) throw new Error(`${toolchain} declares no ${cliEngine} peer`);
  return version;
})();
const platform: ShellName[] = [
  '@prisma/orm-framework',
  toolchain,
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

const twoFactorMissing = `Your Prisma contract is missing models or fields that Better Auth needs.

Add to your contract:

model User {
  twoFactorEnabled Boolean?
  twoFactors       TwoFactor[]
}

model TwoFactor {
  id                      String    @id
  secret                  String
  backupCodes             String
  userId                  String
  user                    User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  verified                Boolean?
  failedVerificationCount Int?
  lockedUntil             DateTime?

  @@index([secret])
  @@index([userId])
  @@map("twoFactor")
}

Then run \`prisma contract emit\` and update your database.`;

const twoFactorModel = twoFactorMissing.slice(
  twoFactorMissing.indexOf('model TwoFactor'),
  twoFactorMissing.indexOf('\n\nThen run'),
);

const twoFactorAdded =
  'Adding 2 fields to User and the model TwoFactor to prisma/contract.prisma. After the file is written, run `prisma contract emit` and update your database.';

const prismaConfig = `import { definePrismaConfig } from '${cliEngine}';
import { defineConfig } from '${facade}/config';

export default definePrismaConfig({ orm: defineConfig({ contract: './prisma/contract.prisma' }) });
`;

const twoFactorAuth = `import { prismaAdapter } from '${adapter}';
import { betterAuth } from 'better-auth';
import { twoFactor } from 'better-auth/plugins';
import { db } from './db';

export const auth = betterAuth({
  database: prismaAdapter(db),
  emailAndPassword: { enabled: true },
  plugins: [twoFactor()],
});
`;

const sqliteClient = `import sqlite from '${facade}/runtime';
import { contractFromJson } from '${facade}/static';
import contractJson from '../../prisma/contract.json' with { type: 'json' };

export const db = sqlite({ contract: contractFromJson(contractJson), path: './auth.db' });
`;

interface AuthRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function runAuth(projectDir: string, scratch: string, args: readonly string[]): AuthRun {
  const run = spawnSync(join(scratch, 'node_modules/.bin/auth'), [...args], {
    cwd: projectDir,
    encoding: 'utf-8',
    env: {
      ...process.env,
      BETTER_AUTH_SECRET: 'a-test-secret-that-is-long-enough-for-better-auth',
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_TELEMETRY: '0',
      NO_COLOR: '1',
    },
  });
  if (run.error !== undefined) throw run.error;
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** Every file under `dir` outside `node_modules`, by relative path, with its content. */
function projectFiles(dir: string): Record<string, string> {
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !path.split(/[\\/]/).includes('node_modules'))
    .sort();
  return Object.fromEntries(
    files.map((path) => [path.slice(dir.length + 1), readFileSync(path, 'utf8')]),
  );
}

/** The message, without what the command logs while it loads the configuration. */
function printedMessage(run: AuthRun): string {
  expect(run.stderr).not.toContain('Error running Better Auth CLI');
  return run.stderr.slice(run.stderr.indexOf('Your Prisma contract')).trim();
}

// The install the adapter's README gives: the adapter at the database
// package's version, and Better Auth with its `auth` program from the
// registry, both at the lowest version the adapter's peer range admits, so
// they share one copy and the oldest supported release is the one tested. The adapter's
// two Prisma peers are declared too, because pnpm resolves a peer through
// the registry rather than through the tarball overrides, and these exact
// versions are not on the registry until they are released. From the
// registry the peers and the database package's dependencies are the same
// packages; the one-copy assertion below checks that here.
describe('the Better Auth adapter installed next to the SQLite database package', () => {
  let scratch: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'orm-better-auth-'));
    installShells(
      scratch,
      [packShell(adapterDir, scratch), ...pack(scratch, [facade, ...platform])],
      {
        direct: [adapter, facade, familySql, '@prisma/orm-framework', toolchain],
        registryDependencies: {
          'better-auth': betterAuthFloor,
          auth: betterAuthFloor,
          [cliEngine]: cliEngineVersion,
        },
      },
    );
    writeFileSync(join(scratch, 'contract.prisma'), corePsl);
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('installs Better Auth, its auth program and its core at the lowest version the adapter admits', () => {
    const versionIn = (packageDir: string) =>
      (JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8')) as { version: string })
        .version;
    const betterAuthDir = realpathSync(join(scratch, 'node_modules/better-auth'));
    expect([
      versionIn(betterAuthDir),
      versionIn(join(scratch, 'node_modules/auth')),
      versionIn(join(betterAuthDir, '../@better-auth/core')),
    ]).toEqual([betterAuthFloor, betterAuthFloor, betterAuthFloor]);
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

  function authProject(name: string, contract: string) {
    const projectDir = join(scratch, name);
    mkdirSync(join(projectDir, 'prisma'), { recursive: true });
    mkdirSync(join(projectDir, 'src/lib'), { recursive: true });
    writeFileSync(join(projectDir, 'prisma/contract.prisma'), contract);
    writeFileSync(join(projectDir, 'prisma.config.ts'), prismaConfig);
    writeFileSync(join(projectDir, 'src/lib/auth.ts'), twoFactorAuth);
    writeFileSync(join(projectDir, 'src/lib/db.ts'), sqliteClient);
    const emit = `
      import { writeFileSync } from 'node:fs';
      import { defineConfig } from '${facade}/config';
      import { createSqliteControlClient } from '${facade}/control';

      const { contract: contractConfig } = defineConfig({ contract: './${name}/prisma/contract.prisma' });
      const emitted = await createSqliteControlClient().emit({ contractConfig });
      if (!emitted.ok) throw new Error(JSON.stringify(emitted.failure));
      writeFileSync('./${name}/prisma/contract.json', emitted.value.contractJson);
      console.log('emitted');
    `;
    return {
      projectDir,
      contractPath: join(projectDir, 'prisma/contract.prisma'),
      emit: () => expect(runInScratch(scratch, emit)).toContain('emitted'),
    };
  }

  it('auth generate adds what the two-factor plugin needs to the contract, and auth check passes once it is emitted', () => {
    const project = authProject('auth-cli', corePsl);
    project.emit();

    const filesBeforeGenerate = projectFiles(project.projectDir);
    const generated = runAuth(project.projectDir, scratch, ['generate', '--yes']);
    expect(generated.status, generated.stderr).toBe(0);
    expect(generated.stdout.split('\n').filter((line) => line !== '')).toEqual([
      twoFactorAdded,
      '🚀 Schema was overwritten successfully!',
    ]);
    const completed = corePsl.replace(
      '  accounts      Account[]\n',
      '  accounts      Account[]\n  twoFactorEnabled Boolean?\n  twoFactors       TwoFactor[]\n',
    );
    expect(completed).not.toBe(corePsl);
    expect(projectFiles(project.projectDir)).toEqual({
      ...filesBeforeGenerate,
      'prisma/contract.prisma': `${completed}\n${twoFactorModel}\n`,
    });

    const checkedBeforeEmit = runAuth(project.projectDir, scratch, ['check']);
    expect(checkedBeforeEmit.status).toBe(1);
    expect(printedMessage(checkedBeforeEmit)).toBe(twoFactorMissing);

    project.emit();
    const regenerated = runAuth(project.projectDir, scratch, ['generate', '--yes']);
    expect(regenerated.status, regenerated.stderr).toBe(0);
    expect(regenerated.stdout).toContain('Your schema is already up to date.');
    const rechecked = runAuth(project.projectDir, scratch, ['check']);
    expect(rechecked.status, rechecked.stderr).toBe(0);
    expect(rechecked.stdout).toContain('Schema check passed against adapter "prisma-8".');
  });

  it('auth generate prints the message and writes nothing when the contract needs more than additions', () => {
    const project = authProject(
      'auth-cli-wrong-type',
      corePsl.replace('  image         String?', '  image         Int?'),
    );
    project.emit();
    const filesBeforeGenerate = projectFiles(project.projectDir);
    const generated = runAuth(project.projectDir, scratch, ['generate', '--yes']);
    expect(generated.status).toBe(1);
    expect(printedMessage(generated)).toBe(
      twoFactorMissing.replace(
        '\n\nThen run',
        '\n\nChange in your contract:\n\n  User.image: must be `String?` (found sqlite/integer@1)\n\nThen run',
      ),
    );
    expect(projectFiles(project.projectDir)).toEqual(filesBeforeGenerate);
  });
});

// What the exact peers buy: an application that upgrades its database
// package and not the adapter gets an install error under strict peers,
// instead of a second copy of the ORM client's filter functions.
describe('the Better Auth adapter next to an ORM client of a different version', () => {
  let scratch: string;

  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), 'orm-better-auth-skew-'));
  });

  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('fails to install under strict peers', () => {
    const familyDir = publicShells.get(familySql)?.dir;
    if (familyDir === undefined) throw new Error(`unknown shell ${familySql}`);
    const packed = [
      packShell(adapterDir, scratch),
      ...pack(scratch, ['@prisma/orm-framework', toolchain]),
      packShellAtVersion(join(repoRoot, familyDir), scratch, skewedVersion),
    ];
    const result = tryInstallShells(scratch, packed, {
      direct: [adapter, familySql, '@prisma/orm-framework', toolchain],
      registryDependencies: { '@better-auth/core': '1.7' },
      npmrc: ['strict-peer-dependencies=true', 'auto-install-peers=false'],
    });
    expect(result.ok).toBe(false);
    expect(result.output).toContain(`unmet peer ${familySql}`);
    expect(result.output).toContain(skewedVersion);
  });
});
