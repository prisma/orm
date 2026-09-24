import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import type { MountedTree, PackageManagerId, PackageManagerRunner } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { timeouts } from '@repo/test-utils';
import { basename, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createInitCommand } from '../../src/orm/init';
import { type ImportFromProject, importFromProject } from '../../src/orm/init-prisma7-check';
import { createTestProjectDir, fixtureAppDir } from '../utils/test-project-dir';

const FIXTURE = join(fixtureAppDir, 'fixtures/prisma7-project');
const TARGET_CONFIG = '@prisma/orm-postgres/config';
const VIEW_DIAGNOSTIC = {
  code: 'PSL.PRISMA7_VIEW_UNSUPPORTED',
  message: 'View "UserInfo" is not supported; Prisma 8 has no views.',
  sourceId: 'prisma/schema.prisma',
  span: { start: { offset: 477, line: 26, column: 1 }, end: { offset: 481, line: 26, column: 5 } },
};

const PNPM_WORKSPACE_LEAK =
  'ERR_PNPM_WORKSPACE_PKG_NOT_FOUND  In : "@prisma/orm-postgres@workspace:*" is in the dependencies but no package named "@prisma/orm-postgres" is present in the workspace';

let projectDir: string;
let installs: (readonly string[])[];
let script: { readonly exitCode: number; readonly stderr: string }[];
let loadTargetConfig: ImportFromProject;

const runner: PackageManagerRunner = async (request) => {
  installs.push([...request.args]);
  return script.shift() ?? { exitCode: 0, stderr: '' };
};

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-prisma7-check');
  installs = [];
  script = [];
  loadTargetConfig = importFromProject;
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function harness(packageManager?: PackageManagerId) {
  const commands: MountedTree = {
    ...BIN_COMMANDS,
    'orm init': createInitCommand({
      emitScaffoldedContract: vi.fn().mockResolvedValue(undefined),
      importFromProject: (cwd, specifier) => loadTargetConfig(cwd, specifier),
    }),
  };
  return createTestCli({
    commands,
    groups: BIN_GROUPS,
    packageManagerRunner: runner,
    ...(packageManager === undefined ? {} : { packageManager }),
  });
}

function copyFixture(): void {
  cpSync(FIXTURE, projectDir, { recursive: true });
  renameSync(join(projectDir, 'package.json.fixture'), join(projectDir, 'package.json'));
  mkdirSync(join(projectDir, 'node_modules/prisma'), { recursive: true });
  writeFileSync(
    join(projectDir, 'node_modules/prisma/package.json'),
    JSON.stringify({ name: 'prisma', version: '7.4.1', exports: { './config': './config.js' } }),
  );
  writeFileSync(
    join(projectDir, 'node_modules/prisma/config.js'),
    'export const defineConfig = (c) => c;\n',
  );
}

function projectFile(relative: string): string {
  return readFileSync(join(projectDir, relative), 'utf-8');
}

function fixtureFile(relative: string): string {
  return readFileSync(join(FIXTURE, relative), 'utf-8');
}

/** The target package's real `defineConfig`, with `prisma7Schema` replaced or removed. */
async function targetConfigWith(
  prisma7Schema: ((schemaPath: string) => unknown) | undefined,
): Promise<ImportFromProject> {
  const real = await importFromProject(projectDir, TARGET_CONFIG);
  return async () => ({
    defineConfig: real?.['defineConfig'],
    ...(prisma7Schema === undefined ? {} : { prisma7Schema }),
  });
}

function refusingSource(schemaPath: string) {
  return {
    source: {
      inputs: [schemaPath],
      load: async () => ({
        ok: false,
        failure: {
          summary: 'Prisma 7 schema interpretation failed',
          diagnostics: [VIEW_DIAGNOSTIC],
        },
      }),
    },
  };
}

function prisma7Argv(...extra: string[]): string[] {
  return [
    'orm',
    'init',
    '--from-prisma7-schema',
    'prisma/schema.prisma',
    '--confirm',
    basename(projectDir),
    ...extra,
  ];
}

function envelopeOf(run: { readonly json: readonly { readonly kind: string }[] }) {
  const terminal = run.json.at(-1);
  return terminal !== undefined && terminal.kind === 'result'
    ? Reflect.get(terminal, 'envelope')
    : undefined;
}

function expectProjectUnchangedApartFromTheCheckInstall(): void {
  expect(projectFile('prisma.config.ts')).toBe(fixtureFile('prisma.config.ts'));
  expect(existsSync(join(projectDir, 'prisma7.config.ts'))).toBe(false);
  expect(projectFile('package.json')).toBe(fixtureFile('package.json.fixture'));
  expect(existsSync(join(projectDir, 'src/prisma'))).toBe(false);
  expect(existsSync(join(projectDir, 'prisma-8.md'))).toBe(false);
  expect(installs).toEqual([['add', '@prisma/orm-postgres', 'dotenv']]);
}

