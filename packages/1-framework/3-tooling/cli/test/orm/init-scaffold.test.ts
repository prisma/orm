import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { PackageManagerRunner } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { timeouts } from '@repo/test-utils';
import { expectDefined } from '@repo/test-utils/typed-expectations';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SKILL_SOURCES } from '../../src/commands/init/skill-sources';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createTestProjectDir } from '../utils/test-project-dir';

let projectDir: string;
let calls: Array<{ readonly file: string; readonly args: readonly string[] }>;

const runner: PackageManagerRunner = async (request) => {
  calls.push({ file: request.file, args: [...request.args] });
  return { exitCode: 0, stderr: '' };
};

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-scaffold');
  calls = [];
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function harness() {
  return createTestCli({
    commands: BIN_COMMANDS,
    groups: BIN_GROUPS,
    packageManagerRunner: runner,
  });
}

function scaffoldArgv(...extra: string[]): string[] {
  return ['orm', 'init', '--target', 'postgres', '--authoring', 'psl', ...extra];
}

const SKIP_ALL = ['--skip-install', '--skip-skills'] as const;

/**
 * The emit step spawns the project-local `@prisma/cli` bin, which the mocked
 * package-manager runner never installs — seed a no-op stand-in for runs that
 * do not pass `--skip-install`.
 */
function installFakeProjectLocalCli(dir: string): void {
  const packageDir = join(dir, 'node_modules/@prisma/cli');
  mkdirSync(join(packageDir, 'bin'), { recursive: true });
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name: '@prisma/cli',
      version: '0.0.0-test',
      type: 'module',
      bin: { 'prisma-cli': './bin/prisma-cli.mjs' },
    }),
  );
  writeFileSync(join(packageDir, 'bin/prisma-cli.mjs'), '');
}

function envelopeOf(run: { readonly json: readonly { readonly kind: string }[] }) {
  const terminal = run.json.at(-1);
  return terminal !== undefined && terminal.kind === 'result'
    ? Reflect.get(terminal, 'envelope')
    : undefined;
}

