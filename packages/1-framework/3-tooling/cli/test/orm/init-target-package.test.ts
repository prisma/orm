import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { MountedTree, PackageManagerRunner } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { timeouts } from '@repo/test-utils';
import { basename, dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InitContribution } from '../../src/commands/init/init-contribution';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createInitCommand } from '../../src/orm/init';
import {
  type ImportFromProject,
  importFromProject,
  type ProjectImport,
} from '../../src/orm/project-modules';
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

/** The project's own resolver, with `<package>/init` answered by `loadInit`. */
function harness(loadInit: ImportFromProject = importFromProject) {
  const commands: MountedTree = {
    ...BIN_COMMANDS,
    'orm init': createInitCommand({
      emitScaffoldedContract: vi.fn().mockResolvedValue(undefined),
      importFromProject: (cwd, specifier) =>
        specifier.endsWith('/init') ? loadInit(cwd, specifier) : importFromProject(cwd, specifier),
    }),
  };
  return createTestCli({
    commands,
    groups: BIN_GROUPS,
    packageManagerRunner: runner,
    packageManager: 'pnpm',
  });
}

function loadsAs(result: ProjectImport): ImportFromProject {
  return async () => result;
}

async function postgresWith(
  overrides: Partial<InitContribution>,
  omit: readonly (keyof InitContribution)[] = [],
): Promise<ImportFromProject> {
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

const REMOVE_ADDED =
  'init installed @prisma/orm-postgres, dotenv and pg to read the init contribution of @prisma/orm-postgres; remove them with `pnpm remove @prisma/orm-postgres dotenv pg`.';

function writePackage(
  name: string,
  manifest: Record<string, unknown>,
  files: Record<string, string>,
) {
  writeProjectFile(`node_modules/${name}/package.json`, JSON.stringify({ name, ...manifest }));
  for (const [file, content] of Object.entries(files)) {
    writeProjectFile(`node_modules/${name}/${file}`, content);
  }
}

describe('init takes the project from the target package', () => {
  it(
    'installs the target package before it asks anything about the project',
    async () => {
      script = [{ exitCode: 1, stderr: 'ENOTFOUND registry.npmjs.org' }];

      // Only the target is answered: a question asked before the install would run past the
      // script and fail the run.
      const run = await harness().run(['orm', 'init', '--json'], {
        cwd: projectDir,
        isTty: { stdin: true },
        answers: ['postgres'],
      });

      expect(run.exitCode).toBe(4);
      expect(envelopeOf(run)).toMatchObject({
        diagnostics: [{ code: 'CLI.INIT_INSTALL_FAILED' }],
      });
      expect(installs).toEqual([['add', '@prisma/orm-postgres', 'dotenv', 'pg']]);
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
      expect(installs).toEqual([['add', '@prisma/orm-postgres', 'dotenv', 'pg']]);
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
    'says the install command succeeded but the package cannot be found when it still does not resolve',
    async () => {
      const run = await harness(loadsAs({ kind: 'not-installed' })).run(STARTER, {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_TARGET_PACKAGE_NOT_INSTALLED',
          summary: '@prisma/orm-postgres cannot be found from the project',
          why: '`pnpm add @prisma/orm-postgres dotenv pg` succeeded, but @prisma/orm-postgres cannot be found from the project, so init cannot read its init contribution. No scaffold file was written.',
          meta: { packageName: '@prisma/orm-postgres' },
        },
      });
      expect(JSON.stringify(envelopeOf(run))).not.toContain('--skip-install');
      expect(installs).toEqual([['add', '@prisma/orm-postgres', 'dotenv', 'pg']]);
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
      const run = await harness(loadsAs({ kind: 'not-exported' })).run(STARTER, {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_CONTRIBUTION_UNAVAILABLE',
          why: '@prisma/orm-postgres has no `@prisma/orm-postgres/init` entrypoint, so it does not support `prisma orm init`. @prisma/orm-postgres is installed; no file was written.',
          meta: {
            reason: 'no-entrypoint',
            packagesAdded: ['@prisma/orm-postgres', 'dotenv', 'pg'],
          },
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label: expect.stringContaining('Write prisma.config.ts by hand'),
            }),
            expect.objectContaining({ label: REMOVE_ADDED }),
          ]),
        },
      });
      expect(installs).toEqual([['add', '@prisma/orm-postgres', 'dotenv', 'pg']]);
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
    'loads an init entrypoint the package exports only under the import condition',
    async () => {
      writePackage(
        '@prisma/orm-postgres',
        { type: 'module', exports: { './init': { import: './init.mjs' } } },
        { 'init.mjs': "export { default } from '@internal/postgres/init';\n" },
      );

      const run = await harness().run([...STARTER, '--skip-install'], { cwd: projectDir });

      expect(run.exitCode).toBe(0);
      expect(existsSync(join(projectDir, 'prisma.config.ts'))).toBe(true);
    },
    timeouts.coldTransformImport,
  );

  it.each([
    [
      'an export that names a missing file',
      { './init': './dist/init.mjs' },
      {},
      'dist/init.mjs, which does not exist',
    ],
    [
      'an init module that throws while it loads',
      { './init': './init.mjs' },
      { 'init.mjs': "import 'a-module-that-is-not-installed';\n" },
      'a-module-that-is-not-installed',
    ],
  ])(
    'names the module and the cause, with no file written, for %s',
    async (_case, exports, files, cause) => {
      writePackage('@prisma/orm-postgres', { type: 'module', exports }, files);

      const run = await harness().run([...STARTER, '--skip-install'], { cwd: projectDir });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_CONTRIBUTION_UNAVAILABLE',
          summary: 'Could not load @prisma/orm-postgres/init',
          why: expect.stringContaining(cause),
          meta: { reason: 'unloadable', module: '@prisma/orm-postgres/init' },
        },
      });
      expect(projectEntries()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'refuses --schema-path against --authoring before installing anything',
    async () => {
      const run = await harness().run([...STARTER, '--schema-path', 'db/schema.ts'], {
        cwd: projectDir,
      });

      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: { code: 'CLI.INIT_AUTHORING_SCHEMA_PATH_MISMATCH' },
      });
      expect(installs).toEqual([]);
      expect(projectEntries()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it.each([
    [
      'the package does not offer --authoring',
      async () => harness(await postgresWith({ authoringModes: ['typescript'] })),
      STARTER,
      'CLI.INIT_AUTHORING_UNSUPPORTED',
    ],
    [
      'the session cannot ask for the authoring mode',
      async () => harness(),
      [
        'orm',
        'init',
        '--target',
        'postgres',
        '--schema-path',
        'src/prisma/contract.prisma',
        '--json',
      ],
      'CLI.INIT_MISSING_FLAGS',
    ],
    [
      'the default export is not an init contribution',
      async () => harness(loadsAs({ kind: 'loaded', module: { default: {} } })),
      STARTER,
      'CLI.INIT_CONTRIBUTION_UNAVAILABLE',
    ],
  ])(
    'says what it installed and how to remove it when %s',
    async (_case, makeHarness, argv, code) => {
      const run = await (await makeHarness()).run(argv, { cwd: projectDir });

      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code,
          meta: expect.objectContaining({
            packagesAdded: ['@prisma/orm-postgres', 'dotenv', 'pg'],
          }),
          nextActions: expect.arrayContaining([expect.objectContaining({ label: REMOVE_ADDED })]),
        },
      });
      expect(projectEntries()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'writes no README when the contribution has none',
    async () => {
      writeProjectFile('src/index.ts', 'export {};\n');

      const run = await harness(await postgresWith({}, ['readme'])).run(
        [...STARTER, '--skip-install'],
        { cwd: projectDir },
      );

      expect(run.exitCode).toBe(0);
      expect(existsSync(join(projectDir, 'README.md'))).toBe(false);
    },
    timeouts.coldTransformImport,
  );

  it(
    'writes .env as the body of .env.example, without its intro',
    async () => {
      const contribution = await fixtureContribution('@prisma/orm-postgres');

      const run = await harness().run([...STARTER, '--skip-install', '--write-env'], {
        cwd: projectDir,
      });

      expect(run.exitCode).toBe(0);
      expect(readFileSync(join(projectDir, '.env'), 'utf-8')).toBe(contribution.envExample());
      expect(readFileSync(join(projectDir, '.env.example'), 'utf-8')).toBe(
        `# Copy this file to \`.env\` and replace the placeholder with your real connection string.\n${contribution.envExample()}`,
      );
    },
    timeouts.coldTransformImport,
  );

  it(
    'warns about a malformed probe answer, and fails on it only under --strict-probe',
    async () => {
      const loadInit = await postgresWith({
        probe: async () => JSON.parse('{"kind":"server-version"}'),
      });
      const env = { DATABASE_URL: 'postgres://localhost:5432/db' };

      const warned = await harness(loadInit).run([...STARTER, '--skip-install', '--probe-db'], {
        cwd: projectDir,
        env,
      });
      expect(warned.exitCode).toBe(0);
      expect(warned.presented?.data).toMatchObject({
        warnings: expect.arrayContaining([
          expect.stringContaining(
            'Skipped --probe-db: the probe of @prisma/orm-postgres gave a malformed answer',
          ),
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
        error: {
          code: 'CLI.INIT_PROBE_FAILED',
          why: expect.stringContaining('the probe of @prisma/orm-postgres gave a malformed answer'),
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
