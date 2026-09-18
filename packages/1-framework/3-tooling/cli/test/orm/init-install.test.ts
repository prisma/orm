import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type { MountedTree, PackageManagerId, PackageManagerRunner } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createInitCommand } from '../../src/orm/init';
import { createTestProjectDir } from '../utils/test-project-dir';

const emit = vi.fn();

/** The production tree, with `init` rebuilt around the injected fake emit. */
const commands: MountedTree = {
  ...BIN_COMMANDS,
  'orm init': createInitCommand({ emitScaffoldedContract: emit }),
};
const groups = BIN_GROUPS;

interface RunnerCall {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
}

interface ScriptedResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly addsToManifest?: boolean;
  /**
   * The directory pnpm writes its modules manifest in — the project itself, or
   * the workspace root it links from — and what it names as skipped there.
   */
  readonly modulesManifest?: { readonly dir: string; readonly ignoredBuilds: readonly string[] };
}

let projectDir: string;
let calls: RunnerCall[];
let script: ScriptedResult[];

const PNPM_WORKSPACE_LEAK =
  'ERR_PNPM_WORKSPACE_PKG_NOT_FOUND  In : "@prisma/orm-postgres@workspace:*" is in the dependencies but no package named "@prisma/orm-postgres" is present in the workspace';

/** What pnpm 12 writes to stderr when strictDepBuilds (on by default) stops an add. */
const PNPM_12_IGNORED_BUILDS = [
  'Error: ERR_PNPM_IGNORED_BUILDS',
  '',
  '  × adding a new package',
  '  ╰─▶ Ignored build scripts: esbuild@0.28.2, msgpackr-extract@3.0.4,',
  '      workerd@1.20260704.1',
  '  help: Run "pnpm approve-builds" to pick which dependencies should be allowed',
  '        to run scripts.',
].join('\n');

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-install');
  calls = [];
  script = [];
  emit.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

/** What pnpm has already written by the time it fails an add over ignored build scripts. */
function addToManifest(cwd: string, args: readonly string[]): void {
  const manifestPath = join(cwd, 'package.json');
  const manifest: Record<string, unknown> = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf-8'))
    : {};
  const field = args.includes('-D') ? 'devDependencies' : 'dependencies';
  const added = args.filter((arg) => arg !== 'add' && arg !== '-D');
  writeFileSync(
    manifestPath,
    JSON.stringify({ ...manifest, [field]: Object.fromEntries(added.map((spec) => [spec, '*'])) }),
  );
}

/** The modules manifest pnpm writes beside the tree it linked, naming what it skipped. */
function writeModulesManifest(dir: string, ignoredBuilds: readonly string[]): void {
  const modulesDir = join(dir, 'node_modules');
  mkdirSync(modulesDir, { recursive: true });
  writeFileSync(
    join(modulesDir, '.modules.yaml'),
    JSON.stringify({ ignoredBuilds, pendingBuilds: [] }),
  );
}

const runner: PackageManagerRunner = async (request) => {
  calls.push({ file: request.file, args: [...request.args], cwd: request.cwd });
  const result = script.shift() ?? { exitCode: 0, stderr: '' };
  if (result.addsToManifest === true) {
    addToManifest(request.cwd, request.args);
  }
  if (result.modulesManifest !== undefined) {
    writeModulesManifest(result.modulesManifest.dir, result.modulesManifest.ignoredBuilds);
  }
  return { exitCode: result.exitCode, stderr: result.stderr };
};

function harness(packageManager?: PackageManagerId) {
  return createTestCli({
    commands,
    groups,
    packageManagerRunner: runner,
    ...(packageManager === undefined ? {} : { packageManager }),
  });
}

function scaffoldArgv(...extra: string[]): string[] {
  return ['orm', 'init', '--target', 'postgres', '--authoring', 'psl', ...extra];
}

function envelopeOf(run: { readonly json: readonly { readonly kind: string }[] }) {
  const terminal = run.json.at(-1);
  return terminal !== undefined && terminal.kind === 'result'
    ? Reflect.get(terminal, 'envelope')
    : undefined;
}