describe('init scaffold', () => {
  describe('the files it merges with', () => {
    it(
      'reports the tsconfig merge and keeps the options the project already had',
      async () => {
        writeFileSync(
          join(projectDir, 'tsconfig.json'),
          '{\n  // a comment JSONC tolerates\n  "compilerOptions": { "strict": true }\n}\n',
          'utf-8',
        );

        const run = await harness().run(scaffoldArgv(...SKIP_ALL), { cwd: projectDir });
        const merged = readFileSync(join(projectDir, 'tsconfig.json'), 'utf-8');

        expect(run.exitCode).toBe(0);
        expect(merged).toContain('"strict": true');
        expect(run.events).toContainEqual({
          kind: 'message',
          severity: 'info',
          text: 'Updated tsconfig.json with required compiler options.',
        });
      },
      timeouts.coldTransformImport,
    );

    it(
      'synthesises a manifest for a bare directory and says so',
      async () => {
        const run = await harness().run(scaffoldArgv(...SKIP_ALL), { cwd: projectDir });
        const manifest = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf-8'));

        expect(manifest).toMatchObject({ private: true, type: 'module' });
        expect(run.presented?.data).toMatchObject({
          warnings: expect.arrayContaining([expect.stringContaining('created a minimal one')]),
        });
      },
      timeouts.coldTransformImport,
    );

    it(
      'leaves a deno project without a package.json',
      async () => {
        writeFileSync(join(projectDir, 'deno.json'), '{}\n', 'utf-8');

        const run = await harness().run(scaffoldArgv(...SKIP_ALL), { cwd: projectDir });

        expect(run.exitCode).toBe(0);
        expect(run.presented?.data).toMatchObject({
          filesWritten: expect.not.arrayContaining(['package.json']),
        });
      },
      timeouts.coldTransformImport,
    );

    it(
      'writes a README only when the project has a source entrypoint and no README',
      async () => {
        mkdirSync(join(projectDir, 'src'), { recursive: true });
        writeFileSync(join(projectDir, 'src/index.ts'), 'export {}\n', 'utf-8');

        const run = await harness().run(scaffoldArgv(...SKIP_ALL), { cwd: projectDir });

        expect(run.presented?.data).toMatchObject({
          filesWritten: expect.arrayContaining(['README.md']),
        });
      },
      timeouts.coldTransformImport,
    );

    it(
      'leaves an existing README alone and warns',
      async () => {
        mkdirSync(join(projectDir, 'src'), { recursive: true });
        writeFileSync(join(projectDir, 'src/index.ts'), 'export {}\n', 'utf-8');
        writeFileSync(join(projectDir, 'README.md'), '# mine\n', 'utf-8');

        const run = await harness().run(scaffoldArgv(...SKIP_ALL), { cwd: projectDir });

        expect(readFileSync(join(projectDir, 'README.md'), 'utf-8')).toBe('# mine\n');
        expect(run.presented?.data).toMatchObject({
          warnings: expect.arrayContaining([expect.stringContaining('README.md already exists')]),
        });
      },
      timeouts.coldTransformImport,
    );
  });

  describe('the files it removes', () => {
    it(
      'deletes a retired agent-skill directory even on a first run, leaving installed skills alone under --skip-skills',
      async () => {
        const retired = join(projectDir, '.claude/skills/prisma-next-queries');
        mkdirSync(retired, { recursive: true });
        writeFileSync(join(retired, 'SKILL.md'), '# stale\n', 'utf-8');
        const [firstSource] = DEFAULT_SKILL_SOURCES;
        expectDefined(firstSource);
        const installed = join(projectDir, `.agents/skills/${firstSource.skill}`);
        mkdirSync(installed, { recursive: true });
        writeFileSync(join(installed, 'SKILL.md'), '# installed\n', 'utf-8');

        const run = await harness().run(scaffoldArgv(...SKIP_ALL), { cwd: projectDir });

        expect(run.exitCode).toBe(0);
        expect(run.presented?.data).toMatchObject({
          filesDeleted: ['.claude/skills/prisma-next-queries'],
        });
        expect(existsSync(retired)).toBe(false);
        expect(existsSync(join(installed, 'SKILL.md'))).toBe(true);
      },
      timeouts.coldTransformImport,
    );

    it(
      'calls the removed paths what they are, not stale contract artifacts',
      async () => {
        mkdirSync(join(projectDir, '.agents/skills/prisma-next-runtime'), { recursive: true });

        const run = await harness().run(scaffoldArgv(...SKIP_ALL), {
          cwd: projectDir,
          isTty: { stdout: true },
        });
        const tree = (run.presented?.presentation.human ?? []).find(
          (block) => block.kind === 'tree',
        );

        expect(JSON.stringify(tree)).not.toContain('stale contract artifacts');
        expect(JSON.stringify(tree)).toContain('.agents/skills/prisma-next-runtime');
      },
      timeouts.coldTransformImport,
    );
  });

  describe('a write that fails midway', () => {
    it(
      'names the files it had already written',
      async () => {
        // A directory where a file belongs is the portable way to make one
        // write fail: `writeFileSync` raises EISDIR whatever the permissions.
        mkdirSync(join(projectDir, '.env.example'), { recursive: true });

        const run = await harness().run(scaffoldArgv(...SKIP_ALL), { cwd: projectDir });

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: {
            code: 'CLI.INIT_WRITE_FAILED',
            meta: {
              path: '.env.example',
              filesWritten: [
                'src/prisma/contract.prisma',
                'prisma.config.ts',
                'src/prisma/db.ts',
                'prisma-next.md',
              ],
            },
          },
        });
      },
      timeouts.coldTransformImport,
    );
  });

  describe('the dependencies it asks for', () => {
    it(
      'leaves @types/node alone when the project already pins it',
      async () => {
        writeFileSync(
          join(projectDir, 'package.json'),
          `${JSON.stringify({ name: 'app', devDependencies: { '@types/node': '^18' } }, null, 2)}\n`,
          'utf-8',
        );
        installFakeProjectLocalCli(projectDir);

        const run = await harness().run(scaffoldArgv('--skip-skills'), { cwd: projectDir });

        expect(envelopeOf(run)).toMatchObject({ ok: true });
        expect(run.exitCode).toBe(0);
        expect(calls[1]?.args).toEqual(['add', '-D', '@prisma/cli@next']);
        expect(calls[2]?.args).toEqual(['add', '-D', '@prisma/cli-engine@next']);
      },
      timeouts.coldTransformImport,
    );

    it(
      'warns that a surrounding pnpm catalog decides the versions',
      async () => {
        writeFileSync(join(projectDir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n", 'utf-8');
        writeFileSync(
          join(projectDir, 'pnpm-workspace.yaml'),
          "packages:\n  - '.'\ncatalog:\n  dotenv: 16.4.5\n",
          'utf-8',
        );

        const run = await harness().run(scaffoldArgv('--skip-skills'), { cwd: projectDir });

        expect(run.presented?.data).toMatchObject({
          warnings: expect.arrayContaining([expect.stringContaining('catalog overrides detected')]),
        });
      },
      timeouts.coldTransformImport,
    );
  });

  describe('the optional database probe', () => {
    it(
      'warns when DATABASE_URL is not set',
      async () => {
        const run = await harness().run(scaffoldArgv('--probe-db', ...SKIP_ALL), {
          cwd: projectDir,
        });

        expect(run.exitCode).toBe(0);
        expect(run.presented?.data).toMatchObject({
          warnings: expect.arrayContaining([expect.stringContaining('DATABASE_URL')]),
        });
      },
      timeouts.coldTransformImport,
    );

    it(
      'errors under --strict-probe when the probe cannot run',
      async () => {
        const run = await harness().run(scaffoldArgv('--probe-db', '--strict-probe', ...SKIP_ALL), {
          cwd: projectDir,
        });

        expect(run.exitCode).toBe(2);
        expect(envelopeOf(run)).toMatchObject({
          ok: false,
          error: { code: 'CLI.INIT_PROBE_FAILED' },
        });
      },
      timeouts.coldTransformImport,
    );
  });
});
