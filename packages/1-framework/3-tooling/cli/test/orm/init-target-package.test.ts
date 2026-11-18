import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { MountedTree, PackageManagerRunner } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { timeouts } from '@repo/test-utils';
import { basename, dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InitContribution } from '../../src/commands/init/init-contribution';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createInitCommand } from '../../src/orm/init';
import { importFromProject } from '../../src/orm/init-prisma7-check';
import {
  type ImportInitEntrypoint,
  type InitEntrypointImport,
  importInitEntrypoint,
} from '../../src/orm/init-target-package';
import { fixtureContribution } from '../utils/fixture-contribution';
import { createTestProjectDir } from '../utils/test-project-dir';

let projectDir: string;
let installs: (readonly string[])[];
let script: { readonly exitCode: number; readonly stderr: string }[];

const runner: PackageManagerRunner = async (request) => {
  installs.push([...request.args]);
  return script.shift() ?? { exitCode: 0, stderr: '' };
};

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-target-package');
  installs = [];
  script = [];
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function harness(loadInit: ImportInitEntrypoint = importInitEntrypoint) {
  const commands: MountedTree = {
    ...BIN_COMMANDS,
    'orm init': createInitCommand({
      emitScaffoldedContract: vi.fn().mockResolvedValue(undefined),
      importFromProject,
      importInitEntrypoint: loadInit,
    }),
  };
  return createTestCli({
    commands,
    groups: BIN_GROUPS,
    packageManagerRunner: runner,
    packageManager: 'pnpm',
  });
}

function loadsAs(result: InitEntrypointImport): ImportInitEntrypoint {
  return async () => result;
}

async function postgresWith(
  overrides: Partial<InitContribution>,
  omit: readonly (keyof InitContribution)[] = [],
): Promise<ImportInitEntrypoint> {
  const real = await fixtureContribution('@prisma/orm-postgres');
  const contribution = Object.fromEntries(
    Object.entries({ ...real, ...overrides }).filter(
      ([key]) => !omit.some((omitted) => omitted === key),
    ),
  );
  return loadsAs({ kind: 'loaded', module: { default: contribution } });
}

function envelopeOf(run: { readonly json: readonly { readonly kind: string }[] }) {
  const terminal = run.json.at(-1);
  return terminal !== undefined && terminal.kind === 'result'
    ? Reflect.get(terminal, 'envelope')
    : undefined;
}

function writeProjectFile(relative: string, content: string): void {
  mkdirSync(join(projectDir, dirname(relative)), { recursive: true });
  writeFileSync(join(projectDir, relative), content, 'utf-8');
}

function projectEntries(): string[] {
  return readdirSync(projectDir).filter((entry) => entry !== 'node_modules');
}

const STARTER = ['orm', 'init', '--target', 'postgres', '--authoring', 'psl', '--json'];

