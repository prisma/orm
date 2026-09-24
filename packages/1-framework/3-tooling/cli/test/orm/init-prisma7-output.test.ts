import { cpSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { MountedTree, PackageManagerRunner } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { timeouts } from '@repo/test-utils';
import { basename, dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createInitCommand } from '../../src/orm/init';
import { importFromProject } from '../../src/orm/init-prisma7-check';
import { createTestProjectDir, fixtureAppDir } from '../utils/test-project-dir';

const FIXTURE = join(fixtureAppDir, 'fixtures/prisma7-project');
const emit = vi.fn();
const commands: MountedTree = {
  ...BIN_COMMANDS,
  'orm init': createInitCommand({ emitScaffoldedContract: emit, importFromProject }),
};

let projectDir: string;
let installExitCodes: number[];

const runner: PackageManagerRunner = async () => ({
  exitCode: installExitCodes.shift() ?? 0,
  stderr: '',
});

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-prisma7-output');
  installExitCodes = [];
  emit.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function harness() {
  return createTestCli({ commands, groups: BIN_GROUPS, packageManagerRunner: runner });
}

function writeProjectFile(relative: string, content: string): void {
  mkdirSync(join(projectDir, dirname(relative)), { recursive: true });
  writeFileSync(join(projectDir, relative), content, 'utf-8');
}

function copyFixture(): void {
  cpSync(FIXTURE, projectDir, { recursive: true });
  renameSync(join(projectDir, 'package.json.fixture'), join(projectDir, 'package.json'));
  writeProjectFile(
    'node_modules/prisma/package.json',
    JSON.stringify({ name: 'prisma', version: '7.4.1', exports: { './config': './config.js' } }),
  );
  writeProjectFile('node_modules/prisma/config.js', 'export const defineConfig = (c) => c;\n');
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

function nextSteps(run: { readonly presented: { readonly data: unknown } | undefined }): string[] {
  const steps = Reflect.get(Object(run.presented?.data), 'nextSteps');
  return Array.isArray(steps) ? steps : [];
}

const DATABASE_ACTIONS_INIT_NEVER_RUNS =
  /\bdb (init|update|migrate)\b|init (connected|signed|verified)/;

describe('the Prisma 7 result document', () => {
  it(
    'describes the whole run',
    async () => {
      copyFixture();

      const run = await harness().run(prisma7Argv('--skip-install'), { cwd: projectDir });

      expect(run.exitCode).toBe(0);
      expect(run.presented?.presentation.json).toEqual({
        ok: true,
        target: 'postgres',
        authoring: 'prisma7',
        schemaPath: 'prisma/schema.prisma',
        filesWritten: [
          'prisma.config.ts',
          'src/prisma/db.ts',
          'prisma-8.md',
          '.env.example',
          'tsconfig.json',
          '.gitignore',
          '.gitattributes',
          'package.json',
        ],
        filesDeleted: [],
        filesRenamed: [{ from: 'prisma.config.ts', to: 'prisma7.config.ts' }],
        packagesInstalled: { status: 'skipped', deps: [], devDeps: [] },
        contractEmitted: false,
        prisma7: {
          schemaPath: 'prisma/schema.prisma',
          configRenamedTo: 'prisma7.config.ts',
          scriptsRewritten: ['generate', 'migrate', 'studio'],
          packagesMoved: ['@prisma/prisma7@7'],
        },
        nextSteps: [
          '1. Set DATABASE_URL in your environment (export it or add it to .env).',
          '2. Install the project dependencies with your package manager (this run skipped them), including @prisma/prisma7@7.',
          '3. Emit the contract: `prisma contract emit`',
          '4. Adopt your existing database: `prisma db sign` verifies it against the contract and records the signing marker and the `db` ref. It makes no change to the database schema.',
          '5. Move your routes one at a time to the Prisma 8 client in src/prisma/db.ts.',
          '6. After each `prisma7 migrate dev`, run `prisma contract emit` and then `prisma db sign`.',
          '7. Open prisma-8.md for a quick reference on the transition loop and your first typed query.',
          '8. Working with a coding agent? Run `prisma init` in this project to set up the Prisma agent skills.',
        ],
        warnings: [],
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'reports the moved packages and a prisma7 generate step when the client moved and the install ran',
    async () => {
      copyFixture();
      writeProjectFile(
        'package.json',
        `${JSON.stringify({
          name: 'app',
          scripts: { migrate: 'prisma migrate dev' },
          dependencies: { '@prisma/client': '^6.0.0' },
          devDependencies: { prisma: '^7.4.0' },
        })}\n`,
      );

      const run = await harness().run(prisma7Argv(), { cwd: projectDir });

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({
        packagesInstalled: {
          status: 'installed',
          deps: ['@prisma/orm-postgres', 'dotenv', '@prisma/client@7'],
          devDeps: [
            'prisma@latest',
            '@types/node',
            '@prisma/prisma7@7',
            '@prisma/cli-engine@latest',
          ],
        },
        contractEmitted: true,
        prisma7: {
          scriptsRewritten: ['migrate'],
          packagesMoved: ['@prisma/client@7', '@prisma/prisma7@7'],
        },
      });
      expect(nextSteps(run)).toEqual([
        '1. Set DATABASE_URL in your environment (export it or add it to .env).',
        '2. Adopt your existing database: `prisma db sign` verifies it against the contract and records the signing marker and the `db` ref. It makes no change to the database schema.',
        '3. Move your routes one at a time to the Prisma 8 client in src/prisma/db.ts.',
        '4. After each `prisma7 migrate dev`, run `prisma contract emit` and then `prisma db sign`.',
        '5. Run `prisma7 generate` so the Prisma 7 client matches the Prisma 7 CLI.',
        '6. Open prisma-8.md for a quick reference on the transition loop and your first typed query.',
        '7. Working with a coding agent? Run `prisma init` in this project to set up the Prisma agent skills.',
      ]);
      expect(run.presented?.presentation.next).toEqual([
        expect.objectContaining({
          kind: 'user-choice',
          label: expect.stringContaining('DATABASE_URL'),
        }),
        expect.objectContaining({ kind: 'run-command', command: 'prisma db sign' }),
        expect.objectContaining({
          kind: 'edit-file',
          label: expect.stringContaining('src/prisma/db.ts'),
        }),
        expect.objectContaining({
          kind: 'user-choice',
          label: expect.stringContaining('prisma7 migrate dev'),
        }),
        expect.objectContaining({ kind: 'run-command', command: 'prisma7 generate' }),
        expect.objectContaining({
          kind: 'user-choice',
          label: expect.stringContaining('prisma-8.md'),
        }),
        expect.objectContaining({ kind: 'run-command', command: 'prisma init' }),
      ]);
    },
    timeouts.coldTransformImport,
  );

  it(
    'puts a failed install first and the emit after it when the check had passed',
    async () => {
      copyFixture();
      installExitCodes = [0, 1];

      const run = await harness().run(prisma7Argv(), { cwd: projectDir });

      expect(run.exitCode).toBe(4);
      const steps = nextSteps(run);
      expect(steps[0]).toContain('DATABASE_URL');
      expect(steps[1]).toMatch(/install this run attempted failed.*@prisma\/prisma7@7/);
      expect(steps[2]).toBe('3. Emit the contract: `prisma contract emit`');
      expect(steps[3]).toContain('prisma db sign');
      expect(run.presented?.data).toMatchObject({
        packagesInstalled: {
          status: 'failed',
          deps: ['@prisma/orm-postgres', 'dotenv'],
          devDeps: [],
        },
      });
    },
    timeouts.coldTransformImport,
  );

  it(
    'writes nothing when the install before the check fails',
    async () => {
      copyFixture();
      installExitCodes = [1];

      const run = await harness().run(prisma7Argv(), { cwd: projectDir });

      expect(run.exitCode).toBe(4);
      expect(run.presented?.data).toMatchObject({
        filesWritten: [],
        filesRenamed: [],
        packagesInstalled: { status: 'failed', deps: [], devDeps: [] },
        nextSteps: [
          '1. Install the project dependencies with your package manager. The install this run attempted failed before anything was written.',
          '2. Run `prisma orm init` again.',
        ],
      });
      expect(run.presented?.diagnostics).toEqual([
        expect.objectContaining({
          code: 'CLI.INIT_INSTALL_FAILED',
          meta: expect.objectContaining({ filesWritten: [] }),
        }),
      ]);
      expect(existsSync(join(projectDir, 'prisma7.config.ts'))).toBe(false);
      expect(existsSync(join(projectDir, 'src/prisma'))).toBe(false);
    },
    timeouts.coldTransformImport,
  );

  it(
    'never claims init did anything to the database',
    async () => {
      copyFixture();

      const run = await harness().run(prisma7Argv('--skip-install'), { cwd: projectDir });

      for (const step of nextSteps(run)) {
        expect(step).not.toMatch(DATABASE_ACTIONS_INIT_NEVER_RUNS);
      }
      for (const action of run.presented?.presentation.next ?? []) {
        expect(action.label).not.toMatch(DATABASE_ACTIONS_INIT_NEVER_RUNS);
      }
    },
    timeouts.coldTransformImport,
  );

  it(
    'shows the schema, the rename, and the moved packages in the human output',
    async () => {
      copyFixture();
      writeProjectFile(
        'package.json',
        `${JSON.stringify({ name: 'app', dependencies: { '@prisma/client': '^6.0.0' }, devDependencies: { prisma: '^7.4.0' } })}\n`,
      );

      const run = await harness().run(prisma7Argv(), { cwd: projectDir, isTty: { stdout: true } });
      const blocks = run.presented?.presentation.human ?? [];

      expect(blocks[0]).toMatchObject({
        kind: 'fields',
        rows: [
          { label: 'target', value: 'postgres' },
          { label: 'authoring', value: 'prisma7' },
          { label: 'schema', value: 'prisma/schema.prisma' },
        ],
      });
      const tree = blocks.find((block) => block.kind === 'tree');
      const roots = Reflect.get(Object(tree), 'roots') as readonly {
        label: string;
        children?: readonly { label: string }[];
      }[];
      expect(roots.map((root) => root.label)).toEqual(['written', 'renamed', 'installed']);
      expect(roots[1]?.children).toEqual([
        { label: 'prisma.config.ts → prisma7.config.ts', tone: 'identifier' },
      ]);
      expect(roots[2]?.children).toEqual(
        expect.arrayContaining([
          { label: '@prisma/client@7 (Prisma 7)', tone: 'identifier' },
          { label: '@prisma/prisma7@7 (dev, Prisma 7)', tone: 'identifier' },
        ]),
      );
    },
    timeouts.coldTransformImport,
  );
});
