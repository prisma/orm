import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import {
  adapter,
  authProject,
  cliEngine,
  corePsl,
  facade,
  notChanged,
  printedLines,
  printedMessage,
  projectFiles,
  repoRoot,
  runAuth,
  twoFactorAdded,
  twoFactorMissing,
  twoFactorModel,
  withTwoFactorFields,
} from './better-auth-project';

const workspaceVersion = (
  JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }
).version;
const skewedVersion = workspaceVersion.replace(/\d+$/, (patch) => String(Number(patch) + 1));
const adapterDir = join(repoRoot, 'packages/9-public/@prisma/orm-better-auth');
const betterAuthFloor = (() => {
  const manifest = JSON.parse(readFileSync(join(adapterDir, 'package.json'), 'utf8')) as {
    peerDependencies: Record<string, string>;
  };
  const floor = /^>=(\S+) /.exec(manifest.peerDependencies['@better-auth/core'] ?? '')?.[1];
  if (floor === undefined) throw new Error('The adapter declares no lowest @better-auth/core');
  return floor;
})();
const familySql = '@prisma/orm-family-sql';
const toolchain = '@prisma/orm-toolchain';
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

// The install the adapter's README gives: the adapter at the database
// package's version, and Better Auth with its `auth` program from the
// registry, both at the lowest version the adapter's peer range admits, so
// they share one copy and the oldest supported release is the one tested. The adapter's
// three Prisma peers are declared too, because pnpm resolves a peer through
// the registry rather than through the tarball overrides, and these exact
// versions are not on the registry until they are released. From the
// registry the peers and the database package's dependencies are the same
// packages; the one-copy assertion below checks that here. The toolchain's
// own peer, the CLI engine, is installed too, as any application with a
// prisma.config.ts has it.
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

  it('logs nothing when the auth instance is created over a contract the check rejects, and fails the first request with the message', () => {
    const script = `
      import { betterAuth } from 'better-auth';
      import { twoFactor } from 'better-auth/plugins';
      import { prismaAdapter } from '${adapter}';
      import { defineConfig } from '${facade}/config';
      import { createSqliteControlClient } from '${facade}/control';
      import sqlite from '${facade}/runtime';
      import { contractFromJson } from '${facade}/static';

      const { contract: contractConfig } = defineConfig({ contract: './contract.prisma' });
      const emitted = await createSqliteControlClient().emit({ contractConfig });
      if (!emitted.ok) throw new Error(JSON.stringify(emitted.failure));
      const db = sqlite({ contract: contractFromJson(JSON.parse(emitted.value.contractJson)), path: './startup.db' });

      const logged = [];
      const writes = [process.stdout, process.stderr].map((stream) => {
        const write = stream.write;
        stream.write = (chunk) => logged.push(String(chunk)) > 0;
        return () => { stream.write = write; };
      });
      const auth = betterAuth({
        database: prismaAdapter(db),
        emailAndPassword: { enabled: true },
        secret: 'a-test-secret-that-is-long-enough-for-better-auth',
        baseURL: 'http://localhost:3000',
        plugins: [twoFactor()],
      });
      await auth.$context;
      await new Promise((resolve) => setTimeout(resolve, 100));
      const atStartup = logged.splice(0);
      const rejection = await auth.api
        .signUpEmail({ body: { email: 'ada@example.com', password: 'a-long-password', name: 'Ada' } })
        .then(() => undefined, (error) => ({ name: error.name, message: error.message }));
      await db.close();
      for (const restore of writes) restore();
      console.log(JSON.stringify({ atStartup, rejection, afterStartup: logged }));
    `;
    expect(JSON.parse(runInScratch(scratch, script))).toEqual({
      atStartup: [],
      rejection: { name: 'BetterAuthError', message: twoFactorMissing },
      afterStartup: [],
    });
  });

  const contractPath = 'prisma/contract.prisma';
  const twoFactorEdit = `${withTwoFactorFields(corePsl)}\n${twoFactorModel}\n`;
  const sessionStart = corePsl.indexOf('model Session');
  const usersPsl = `${corePsl.slice(0, sessionStart).trimEnd()}\n`;
  const sessionsPsl = `// use prisma-8\n\n${corePsl.slice(sessionStart)}`;
  const splitSources = { 'prisma/users.prisma': usersPsl, 'prisma/sessions.prisma': sessionsPsl };

  function generate(projectDir: string, args: readonly string[] = [], input?: string) {
    const before = projectFiles(projectDir);
    return { before, run: runAuth(projectDir, scratch, ['generate', ...args], input) };
  }

  it('auth generate adds what the two-factor plugin needs to the contract, refuses again until it is emitted, and auth check passes once it is', () => {
    const project = authProject(scratch, 'auth-cli');
    project.emit();

    const { before, run } = generate(project.projectDir, ['--yes']);
    expect(run.status, run.stderr).toBe(0);
    expect(printedLines(run)).toEqual([
      twoFactorAdded(contractPath),
      '🚀 Schema was overwritten successfully!',
    ]);
    const edited = { ...before, [contractPath]: twoFactorEdit };
    expect(projectFiles(project.projectDir)).toEqual(edited);

    const checkedBeforeEmit = runAuth(project.projectDir, scratch, ['check']);
    expect(checkedBeforeEmit.status).toBe(1);
    expect(printedMessage(checkedBeforeEmit)).toBe(twoFactorMissing);

    const again = runAuth(project.projectDir, scratch, ['generate', '--yes']);
    expect(again.status).toBe(1);
    expect(printedMessage(again)).toBe(
      `${twoFactorMissing}\n\n${notChanged} ${contractPath} already declares User.twoFactorEnabled, User.twoFactors and TwoFactor, which the emitted contract does not have. Run \`prisma contract emit\`, then update your database.`,
    );
    expect(projectFiles(project.projectDir)).toEqual(edited);

    project.emit();
    const regenerated = runAuth(project.projectDir, scratch, ['generate', '--yes']);
    expect(regenerated.status, regenerated.stderr).toBe(0);
    expect(regenerated.stdout).toContain('Your schema is already up to date.');
    const rechecked = runAuth(project.projectDir, scratch, ['check']);
    expect(rechecked.status, rechecked.stderr).toBe(0);
    expect(rechecked.stdout).toContain('Schema check passed against adapter "prisma-8".');
  });

  it('auth generate edits only the file of a two-file contract that declares the model it extends', () => {
    const project = authProject(scratch, 'auth-cli-two-files', {
      sources: splitSources,
      configContract: './prisma/*.prisma',
      emitFrom: './auth-cli-two-files/prisma/*.prisma',
    });
    project.emit();

    const { before, run } = generate(project.projectDir, ['--yes']);
    expect(run.status, run.stderr).toBe(0);
    expect(printedLines(run)).toEqual([
      twoFactorAdded('prisma/users.prisma'),
      '🚀 Schema was overwritten successfully!',
    ]);
    expect(projectFiles(project.projectDir)).toEqual({
      ...before,
      'prisma/users.prisma': `${withTwoFactorFields(usersPsl)}\n${twoFactorModel}\n`,
    });

    project.emit();
    const regenerated = runAuth(project.projectDir, scratch, ['generate', '--yes']);
    expect(regenerated.status, regenerated.stderr).toBe(0);
    expect(regenerated.stdout).toContain('Your schema is already up to date.');
    const rechecked = runAuth(project.projectDir, scratch, ['check']);
    expect(rechecked.status, rechecked.stderr).toBe(0);
    expect(rechecked.stdout).toContain('Schema check passed against adapter "prisma-8".');
  });

  it('auth generate writes nothing when the additions belong in both files of a two-file contract', () => {
    const project = authProject(scratch, 'auth-cli-two-files-admin', {
      sources: splitSources,
      configContract: './prisma/*.prisma',
      emitFrom: './auth-cli-two-files-admin/prisma/*.prisma',
      plugin: 'admin',
    });
    project.emit();

    const { before, run } = generate(project.projectDir, ['--yes']);
    expect(run.status).toBe(1);
    expect(
      printedMessage(run),
    ).toBe(`Your Prisma contract is missing models or fields that Better Auth needs.

Add to your contract:

model User {
  role       String?
  banned     Boolean?
  banReason  String?
  banExpires DateTime?
}

model Session {
  impersonatedBy String?
}

Then run \`prisma contract emit\` and update your database.

${notChanged} the additions belong in prisma/users.prisma and prisma/sessions.prisma, and Better Auth writes one file. Add them by hand.`);
    expect(projectFiles(project.projectDir)).toEqual(before);
  });

  it('auth generate edits the file --output names, without prisma.config.ts', () => {
    const project = authProject(scratch, 'auth-cli-output', { configContract: null });
    project.emit();

    const { before, run } = generate(project.projectDir, ['--yes', '--output', contractPath]);
    expect(run.status, run.stderr).toBe(0);
    expect(printedLines(run)).toEqual([
      twoFactorAdded(contractPath),
      '🚀 Schema was overwritten successfully!',
    ]);
    expect(before).not.toHaveProperty('prisma.config.ts');
    expect(projectFiles(project.projectDir)).toEqual({ ...before, [contractPath]: twoFactorEdit });
  });

  it('auth generate with --cwd edits the file --output names in that directory, run from another one', () => {
    const project = authProject(scratch, 'auth-cli-cwd', { configContract: null });
    project.emit();
    const elsewhere = join(scratch, 'auth-cli-elsewhere');
    mkdirSync(elsewhere);

    const before = projectFiles(project.projectDir);
    const run = runAuth(elsewhere, scratch, [
      'generate',
      '--yes',
      '--cwd',
      project.projectDir,
      '--output',
      contractPath,
    ]);
    expect(run.status, run.stderr).toBe(0);
    expect(printedLines(run)).toEqual([
      twoFactorAdded(join(project.projectDir, contractPath)),
      '🚀 Schema was overwritten successfully!',
    ]);
    expect(projectFiles(project.projectDir)).toEqual({ ...before, [contractPath]: twoFactorEdit });
    expect(projectFiles(elsewhere)).toEqual({});
  });

  it('auth generate writes nothing for a contract written in TypeScript', () => {
    const project = authProject(scratch, 'auth-cli-typescript', {
      sources: { 'prisma/contract.ts': 'export {};\n' },
      configContract: './prisma/contract.ts',
      emitFrom: './contract.prisma',
    });
    project.emit();

    const { before, run } = generate(project.projectDir, ['--yes']);
    expect(run.status).toBe(1);
    expect(printedMessage(run)).toBe(
      `${twoFactorMissing}\n\n${notChanged} it is written in TypeScript. Add the equivalent models and fields in TypeScript.`,
    );
    expect(projectFiles(project.projectDir)).toEqual(before);
  });

  it('auth generate writes nothing and advises a rename when another model is stored in the table of the model it would add', () => {
    const project = authProject(scratch, 'auth-cli-renamed', {
      sources: {
        [contractPath]: `${corePsl}\nmodel TwoFactorRecord {\n  id String @id\n\n  @@map("twoFactor")\n}\n`,
      },
    });
    project.emit();

    const { before, run } = generate(project.projectDir, ['--yes']);
    expect(run.status).toBe(1);
    expect(printedMessage(run)).toBe(
      `${twoFactorMissing}\n\n${notChanged} ${contractPath} stores TwoFactorRecord in the table "twoFactor", but Better Auth looks for a model named TwoFactor. Rename TwoFactorRecord to TwoFactor, then run \`prisma contract emit\`, and \`auth generate\` again.`,
    );
    expect(projectFiles(project.projectDir)).toEqual(before);
  });

  it('auth generate without --yes and without a terminal refuses to ask and writes nothing', () => {
    const project = authProject(scratch, 'auth-cli-prompt');
    project.emit();

    const { before, run } = generate(project.projectDir, [], 'y\n');
    expect(run.status).toBe(2);
    expect(printedLines(run)).toEqual([twoFactorAdded(contractPath)]);
    expect(printedMessage(run)).toBe(
      `Can't overwrite ${realpathSync(join(project.projectDir, contractPath))} without --yes in non-interactive mode.`,
    );
    expect(projectFiles(project.projectDir)).toEqual(before);
  });

  it('auth generate writes nothing and says --output must name the contract file when it names a directory', () => {
    const project = authProject(scratch, 'auth-cli-output-directory', { configContract: null });
    project.emit();

    const { before, run } = generate(project.projectDir, ['--yes', '--output', 'prisma']);
    expect(run.status).toBe(1);
    expect(printedMessage(run)).toBe(
      `${twoFactorMissing}\n\n${notChanged} \`--output\` names a directory, so Better Auth passed prisma/auth-schema.ts. Pass your contract's PSL file itself with \`--output\`.`,
    );
    expect(projectFiles(project.projectDir)).toEqual(before);
  });

  it('auth generate prints the message and writes nothing when the contract needs more than additions', () => {
    const project = authProject(scratch, 'auth-cli-wrong-type', {
      sources: {
        [contractPath]: corePsl.replace('  image         String?', '  image         Int?'),
      },
    });
    project.emit();
    const { before, run } = generate(project.projectDir, ['--yes']);
    expect(run.status).toBe(1);
    expect(printedMessage(run)).toBe(
      twoFactorMissing.replace(
        '\n\nThen run',
        '\n\nChange in your contract:\n\n  User.image: must be `String?` (found sqlite/integer@1)\n\nThen run',
      ),
    );
    expect(projectFiles(project.projectDir)).toEqual(before);
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