describe('the Prisma 7 check before init changes the project', () => {
  it(
    'refuses with the source diagnostics and leaves the project unchanged',
    async () => {
      copyFixture();
      loadTargetConfig = await targetConfigWith(refusingSource);

      const run = await harness().run(prisma7Argv(), { cwd: projectDir });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_PRISMA7_SCHEMA_REFUSED',
          why: 'Prisma 7 schema interpretation failed\n  prisma/schema.prisma:26:1 PSL.PRISMA7_VIEW_UNSUPPORTED View "UserInfo" is not supported; Prisma 8 has no views.',
          nextActions: [
            expect.objectContaining({
              label: expect.stringMatching(/^Edit prisma\/schema\.prisma as each finding says/),
            }),
            expect.objectContaining({
              label: expect.stringMatching(
                /^init added @prisma\/orm-postgres and dotenv to package\.json before checking; remove them with `\w+ (remove|uninstall) @prisma\/orm-postgres dotenv`\.$/,
              ),
            }),
          ],
          meta: {
            schemaPath: 'prisma/schema.prisma',
            summary: 'Prisma 7 schema interpretation failed',
            diagnostics: [VIEW_DIAGNOSTIC],
            packagesAdded: ['@prisma/orm-postgres', 'dotenv'],
          },
        },
      });
      expectProjectUnchangedApartFromTheCheckInstall();
    },
    timeouts.coldTransformImport,
  );

  it(
    'names only the packages the project did not declare before the check',
    async () => {
      copyFixture();
      const manifest = JSON.parse(projectFile('package.json'));
      manifest.dependencies = { ...manifest.dependencies, dotenv: '^17.0.0' };
      writeFileSync(join(projectDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      loadTargetConfig = await targetConfigWith(refusingSource);

      const run = await harness().run(prisma7Argv(), { cwd: projectDir });

      expect(envelopeOf(run)).toMatchObject({
        error: {
          code: 'CLI.INIT_PRISMA7_SCHEMA_REFUSED',
          nextActions: [
            expect.anything(),
            expect.objectContaining({
              label: expect.stringMatching(
                /^init added @prisma\/orm-postgres to package\.json before checking; remove it with `\w+ (remove|uninstall) @prisma\/orm-postgres`\.$/,
              ),
            }),
          ],
          meta: { packagesAdded: ['@prisma/orm-postgres'] },
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'refuses --from-prisma7-schema when the target package has no Prisma 7 source',
    async () => {
      copyFixture();
      loadTargetConfig = await targetConfigWith(undefined);

      const run = await harness().run(prisma7Argv(), { cwd: projectDir });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE',
          why: '@prisma/orm-postgres does not provide a Prisma 7 contract source, so it cannot read prisma/schema.prisma.',
          meta: {
            schemaPath: 'prisma/schema.prisma',
            packageName: '@prisma/orm-postgres',
            packagesAdded: ['@prisma/orm-postgres', 'dotenv'],
          },
        },
      });
      expectProjectUnchangedApartFromTheCheckInstall();
    },
    timeouts.coldTransformImport,
  );

  it(
    'runs a fresh init after a yes to the question when the target package has no Prisma 7 source',
    async () => {
      copyFixture();
      loadTargetConfig = await targetConfigWith(undefined);

      const run = await harness().run(['orm', 'init'], {
        cwd: projectDir,
        isTty: { stdin: true },
        answers: [true, 'psl', 'src/prisma/contract.prisma', basename(projectDir), false],
      });

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({
        target: 'postgres',
        authoring: 'psl',
        schemaPath: 'src/prisma/contract.prisma',
        prisma7: null,
      });
      const warnings = Reflect.get(Object(run.presented?.data), 'warnings');
      expect(warnings.filter((text: string) => text.includes('cannot read'))).toEqual([
        '@prisma/orm-postgres cannot read Prisma 7 schemas, so init sets up a fresh Prisma 8 project instead and leaves prisma/schema.prisma alone. It asks before replacing the Prisma 7 prisma.config.ts, and it installs prisma@latest, which replaces the Prisma 7 CLI.',
      ]);
      expect(projectFile('prisma.config.ts')).toContain('definePrismaConfig');
      expect(installs[0]).toEqual(['add', '@prisma/orm-postgres', 'dotenv']);
      expect(installs.filter((args) => args.includes('dotenv'))).toHaveLength(1);
    },
    timeouts.coldTransformImport,
  );

  it(
    'names the packages it installed when a later consent cannot be answered',
    async () => {
      copyFixture();

      const run = await harness().run(
        ['orm', 'init', '--from-prisma7-schema', 'prisma/schema.prisma'],
        { cwd: projectDir },
      );

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run)).toMatchObject({
        error: {
          code: 'CLI.CONSENT_REQUIRED',
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label: expect.stringMatching(
                /^init added @prisma\/orm-postgres and dotenv to package\.json before checking; remove them with `\w+ (remove|uninstall) @prisma\/orm-postgres dotenv`\.$/,
              ),
            }),
          ]),
          meta: expect.objectContaining({ packagesAdded: ['@prisma/orm-postgres', 'dotenv'] }),
        },
      });
      expectProjectUnchangedApartFromTheCheckInstall();
    },
    timeouts.coldTransformImport,
  );

  it.each([
    [
      'loading the target package throws',
      'CLI.UNEXPECTED',
      async (): Promise<ImportFromProject> => async () => {
        throw new Error('module exploded');
      },
    ],
    [
      'the source throws',
      'CONTRACT.SOURCE_LOAD_FAILED',
      () =>
        targetConfigWith((schemaPath) => ({
          source: {
            inputs: [schemaPath],
            load: async () => {
              throw new Error('source exploded');
            },
          },
        })),
    ],
  ])(
    'names the packages it installed when %s',
    async (_case, code, loader) => {
      copyFixture();
      loadTargetConfig = await loader();

      const run = await harness().run(prisma7Argv(), { cwd: projectDir });

      expect(envelopeOf(run)).toMatchObject({
        error: {
          code,
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label: expect.stringMatching(
                /^init added @prisma\/orm-postgres and dotenv to package\.json before checking; remove them with/,
              ),
            }),
          ]),
          meta: expect.objectContaining({ packagesAdded: ['@prisma/orm-postgres', 'dotenv'] }),
        },
      });
      expectProjectUnchangedApartFromTheCheckInstall();
    },
    timeouts.coldTransformImport,
  );

  it(
    'keeps the install warnings when the install before the check fails',
    async () => {
      copyFixture();
      script = [
        { exitCode: 1, stderr: PNPM_WORKSPACE_LEAK },
        { exitCode: 1, stderr: 'npm ERR! 404 Not Found' },
      ];

      const run = await harness('pnpm').run(prisma7Argv(), { cwd: projectDir });

      expect(run.exitCode).toBe(4);
      expect(run.presented?.data).toMatchObject({
        filesWritten: [],
        warnings: expect.arrayContaining([
          expect.stringContaining('ERR_PNPM_WORKSPACE_PKG_NOT_FOUND'),
        ]),
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'names the package manager that finished the install in the remove command',
    async () => {
      copyFixture();
      script = [{ exitCode: 1, stderr: PNPM_WORKSPACE_LEAK }];
      loadTargetConfig = await targetConfigWith(refusingSource);

      const run = await harness('pnpm').run(prisma7Argv(), { cwd: projectDir });

      expect(envelopeOf(run)).toMatchObject({
        error: {
          code: 'CLI.INIT_PRISMA7_SCHEMA_REFUSED',
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label: expect.stringContaining('`npm uninstall @prisma/orm-postgres dotenv`'),
            }),
          ]),
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'says the target package could not be loaded when it was installed but does not resolve',
    async () => {
      copyFixture();
      loadTargetConfig = async () => undefined;

      const run = await harness().run(prisma7Argv(), { cwd: projectDir });

      expect(envelopeOf(run)).toMatchObject({
        error: {
          code: 'CLI.INIT_PRISMA7_SOURCE_UNAVAILABLE',
          summary: 'Could not load @prisma/orm-postgres from the project',
          meta: { reason: 'not-resolvable' },
          nextActions: expect.arrayContaining([
            expect.objectContaining({
              label: expect.stringMatching(/^Check that @prisma\/orm-postgres is installed/),
            }),
          ]),
        },
      });
      expectProjectUnchangedApartFromTheCheckInstall();
    },
    timeouts.coldTransformImport,
  );

  it(
    'warns and continues under --skip-install when the target package is not installed',
    async () => {
      copyFixture();
      loadTargetConfig = async () => undefined;

      const run = await harness().run(prisma7Argv('--skip-install'), { cwd: projectDir });

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({
        warnings: expect.arrayContaining([
          'Could not check that Prisma 8 can read prisma/schema.prisma: @prisma/orm-postgres is not installed. Install the dependencies and run `prisma contract emit` to check it.',
        ]),
      });
      expect(existsSync(join(projectDir, 'prisma7.config.ts'))).toBe(true);
      expect(installs).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'proceeds to the scaffold when the source reads the schema',
    async () => {
      copyFixture();
      const loaded: string[] = [];
      loadTargetConfig = (cwd, specifier) => {
        loaded.push(specifier);
        return importFromProject(cwd, specifier);
      };

      const run = await harness().run(prisma7Argv(), { cwd: projectDir });

      expect(loaded).toEqual([TARGET_CONFIG]);

      expect(run.exitCode).toBe(0);
      expect(existsSync(join(projectDir, 'prisma7.config.ts'))).toBe(true);
      expect(existsSync(join(projectDir, 'src/prisma/db.ts'))).toBe(true);
      expect(run.presented?.data).toMatchObject({
        packagesInstalled: {
          status: 'installed',
          deps: ['@prisma/orm-postgres', 'dotenv'],
        },
      });
      expect(installs[0]).toEqual(['add', '@prisma/orm-postgres', 'dotenv']);
      expect(installs.filter((args) => args.includes('dotenv'))).toHaveLength(1);
    },
    timeouts.coldTransformImport,
  );
});
