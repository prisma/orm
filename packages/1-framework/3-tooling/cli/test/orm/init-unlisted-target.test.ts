import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { MountedTree, PackageManagerRunner } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { timeouts } from '@repo/test-utils';
import { basename, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configFile } from '../../src/commands/init/templates/code-templates';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createInitCommand } from '../../src/orm/init';
import { type ImportFromProject, importFromProject } from '../../src/orm/project-modules';
import { declareAddedPackages } from '../utils/fake-package-manager';
import { fixtureContribution } from '../utils/fixture-contribution';
import { createTestProjectDir } from '../utils/test-project-dir';

const UNLISTED = 'prisma-orm-somedb';

let projectDir: string;
let installs: (readonly string[])[];
let loaded: string[];
let installsFail: boolean;

const runner: PackageManagerRunner = async (request) => {
  installs.push([...request.args]);
  if (installsFail) {
    return { exitCode: 1, stderr: 'ERR_PNPM_FETCH_404 Not Found' };
  }
  declareAddedPackages(request);
  return { exitCode: 0, stderr: '' };
};

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-unlisted-target');
  installs = [];
  loaded = [];
  installsFail = false;
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

/** An unlisted package whose contribution names its own driver; listed packages load as installed. */
async function unlistedPackage(): Promise<ImportFromProject> {
  const contribution = {
    ...(await fixtureContribution('@prisma/orm-postgres')),
    label: 'SomeDB',
    peerPackages: ['somedb-driver'],
  };
  return async (cwd, specifier) => {
    if (specifier.endsWith('/init')) loaded.push(specifier);
    return specifier === `${UNLISTED}/init`
      ? { kind: 'loaded', module: { default: contribution } }
      : importFromProject(cwd, specifier);
  };
}

function harness(loadModule: ImportFromProject = importFromProject) {
  const commands: MountedTree = {
    ...BIN_COMMANDS,
    'orm init': createInitCommand({
      emitScaffoldedContract: vi.fn().mockResolvedValue(undefined),
      importFromProject: loadModule,
    }),
  };
  return createTestCli({
    commands,
    groups: BIN_GROUPS,
    packageManagerRunner: runner,
    packageManager: 'pnpm',
  });
}

function envelopeOf(run: { readonly json: readonly { readonly kind: string }[] }) {
  const terminal = run.json.at(-1);
  return terminal !== undefined && terminal.kind === 'result'
    ? Reflect.get(terminal, 'envelope')
    : undefined;
}

function writeProjectFile(relative: string, content: string): void {
  mkdirSync(join(projectDir, relative, '..'), { recursive: true });
  writeFileSync(join(projectDir, relative), content);
}

function readProjectFile(relative: string): string {
  return readFileSync(join(projectDir, relative), 'utf-8');
}

/** A package of that name exists on the registry and installs, but exports no `./init`. */
function packageWithoutInit(packageName: string): ImportFromProject {
  return async (cwd, specifier) => {
    if (specifier.endsWith('/init')) loaded.push(specifier);
    return specifier === `${packageName}/init`
      ? { kind: 'not-exported' }
      : importFromProject(cwd, specifier);
  };
}

function projectEntries(): string[] {
  return readdirSync(projectDir).filter((entry) => entry !== 'node_modules');
}

const starter = (target: string) => [
  'orm',
  'init',
  '--target',
  target,
  '--authoring',
  'psl',
  '--json',
];