function skillCalls(): readonly RunnerCall[] {
  return calls.filter((call) => call.args.includes('skills'));
}

describe('init installs', () => {
  it(
    'installs the engine in the same add as prisma, pinned to the version the runtime toolchain peers on',
    async () => {
      const store = join(projectDir, 'node_modules', '.pnpm', 'runtime', 'node_modules', '@prisma');
      mkdirSync(join(store, 'orm-postgres'), { recursive: true });
      mkdirSync(join(store, 'orm-toolchain'), { recursive: true });
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
      expect(calls.map((call) => call.args)).toEqual([
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
      expect(calls).toEqual([
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
      script = [{ exitCode: 1, stderr: 'ENOTFOUND registry.npmjs.org' }];

      const run = await harness().run(scaffoldArgv(), { cwd: projectDir });

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
      script = [{ exitCode: 1, stderr: 'ENOTFOUND registry.npmjs.org' }];

      const run = await harness().run(scaffoldArgv(), { cwd: projectDir });

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

      const run = await harness().run(scaffoldArgv(), { cwd: projectDir });

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
      const run = await harness().run(scaffoldArgv(), { cwd: projectDir });

      expect(run.exitCode).toBe(0);
      expect(skillCalls()).toEqual([]);
      expect(calls).toHaveLength(2);
      expect(JSON.stringify(run.presented?.data)).not.toContain('skills sync');
    },
    timeouts.coldTransformImport,
  );

  describe('the pnpm fallback', () => {
    it(
      'retries the pair with npm when pnpm leaks a workspace specifier',
      async () => {
        script = [{ exitCode: 1, stderr: PNPM_WORKSPACE_LEAK }];

        const run = await harness('pnpm').run(scaffoldArgv(), { cwd: projectDir });

        expect(run.exitCode).toBe(0);
        expect(calls.map((call) => `${call.file} ${call.args.join(' ')}`)).toEqual([
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
        script = [
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
        script = [
          { exitCode: 1, stderr: PNPM_WORKSPACE_LEAK },
          { exitCode: 1, stderr: 'npm ERR! 404 Not Found' },
        ];

        const run = await harness('pnpm').run(scaffoldArgv(), { cwd: projectDir });

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
        script = [{ exitCode: 1, stderr: 'EACCES: permission denied' }];

        const run = await harness('pnpm').run(scaffoldArgv(), { cwd: projectDir });

        expect(run.exitCode).toBe(4);
        expect(calls).toHaveLength(1);
      },
      timeouts.coldTransformImport,
    );

    it(
      'does not retry a manager other than pnpm',
      async () => {
        script = [{ exitCode: 1, stderr: PNPM_WORKSPACE_LEAK }];

        const run = await harness('yarn').run(scaffoldArgv(), { cwd: projectDir });

        expect(run.exitCode).toBe(4);
        expect(calls).toHaveLength(1);
      },
      timeouts.coldTransformImport,
    );
  });

  describe('build scripts pnpm has not been told to trust', () => {
    it(
      'completes when pnpm 12 fails the adds only over ignored build scripts',
      async () => {
        script = [
          { exitCode: 1, stderr: PNPM_12_IGNORED_BUILDS },
          { exitCode: 1, stderr: PNPM_12_IGNORED_BUILDS },
        ];

        const run = await harness('pnpm').run(scaffoldArgv(), { cwd: projectDir });

        expect(run.exitCode).toBe(0);
        expect(calls).toHaveLength(2);
        expect(emit).toHaveBeenCalledWith({ cwd: projectDir });
        expect(run.presented?.data).toMatchObject({
          packagesInstalled: { status: 'installed' },
          contractEmitted: true,
          warnings: expect.arrayContaining([expect.stringContaining('pnpm approve-builds')]),
        });
      },
      timeouts.coldTransformImport,
    );

    it(
      'completes when pnpm 11 records skipped scripts and exits non-zero after adding the packages',
      async () => {
        script = [
          {
            exitCode: 1,
            stderr: 'Command failed with exit code 1: pnpm add @prisma/orm-postgres dotenv',
            addsToManifest: true,
            modulesManifest: { dir: projectDir, ignoredBuilds: ['esbuild@0.28.2'] },
          },
          {
            exitCode: 1,
            stderr:
              'Command failed with exit code 1: pnpm add -D prisma@latest @types/node @prisma/cli-engine@latest',
            addsToManifest: true,
            modulesManifest: { dir: projectDir, ignoredBuilds: ['esbuild@0.28.2'] },
          },
        ];

        const run = await harness('pnpm').run(scaffoldArgv(), { cwd: projectDir });

        expect(run.exitCode).toBe(0);
        expect(emit).toHaveBeenCalledWith({ cwd: projectDir });
        expect(run.presented?.data).toMatchObject({
          packagesInstalled: { status: 'installed' },
          warnings: expect.arrayContaining([expect.stringContaining('pnpm approve-builds')]),
        });
      },
      timeouts.coldTransformImport,
    );

    it(
      'reads the record pnpm writes at the workspace root, not in the project',
      async () => {
        const workspaceProject = join(projectDir, 'packages', 'database');
        mkdirSync(workspaceProject, { recursive: true });
        const record = { dir: projectDir, ignoredBuilds: ['esbuild@0.28.2'] };
        script = [
          { exitCode: 1, stderr: '', addsToManifest: true, modulesManifest: record },
          { exitCode: 1, stderr: '', addsToManifest: true, modulesManifest: record },
        ];

        const run = await harness('pnpm').run(scaffoldArgv(), { cwd: workspaceProject });

        expect(run.exitCode).toBe(0);
        expect(emit).toHaveBeenCalledWith({ cwd: workspaceProject });
        expect(run.presented?.data).toMatchObject({
          packagesInstalled: { status: 'installed' },
          warnings: expect.arrayContaining([expect.stringContaining('pnpm approve-builds')]),
        });
      },
      timeouts.coldTransformImport,
    );

    it(
      'still fails a pnpm add that rewrites package.json while its record names nothing skipped',
      async () => {
        script = [
          {
            exitCode: 1,
            stderr: '',
            addsToManifest: true,
            modulesManifest: { dir: projectDir, ignoredBuilds: [] },
          },
        ];

        const run = await harness('pnpm').run(scaffoldArgv(), { cwd: projectDir });

        expect(run.exitCode).toBe(4);
        expect(emit).not.toHaveBeenCalled();
      },
      timeouts.coldTransformImport,
    );

    it(
      'still fails a pnpm add that records skipped scripts without adding the packages',
      async () => {
        script = [
          {
            exitCode: 7,
            stderr: '',
            modulesManifest: { dir: projectDir, ignoredBuilds: ['esbuild@0.28.2'] },
          },
        ];

        const run = await harness('pnpm').run(scaffoldArgv(), { cwd: projectDir });

        expect(run.exitCode).toBe(4);
        expect(emit).not.toHaveBeenCalled();
      },
      timeouts.coldTransformImport,
    );

    it(
      'still fails another manager that exits non-zero the same way',
      async () => {
        script = [{ exitCode: 1, stderr: PNPM_12_IGNORED_BUILDS, addsToManifest: true }];

        const run = await harness('npm').run(scaffoldArgv(), { cwd: projectDir });

        expect(run.exitCode).toBe(4);
        expect(emit).not.toHaveBeenCalled();
      },
      timeouts.coldTransformImport,
    );
  });

  describe('--skip-install', () => {
    it(
      'installs nothing and emits nothing',
      async () => {
        const run = await harness().run(scaffoldArgv('--skip-install'), {
          cwd: projectDir,
        });

        expect(run.exitCode).toBe(0);
        expect(calls).toEqual([]);
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

  describe('a host with no package-manager runner', () => {
    it(
      'reports the install failure rather than pretending it installed',
      async () => {
        const run = await createTestCli({ commands, groups }).run(scaffoldArgv(), {
          cwd: projectDir,
        });

        expect(run.exitCode).toBe(4);
        expect(envelopeOf(run)).toMatchObject({
          diagnostics: [{ code: 'CLI.INIT_INSTALL_FAILED' }],
        });
      },
      timeouts.coldTransformImport,
    );
  });
});
