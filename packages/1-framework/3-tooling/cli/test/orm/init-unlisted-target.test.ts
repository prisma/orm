import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import type { MountedTree, PackageManagerRunner } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

const runner: PackageManagerRunner = async (request) => {
  installs.push([...request.args]);
  declareAddedPackages(request);
  return { exitCode: 0, stderr: '' };
};

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-unlisted-target');
  installs = [];
  loaded = [];
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
            allowed: ['postgres', 'mongodb', '<package name>'],
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
        error: { code: 'CLI.INIT_INVALID_FLAG_VALUE', meta: { value: '../outside' } },
      });
      expect(installs).toEqual([]);
      expect(projectEntries()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'refuses to keep a Prisma 7 schema as the contract source of an unlisted package',
    async () => {
      const schema = 'datasource db {\n  provider = "postgresql"\n}\n';
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(join(projectDir, 'prisma'));
      writeFileSync(join(projectDir, 'prisma/schema.prisma'), schema);

      const run = await harness(await unlistedPackage()).run(
        [
          'orm',
          'init',
          '--target',
          UNLISTED,
          '--from-prisma7-schema',
          'prisma/schema.prisma',
          '--json',
        ],
        { cwd: projectDir },
      );

      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_PRISMA7_TARGET_MISMATCH',
          meta: { provider: 'postgresql', target: UNLISTED },
        },
      });
      expect(installs).toEqual([]);
    },
    timeouts.coldTransformImport,
  );
});

describe('init with a listed target package', () => {
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
});