describe('init with a target package that is in no list', () => {
  it(
    'installs the package and dotenv first, and the drivers its contribution names later',
    async () => {
      const run = await harness(await unlistedPackage()).run(starter(UNLISTED), {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(0);
      expect(loaded).toEqual([`${UNLISTED}/init`]);
      expect(installs[0]).toEqual(['add', UNLISTED, 'dotenv']);
      expect(installs[1]).toEqual(['add', 'somedb-driver']);
      expect(run.presented?.data).toMatchObject({
        target: UNLISTED,
        package: UNLISTED,
        packagesInstalled: {
          status: 'installed',
          deps: [UNLISTED, 'dotenv', 'somedb-driver'],
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'offers another package name in the picker, and runs as --target with that name does',
    async () => {
      const run = await harness(await unlistedPackage()).run(['orm', 'init', '--json'], {
        cwd: projectDir,
        isTty: { stdin: true },
        answers: ['another-package', ` ${UNLISTED} `, 'psl', 'src/prisma/contract.prisma', false],
      });

      expect(run.exitCode).toBe(0);
      expect(installs[0]).toEqual(['add', UNLISTED, 'dotenv']);
      expect(installs[1]).toEqual(['add', 'somedb-driver']);
      expect(run.presented?.data).toMatchObject({ target: UNLISTED, package: UNLISTED });
    },
    timeouts.coldTransformImport,
  );

  it(
    'refuses a value that is neither a known name nor a valid package name, before anything changes',
    async () => {
      const run = await harness(await unlistedPackage()).run(starter('Not A Package!'), {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_INVALID_FLAG_VALUE',
          meta: {
            flag: 'target',
            value: 'Not A Package!',
            allowed: ['postgres', 'mongodb'],
            acceptsPackageName: true,
            problems: expect.arrayContaining(['name can only contain URL-friendly characters']),
          },
        },
      });
      expect(installs).toEqual([]);
      expect(loaded).toEqual([]);
      expect(projectEntries()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'refuses a package name typed into the picker that is not valid, before anything changes',
    async () => {
      const run = await harness(await unlistedPackage()).run(['orm', 'init', '--json'], {
        cwd: projectDir,
        isTty: { stdin: true },
        answers: ['another-package', '../outside'],
      });

      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_INVALID_FLAG_VALUE',
          summary: 'Invalid target package name',
          meta: { value: '../outside' },
        },
      });
      expect(installs).toEqual([]);
      expect(projectEntries()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'reports a failed first install with the package as target and package, and writes nothing',
    async () => {
      installsFail = true;
      const run = await harness(await unlistedPackage()).run(starter(UNLISTED), {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(4);
      expect(envelopeOf(run)).toMatchObject({
        ok: true,
        exitCode: 4,
        diagnostics: [{ code: 'CLI.INIT_INSTALL_FAILED', meta: { filesWritten: [] } }],
      });
      expect(run.presented?.data).toMatchObject({
        target: UNLISTED,
        package: UNLISTED,
        filesWritten: [],
        packagesInstalled: { status: 'failed', deps: [], devDeps: [] },
      });
      expect(installs).toEqual([['add', UNLISTED, 'dotenv']]);
      expect(loaded).toEqual([]);
      expect(projectEntries()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    're-initialising with another target does not offer to remove the unlisted package',
    async () => {
      writeProjectFile(
        'package.json',
        `${JSON.stringify({ name: 'app', dependencies: { [UNLISTED]: '^1.0.0' } }, null, 2)}\n`,
      );
      writeProjectFile('prisma.config.ts', 'export default {}\n');

      const run = await harness().run(
        [...starter('postgres'), '--skip-install', '--confirm', basename(projectDir)],
        { cwd: projectDir },
      );

      expect(run.exitCode, JSON.stringify(envelopeOf(run))).toBe(0);
      expect(JSON.parse(readProjectFile('package.json'))).toMatchObject({
        dependencies: { [UNLISTED]: '^1.0.0' },
      });
    },
    timeouts.coldTransformImport,
  );
});

describe('a value that is not a short name but is a valid package name', () => {
  it(
    'installs the package of that name, then says it was taken as a package name',
    async () => {
      const run = await harness(packageWithoutInit('sqlite')).run(starter('sqlite'), {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(2);
      expect(installs).toEqual([['add', 'sqlite', 'dotenv']]);
      expect(loaded).toEqual(['sqlite/init']);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_CONTRIBUTION_UNAVAILABLE',
          why: '`sqlite` is not one of the short names (postgres, mongodb), so init took it as a package name. sqlite has no `sqlite/init` entrypoint, so it does not support `prisma orm init`. sqlite is installed; no scaffold file was written.',
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label:
                'Write prisma.config.ts by hand, with the defineConfig import the README of sqlite shows. To use a target package from the list instead, pass its short name (--target postgres, --target mongodb); for any other, pass its full package name.',
            }),
          ]),
          meta: {
            packageName: 'sqlite',
            reason: 'no-entrypoint',
            takenAsPackageName: true,
            packagesAdded: ['sqlite', 'dotenv'],
          },
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'says it was taken as a package name when --skip-install finds no such package',
    async () => {
      const run = await harness().run([...starter('sqlite'), '--skip-install'], {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(2);
      expect(installs).toEqual([]);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_TARGET_PACKAGE_NOT_INSTALLED',
          why: expect.stringMatching(
            /^`sqlite` is not one of the short names \(postgres, mongodb\), so init took it as a package name\. /,
          ),
          meta: { packageName: 'sqlite', takenAsPackageName: true },
        },
      });
    },
    timeouts.coldTransformImport,
  );
});

describe('an unlisted --target in a Prisma 7 project', () => {
  const PRISMA7_SCHEMA = 'prisma/schema.prisma';

  it.each([
    ['a string provider', 'datasource db {\n  provider = "sqlite"\n}\n'],
    ['a provider that is not a string literal', 'datasource db {\n  provider = env("DB")\n}\n'],
  ])(
    'refuses --from-prisma7-schema with %s before installing, since only a listed package keeps the schema',
    async (_, schema) => {
      writeProjectFile(PRISMA7_SCHEMA, schema);

      const run = await harness(await unlistedPackage()).run(
        ['orm', 'init', '--target', UNLISTED, '--from-prisma7-schema', PRISMA7_SCHEMA, '--json'],
        { cwd: projectDir },
      );

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE',
          why: `${UNLISTED} is not one of the target packages in Prisma's list (postgres, mongodb), and only a package in that list can keep ${PRISMA7_SCHEMA} as the contract source. Nothing was changed.`,
          nextActions: [
            expect.objectContaining({
              label: `Run \`prisma orm init\` without \`--from-prisma7-schema\` to start a fresh contract on ${UNLISTED}, or without \`--target\` so the provider ${PRISMA7_SCHEMA} declares picks the target package.`,
            }),
          ],
          meta: { schemaPath: PRISMA7_SCHEMA, packageName: UNLISTED, reason: 'unlisted' },
        },
      });
      expect(installs).toEqual([]);
      expect(loaded).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'without the flag, does not offer the schema and warns that init sets up a fresh project',
    async () => {
      writeProjectFile(PRISMA7_SCHEMA, 'datasource db {\n  provider = "postgresql"\n}\n');

      const run = await harness(await unlistedPackage()).run(
        ['orm', 'init', '--target', UNLISTED, '--json'],
        {
          cwd: projectDir,
          isTty: { stdin: true },
          answers: ['psl', 'src/prisma/contract.prisma', false],
        },
      );

      expect(run.exitCode, JSON.stringify(envelopeOf(run))).toBe(0);
      expect(run.presented?.data).toMatchObject({
        authoring: 'psl',
        prisma7: null,
        warnings: expect.arrayContaining([
          `${UNLISTED} cannot read Prisma 7 schemas, so init sets up a fresh Prisma 8 project instead and leaves ${PRISMA7_SCHEMA} alone.`,
        ]),
      });
      expect(readProjectFile(PRISMA7_SCHEMA)).toContain('provider = "postgresql"');
    },
    timeouts.coldTransformImport,
  );
});

describe('init with a listed target package', () => {
  it(
    'reports a failed first install with the short name as target and the package name as package',
    async () => {
      installsFail = true;
      const run = await harness().run(starter('postgres'), { cwd: projectDir });

      expect(run.exitCode).toBe(4);
      expect(run.presented?.data).toMatchObject({
        target: 'postgres',
        package: '@prisma/orm-postgres',
        packagesInstalled: { status: 'failed', deps: [], devDeps: [] },
      });
      expect(installs).toEqual([['add', '@prisma/orm-postgres', 'dotenv', 'pg']]);
      expect(projectEntries()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'reports the short name as target and the package name as package',
    async () => {
      const run = await harness().run([...starter('postgres'), '--skip-install'], {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({
        target: 'postgres',
        package: '@prisma/orm-postgres',
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'takes the package name of a listed package as that package, drivers in the first install',
    async () => {
      const run = await harness().run(starter('@prisma/orm-postgres'), { cwd: projectDir });

      expect(run.exitCode).toBe(0);
      expect(installs[0]).toEqual(['add', '@prisma/orm-postgres', 'dotenv', 'pg']);
      expect(run.presented?.data).toMatchObject({
        target: 'postgres',
        package: '@prisma/orm-postgres',
      });
    },
    timeouts.coldTransformImport,
  );
});

describe('init with the published target packages that are in no list', () => {
  it.each([
    ['@prisma/orm-sqlite', '@internal/sqlite'],
    ['@prisma/orm-mysql', '@internal/mysql'],
  ])(
    'writes the project from the contribution of %s',
    async (packageName, moduleBase) => {
      const run = await harness().run([...starter(packageName), '--skip-install'], {
        cwd: projectDir,
      });

      expect(run.exitCode, JSON.stringify(envelopeOf(run))).toBe(0);
      expect(run.presented?.data).toMatchObject({ target: packageName, package: packageName });
      expect(readFileSync(join(projectDir, 'prisma.config.ts'), 'utf-8')).toContain(
        `from '${moduleBase}/config'`,
      );
      expect(readFileSync(join(projectDir, 'src/prisma/db.ts'), 'utf-8')).toContain(
        `from '${moduleBase}/runtime'`,
      );
      expect(existsSync(join(projectDir, 'prisma-8.md'))).toBe(true);
    },
    timeouts.coldTransformImport,
  );

  it.each([
    ['@prisma/orm-sqlite', 'psl', 'src/prisma/contract.prisma'],
    ['@prisma/orm-sqlite', 'typescript', 'src/prisma/contract.ts'],
    ['@prisma/orm-mysql', 'psl', 'src/prisma/contract.prisma'],
    ['@prisma/orm-mysql', 'typescript', 'src/prisma/contract.ts'],
  ] as const)(
    'writes exactly the files the contribution of %s gives for %s',
    async (packageName, authoring, schemaPath) => {
      const contribution = await fixtureContribution(packageName);

      const run = await harness().run(
        ['orm', 'init', '--target', packageName, '--authoring', authoring, '--write-env'].concat(
          '--skip-install',
          '--json',
        ),
        { cwd: projectDir },
      );

      expect(run.exitCode, JSON.stringify(envelopeOf(run))).toBe(0);
      expect(readProjectFile(schemaPath)).toBe(contribution.starterContract(authoring));
      expect(readProjectFile('prisma.config.ts')).toBe(
        configFile(`./${schemaPath}`, contribution.configModule),
      );
      expect(readProjectFile('src/prisma/db.ts')).toBe(contribution.databaseFile());
      expect(readProjectFile('.env')).toBe(contribution.envExample());
    },
    timeouts.coldTransformImport,
  );
});
