import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type { PackageManagerId } from '@prisma/cli-engine';
import { timeouts } from '@repo/test-utils';
import { basename, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { importFromProject } from '../../src/orm/init-prisma7-check';
import { createTestProjectDir } from '../utils/test-project-dir';
import {
  envelopeOf,
  initTestCli,
  PNPM_WORKSPACE_LEAK,
  type RunnerCall,
  resolveWithin,
  type ScriptedInstalls,
  scriptedInstalls,
} from './init-install-fixtures';

const emit = vi.fn();

let projectDir: string;
let installs: ScriptedInstalls;

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-install');
  installs = scriptedInstalls();
  emit.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function harness(packageManager?: PackageManagerId) {
  return initTestCli({
    dependencies: {
      emitScaffoldedContract: emit,
      importFromProject,
      resolveModule: resolveWithin(projectDir),
    },
    runner: installs.runner,
    packageManager,
  });
}

function scaffoldArgv(...extra: string[]): string[] {
  return ['orm', 'init', '--target', 'postgres', '--authoring', 'psl', ...extra];
}

function skillCalls(): readonly RunnerCall[] {
  return installs.calls.filter((call) => call.args.includes('skills'));
}

describe('init installs', () => {
  it(
    'installs the engine in the same add as prisma, pinned to the version the toolchain of the target package peers on',
    async () => {
      const store = join(projectDir, 'node_modules', '.pnpm', 'target', 'node_modules', '@prisma');
      mkdirSync(join(store, 'orm-postgres'), { recursive: true });
      mkdirSync(join(store, 'orm-toolchain'), { recursive: true });
      writeFileSync(
        join(store, 'orm-postgres', 'package.json'),
        JSON.stringify({ name: '@prisma/orm-postgres', version: '8.0.0-rc.4' }),
        'utf-8',
      );
      writeFileSync(
        join(store, 'orm-toolchain', 'package.json'),
        JSON.stringify({
          name: '@prisma/orm-toolchain',
          version: '8.0.0-rc.4',
          peerDependencies: { '@prisma/cli-engine': '0.1.1' },
        }),
        'utf-8',
      );
      mkdirSync(join(projectDir, 'node_modules', '@prisma'), { recursive: true });
      symlinkSync(
        join(store, 'orm-postgres'),
        join(projectDir, 'node_modules', '@prisma', 'orm-postgres'),
        'junction',
      );

      const run = await harness().run(scaffoldArgv(), { cwd: projectDir });

      expect(run.exitCode).toBe(0);
      expect(installs.calls.map((call) => call.args)).toEqual([
        ['add', '@prisma/orm-postgres', 'dotenv'],
        ['add', '-D', 'prisma@latest', '@types/node', '@prisma/cli-engine@0.1.1'],
      ]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'adds the runtime and development dependencies through the capability, then emits',
    async () => {
      const run = await harness().run(scaffoldArgv(), { cwd: projectDir });

      expect(run.exitCode).toBe(0);
      expect(installs.calls).toEqual([
        {
          file: expect.any(String),
          args: ['add', '@prisma/orm-postgres', 'dotenv'],
          cwd: projectDir,
        },
        {
          file: expect.any(String),
          args: ['add', '-D', 'prisma@latest', '@types/node', '@prisma/cli-engine@latest'],
          cwd: projectDir,
        },
      ]);
      expect(emit).toHaveBeenCalledWith({ cwd: projectDir });
      expect(run.presented?.data).toMatchObject({
        packagesInstalled: {
          status: 'installed',
          deps: ['@prisma/orm-postgres', 'dotenv'],
          devDeps: ['prisma@latest', '@types/node', '@prisma/cli-engine@latest'],
        },
        contractEmitted: true,
      });
      expect(run.spawns).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'announces each package-manager run as a step',
    async () => {
      const run = await harness().run(scaffoldArgv(), { cwd: projectDir });

      expect(run.events).toContainEqual(
        expect.objectContaining({
          kind: 'step-started',
          step: expect.stringContaining('add @prisma/orm-postgres dotenv'),
        }),
      );
    },
    timeouts.coldTransformImport,
  );

  it(
    'completes at exit 4 with the install failure as a finding',
    async () => {
      installs.script = [{ exitCode: 1, stderr: 'ENOTFOUND registry.npmjs.org' }];

      const run = await harness().run([...scaffoldArgv(), '--json'], { cwd: projectDir });

      expect(run.exitCode).toBe(4);
      expect(envelopeOf(run)).toMatchObject({
        ok: true,
        exitCode: 4,
        diagnostics: [{ code: 'CLI.INIT_INSTALL_FAILED', severity: 'error' }],
      });
      expect(emit).not.toHaveBeenCalled();
      expect(skillCalls()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'writes a document that says the install failed, not that it was skipped',
    async () => {
      installs.script = [{ exitCode: 1, stderr: 'ENOTFOUND registry.npmjs.org' }];

      const run = await harness().run([...scaffoldArgv(), '--json'], { cwd: projectDir });

      expect(run.presented?.data).toMatchObject({
        ok: true,
        packagesInstalled: { status: 'failed', deps: [], devDeps: [] },
        contractEmitted: false,
      });
      expect(run.presented?.presentation.json).toMatchObject({
        nextSteps: expect.arrayContaining([
          expect.stringMatching(/Install the project dependencies.*failed/),
        ]),
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'completes at exit 5 when the contract emit fails after a good install',
    async () => {
      emit.mockRejectedValue(new Error('contract source is not readable'));

      const run = await harness().run([...scaffoldArgv(), '--json'], { cwd: projectDir });

      expect(run.exitCode).toBe(5);
      expect(envelopeOf(run)).toMatchObject({
        ok: true,
        exitCode: 5,
        diagnostics: [{ code: 'CLI.INIT_EMIT_FAILED', severity: 'error' }],
      });
      expect(run.presented?.data).toMatchObject({ contractEmitted: false });
      expect(skillCalls()).toEqual([]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'runs no skills command — the family-level `prisma init` owns skills setup',
    async () => {
      const run = await harness().run([...scaffoldArgv(), '--json'], { cwd: projectDir });

      expect(run.exitCode).toBe(0);
      expect(skillCalls()).toEqual([]);
      expect(installs.calls).toHaveLength(2);
      expect(JSON.stringify(run.presented?.data)).not.toContain('skills sync');
    },
    timeouts.coldTransformImport,
  );

  describe('the pnpm fallback', () => {
    it(
      'retries the pair with npm when pnpm leaks a workspace specifier',
      async () => {
        installs.script = [{ exitCode: 1, stderr: PNPM_WORKSPACE_LEAK }];

        const run = await harness('pnpm').run(scaffoldArgv(), { cwd: projectDir });

        expect(run.exitCode).toBe(0);
        expect(installs.calls.map((call) => `${call.file} ${call.args.join(' ')}`)).toEqual([
          'pnpm add @prisma/orm-postgres dotenv',
          'npm add @prisma/orm-postgres dotenv',
          'npm add -D prisma@latest @types/node @prisma/cli-engine@latest',
        ]);
        expect(run.events).toContainEqual(
          expect.objectContaining({
            kind: 'message',
            severity: 'warn',
            text: expect.stringContaining('package-lock.json'),
          }),
        );
      },
      timeouts.coldTransformImport,
    );

    it(
      'keeps registry credentials out of the fallback warning',
      async () => {
        installs.script = [
          {
            exitCode: 1,
            stderr: `${PNPM_WORKSPACE_LEAK} https://alice:hunter2@registry.example.com/ //registry.npmjs.org/:_authToken=npm_realsecret`,
          },
        ];

        const run = await harness('pnpm').run(scaffoldArgv(), { cwd: projectDir });
        const warnings = run.presented?.data;

        expect(JSON.stringify(warnings)).not.toContain('hunter2');
        expect(JSON.stringify(warnings)).not.toContain('npm_realsecret');
        expect(warnings).toMatchObject({
          warnings: expect.arrayContaining([expect.stringContaining('ERR_PNPM_WORKSPACE')]),
        });
      },
      timeouts.coldTransformImport,
    );

    it(
      'completes at exit 4 when npm fails too',
      async () => {
        installs.script = [
          { exitCode: 1, stderr: PNPM_WORKSPACE_LEAK },
          { exitCode: 1, stderr: 'npm ERR! 404 Not Found' },
        ];

        const run = await harness('pnpm').run([...scaffoldArgv(), '--json'], { cwd: projectDir });

        expect(run.exitCode).toBe(4);
        expect(envelopeOf(run)).toMatchObject({
          diagnostics: [{ code: 'CLI.INIT_INSTALL_FAILED' }],
        });
        expect(run.presented?.data).toMatchObject({
          warnings: expect.arrayContaining([
            expect.stringContaining('ERR_PNPM_WORKSPACE_PKG_NOT_FOUND'),
          ]),
        });
      },
      timeouts.coldTransformImport,
    );

    it(
      'does not retry a pnpm failure it does not recognise',
      async () => {
        installs.script = [{ exitCode: 1, stderr: 'EACCES: permission denied' }];

        const run = await harness('pnpm').run([...scaffoldArgv(), '--json'], { cwd: projectDir });

        expect(run.exitCode).toBe(4);
        expect(installs.calls).toHaveLength(1);
      },
      timeouts.coldTransformImport,
    );

    it(
      'does not retry a manager other than pnpm',
      async () => {
        installs.script = [{ exitCode: 1, stderr: PNPM_WORKSPACE_LEAK }];

        const run = await harness('yarn').run(scaffoldArgv(), { cwd: projectDir });

        expect(run.exitCode).toBe(4);
        expect(installs.calls).toHaveLength(1);
      },
      timeouts.coldTransformImport,
    );
  });

  it(
    'installs the driver the Mongo package declares as a peer dependency',
    async () => {
      const run = await harness().run(
        ['orm', 'init', '--target', 'mongodb', '--authoring', 'psl'],
        { cwd: projectDir },
      );

      expect(run.exitCode).toBe(0);
      expect(installs.calls[0]).toEqual({
        file: expect.any(String),
        args: ['add', '@prisma/orm-mongo', 'dotenv', 'mongodb'],
        cwd: projectDir,
      });
    },
    timeouts.coldTransformImport,
  );

  describe('--skip-install', () => {
    it(
      'installs nothing and emits nothing',
      async () => {
        const run = await harness().run(scaffoldArgv('--skip-install'), {
          cwd: projectDir,
        });

        expect(run.exitCode).toBe(0);
        expect(installs.calls).toEqual([]);
        expect(emit).not.toHaveBeenCalled();
        expect(run.presented?.data).toMatchObject({
          packagesInstalled: { status: 'skipped', deps: [], devDeps: [] },
          contractEmitted: false,
        });
        expect(run.presented?.presentation.next).toContainEqual(
          expect.objectContaining({ kind: 'run-command', command: 'prisma contract emit' }),
        );
      },
      timeouts.coldTransformImport,
    );
  });

  describe('on the Prisma 7 path', () => {
    const PRISMA7_SCHEMA =
      'datasource db {\n  provider = "postgresql"\n}\nmodel User {\n  id String @id\n}\n';

    function writePrisma7Project(manifest: Record<string, unknown>): void {
      mkdirSync(join(projectDir, 'prisma'), { recursive: true });
      writeFileSync(join(projectDir, 'prisma/schema.prisma'), PRISMA7_SCHEMA, 'utf-8');
      writeFileSync(join(projectDir, 'package.json'), `${JSON.stringify(manifest)}\n`, 'utf-8');
    }

    function prisma7Argv(): string[] {
      return [
        'orm',
        'init',
        '--from-prisma7-schema',
        'prisma/schema.prisma',
        '--confirm',
        basename(projectDir),
      ];
    }

    it(
      'installs the target package for the check first, then @prisma/client@7, @prisma/prisma7, and prisma@latest',
      async () => {
        writePrisma7Project({
          name: 'app',
          devDependencies: { prisma: '^7.4.0' },
          dependencies: { '@prisma/client': '^6.0.0' },
        });

        const run = await harness().run(prisma7Argv(), { cwd: projectDir });

        expect(run.exitCode).toBe(0);
        expect(installs.calls.map((call) => call.args)).toEqual([
          ['add', '@prisma/orm-postgres', 'dotenv'],
          ['add', '@prisma/client@7'],
          [
            'add',
            '-D',
            'prisma@latest',
            '@types/node',
            '@prisma/prisma7@7',
            '@prisma/cli-engine@latest',
          ],
        ]);
      },
      timeouts.coldTransformImport,
    );

    it(
      'leaves @prisma/client alone when it is already on the Prisma 7 line',
      async () => {
        writePrisma7Project({
          name: 'app',
          devDependencies: { prisma: '^7.4.0' },
          dependencies: { '@prisma/client': '^7.4.0' },
        });

        const run = await harness().run(prisma7Argv(), { cwd: projectDir });

        expect(run.exitCode).toBe(0);
        expect(installs.calls[0]?.args).toEqual(['add', '@prisma/orm-postgres', 'dotenv']);
        expect(installs.calls[1]?.args).toContain('@prisma/prisma7@7');
      },
      timeouts.coldTransformImport,
    );

    it.each([
      ['never declared @prisma/client', {}],
      ['declares @prisma/client through the workspace', { '@prisma/client': 'workspace:*' }],
    ])(
      'does not add @prisma/client when the project %s',
      async (_case, dependencies) => {
        writePrisma7Project({
          name: 'app',
          devDependencies: { prisma: '^7.4.0' },
          dependencies,
        });

        const run = await harness().run(prisma7Argv(), { cwd: projectDir });

        expect(run.exitCode).toBe(0);
        expect(installs.calls[0]?.args).toEqual(['add', '@prisma/orm-postgres', 'dotenv']);
        expect(installs.calls[1]?.args).toContain('@prisma/prisma7@7');
      },
      timeouts.coldTransformImport,
    );

    it(
      'installs only the usual packages when @prisma/prisma7 is already declared',
      async () => {
        writePrisma7Project({
          name: 'app',
          devDependencies: { prisma: '^8.0.0', '@prisma/prisma7': '^7.10.0' },
        });

        const run = await harness().run(prisma7Argv().slice(0, 4), { cwd: projectDir });

        expect(run.exitCode).toBe(0);
        expect(installs.calls.map((call) => call.args)).toEqual([
          ['add', '@prisma/orm-postgres', 'dotenv'],
          ['add', '-D', 'prisma@latest', '@types/node', '@prisma/cli-engine@latest'],
        ]);
      },
      timeouts.coldTransformImport,
    );
  });

  describe('a host with no package-manager runner', () => {
    it(
      'reports the install failure rather than pretending it installed',
      async () => {
        const cli = initTestCli({
          dependencies: {
            emitScaffoldedContract: emit,
            importFromProject,
            resolveModule: resolveWithin(projectDir),
          },
          runner: undefined,
          packageManager: undefined,
        });

        const run = await cli.run([...scaffoldArgv(), '--json'], { cwd: projectDir });

        expect(run.exitCode).toBe(4);
        expect(envelopeOf(run)).toMatchObject({
          diagnostics: [{ code: 'CLI.INIT_INSTALL_FAILED' }],
        });
      },
      timeouts.coldTransformImport,
    );
  });
});