describe('init takes the project from the target package', () => {
  it(
    'installs the target package before it asks anything about the project',
    async () => {
      const run = await harness().run(
        ['orm', 'init', '--target', 'postgres', '--authoring', 'psl'],
        {
          cwd: projectDir,
        },
      );

      expect(run.exitCode).toBe(0);
      expect(installs[0]).toEqual(['add', '@prisma/orm-postgres', 'dotenv']);
      expect(existsSync(join(projectDir, 'prisma.config.ts'))).toBe(true);
    },
    timeouts.coldTransformImport,
  );

  it(
    'stops with no file written when the install of the target package fails',
    async () => {
      script = [{ exitCode: 1, stderr: 'ENOTFOUND registry.npmjs.org' }];

      const run = await harness().run(STARTER, { cwd: projectDir });

      expect(run.exitCode).toBe(4);
      expect(envelopeOf(run)).toMatchObject({
        ok: true,
        exitCode: 4,
        diagnostics: [{ code: 'CLI.INIT_INSTALL_FAILED', meta: { filesWritten: [] } }],
      });
      expect(run.presented?.data).toMatchObject({
        target: 'postgres',
        authoring: 'psl',
        filesWritten: [],
        packagesInstalled: { status: 'failed', deps: [], devDeps: [] },
        prisma7: null,
      });
      expect(installs).toEqual([['add', '@prisma/orm-postgres', 'dotenv']]);
      expect(projectEntries()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'stops under --skip-install with no file written and names the install command when the target package is not installed',
    async () => {
      const run = await harness(loadsAs({ kind: 'not-installed' })).run(
        [...STARTER, '--skip-install'],
        { cwd: projectDir },
      );

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_TARGET_PACKAGE_NOT_INSTALLED',
          meta: {
            packageName: '@prisma/orm-postgres',
            installCommand: 'pnpm add @prisma/orm-postgres',
          },
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label: expect.stringContaining('`pnpm add @prisma/orm-postgres`'),
            }),
          ]),
        },
      });
      expect(installs).toEqual([]);
      expect(projectEntries()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'reports a package without an init entrypoint through the real resolver',
    async () => {
      writeProjectFile(
        'node_modules/@prisma/orm-postgres/package.json',
        JSON.stringify({ name: '@prisma/orm-postgres', exports: { './config': './config.js' } }),
      );

      const run = await harness().run([...STARTER, '--skip-install'], { cwd: projectDir });

      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_CONTRIBUTION_UNAVAILABLE',
          meta: { packageName: '@prisma/orm-postgres', reason: 'no-entrypoint' },
        },
      });
      expect(projectEntries()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'stops with no file written and says to write prisma.config.ts by hand when the package has no init entrypoint',
    async () => {
      const run = await harness(loadsAs({ kind: 'no-entrypoint' })).run(STARTER, {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_CONTRIBUTION_UNAVAILABLE',
          why: '@prisma/orm-postgres has no `@prisma/orm-postgres/init` entrypoint, so it does not support `prisma orm init`. @prisma/orm-postgres is installed; no file was written.',
          meta: { reason: 'no-entrypoint' },
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label: expect.stringContaining('Write prisma.config.ts by hand'),
            }),
          ]),
        },
      });
      expect(installs).toEqual([['add', '@prisma/orm-postgres', 'dotenv']]);
      expect(projectEntries()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'stops with no file written when the default export is not an init contribution',
    async () => {
      const run = await harness(
        loadsAs({ kind: 'loaded', module: { default: { label: 'Broken' } } }),
      ).run(STARTER, { cwd: projectDir });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_CONTRIBUTION_UNAVAILABLE',
          why: expect.stringContaining('configModule must be a string'),
          meta: { reason: 'invalid-shape' },
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label: expect.stringContaining('Write prisma.config.ts by hand'),
            }),
          ]),
        },
      });
      expect(projectEntries()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'refuses a contribution that gives a Prisma 7 config without its quick reference',
    async () => {
      const run = await harness(await postgresWith({}, ['prisma7QuickReference'])).run(STARTER, {
        cwd: projectDir,
      });

      expect(envelopeOf(run)).toMatchObject({
        error: {
          code: 'CLI.INIT_CONTRIBUTION_UNAVAILABLE',
          why: expect.stringContaining(
            'prisma7ConfigFile and prisma7QuickReference must be given together',
          ),
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'refuses an authoring mode the package does not offer, naming the ones it does',
    async () => {
      const run = await harness(await postgresWith({ authoringModes: ['typescript'] })).run(
        STARTER,
        { cwd: projectDir },
      );

      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_AUTHORING_UNSUPPORTED',
          meta: { authoring: 'psl', offered: ['typescript'] },
        },
      });
      expect(projectEntries()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'takes the only authoring mode a package offers without asking',
    async () => {
      const run = await harness(await postgresWith({ authoringModes: ['typescript'] })).run(
        ['orm', 'init', '--target', 'postgres', '--skip-install', '--yes', '--json'],
        { cwd: projectDir },
      );

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({
        authoring: 'typescript',
        schemaPath: 'src/prisma/contract.ts',
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'writes the config module the contribution names',
    async () => {
      const run = await harness(await postgresWith({ configModule: 'acme-db/config' })).run(
        [...STARTER, '--skip-install'],
        { cwd: projectDir },
      );

      expect(run.exitCode).toBe(0);
      expect(readFileSync(join(projectDir, 'prisma.config.ts'), 'utf-8')).toContain(
        "import { defineConfig as ormConfig } from 'acme-db/config';",
      );
    },
    timeouts.coldTransformImport,
  );

  it(
    'warns that a package with no probe cannot check the server, and fails under --strict-probe',
    async () => {
      const loadInit = await postgresWith({}, ['probe']);
      const env = { DATABASE_URL: 'postgres://localhost:5432/db' };

      const warned = await harness(loadInit).run([...STARTER, '--skip-install', '--probe-db'], {
        cwd: projectDir,
        env,
      });
      expect(warned.presented?.data).toMatchObject({
        warnings: expect.arrayContaining([
          'Skipped --probe-db: @prisma/orm-postgres cannot check the server.',
        ]),
      });

      const strict = await harness(loadInit).run(
        [
          ...STARTER,
          '--skip-install',
          '--probe-db',
          '--strict-probe',
          '--confirm',
          basename(projectDir),
        ],
        { cwd: projectDir, env },
      );
      expect(envelopeOf(strict)).toMatchObject({
        ok: false,
        error: { code: 'CLI.INIT_PROBE_FAILED' },
      });
    },
    timeouts.coldTransformImport,
  );
});
