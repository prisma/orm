import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { MountedTree, PackageManagerRunner } from '@prisma/cli-engine';
import { createTestCli } from '@prisma/cli-engine/testing';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { basename, dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BIN_COMMANDS, BIN_GROUPS } from '../../src/orm/cli';
import { createInitCommand } from '../../src/orm/init';
import { emitScaffoldedContract } from '../../src/orm/init-emit';
import { importFromProject } from '../../src/orm/init-prisma7-check';
import { createTestProjectDir, fixtureAppDir } from '../utils/test-project-dir';

const FIXTURE = join(fixtureAppDir, 'fixtures/prisma7-project');
const VIEW_FIXTURE = join(fixtureAppDir, 'fixtures/prisma7-project-view');
const CLI_PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CLI_PACKAGE_MANIFEST = join(CLI_PACKAGE_DIR, 'package.json');
const CLI_BIN = join(CLI_PACKAGE_DIR, 'dist/bin.mjs');

/**
 * The real emit, spawning this workspace's built CLI as the "project-local"
 * `prisma` bin; the package-manager runner succeeds without installing
 * anything, so the run reaches the emit with the project as the fixture left it.
 */
const commands: MountedTree = {
  ...BIN_COMMANDS,
  'orm init': createInitCommand({
    emitScaffoldedContract: (ctx) =>
      emitScaffoldedContract(ctx, { resolveFromBaseDir: () => CLI_PACKAGE_MANIFEST }),
    importFromProject,
  }),
};
let projectDir: string;
let installs: (readonly string[])[];

const runner: PackageManagerRunner = async (request) => {
  installs.push([...request.args]);
  return { exitCode: 0, stderr: '' };
};

beforeEach(() => {
  projectDir = createTestProjectDir('orm-init-prisma7-e2e');
  installs = [];
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function harness() {
  return createTestCli({ commands, groups: BIN_GROUPS, packageManagerRunner: runner });
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

function readProjectFile(relative: string): string {
  return readFileSync(join(projectDir, relative), 'utf-8');
}

function copyFixture(fixture = FIXTURE): void {
  cpSync(fixture, projectDir, { recursive: true });
  renameSync(join(projectDir, 'package.json.fixture'), join(projectDir, 'package.json'));
  writeProjectFile(
    'node_modules/prisma/package.json',
    JSON.stringify({ name: 'prisma', version: '7.4.1', exports: { './config': './config.js' } }),
  );
  writeProjectFile('node_modules/prisma/config.js', 'export const defineConfig = (c) => c;\n');
}

interface ChildRun {
  readonly exitCode: number | null;
  readonly envelope: Record<string, unknown> | undefined;
}

/**
 * The next steps init prints are commands the user runs, so they run here the
 * same way: the built CLI as a child process, with `DATABASE_URL` in its
 * environment, settling with a JSON result envelope on stdout.
 */
function runCli(args: readonly string[], connectionString: string): Promise<ChildRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args, '--json'], {
      cwd: projectDir,
      env: { ...process.env, DATABASE_URL: connectionString, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', reject);
    child.on('close', (exitCode) => {
      const result = stdout
        .split('\n')
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return undefined;
          }
        })
        .findLast((event) => event?.['kind'] === 'result');
      const envelope = result?.['envelope'];
      if (envelope === undefined && exitCode !== 0) {
        reject(
          new Error(`\`prisma ${args.join(' ')}\` exited ${exitCode} without a result: ${stderr}`),
        );
        return;
      }
      resolve({
        exitCode,
        envelope:
          typeof envelope === 'object' && envelope !== null
            ? (envelope as Record<string, unknown>)
            : undefined,
      });
    });
  });
}

/** The scaffolded config reads DATABASE_URL from the environment; the harness runs in-process. */
async function withDatabaseUrl<T>(connectionString: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env['DATABASE_URL'];
  process.env['DATABASE_URL'] = connectionString;
  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env['DATABASE_URL'];
    } else {
      process.env['DATABASE_URL'] = previous;
    }
  }
}

describe('init on the Prisma 7 fixture, end to end', () => {
  it(
    'emits the real contract and db sign then succeeds with zero findings',
    async () => {
      await withDevDatabase(async ({ connectionString }) => {
        copyFixture();
        await withClient(connectionString, (client) =>
          client.query(readProjectFile('prisma/migrations/0001_init/migration.sql')),
        );

        const init = await withDatabaseUrl(connectionString, () =>
          harness().run(
            [
              'orm',
              'init',
              '--from-prisma7-schema',
              'prisma/schema.prisma',
              '--confirm',
              basename(projectDir),
            ],
            { cwd: projectDir },
          ),
        );

        expect(envelopeOf(init)).toMatchObject({ ok: true, diagnostics: [] });
        expect(init.exitCode).toBe(0);
        expect(init.presented?.data).toMatchObject({ contractEmitted: true });
        expect(existsSync(join(projectDir, 'src/prisma/contract.d.ts'))).toBe(true);
        const contract = JSON.parse(readProjectFile('src/prisma/contract.json'));
        expect(Object.keys(contract.domain.namespaces.public.models).sort()).toEqual([
          'Post',
          'User',
        ]);
        expect(readdirSync(join(projectDir, 'prisma')).sort()).toEqual([
          'migrations',
          'schema.prisma',
        ]);

        const sign = await runCli(['db', 'sign'], connectionString);

        expect(sign.envelope).toMatchObject({
          ok: true,
          diagnostics: [],
          result: { ok: true, marker: { created: true }, advancedRef: { name: 'db' } },
        });
        expect(sign.exitCode).toBe(0);
        expect(existsSync(join(projectDir, 'migrations/app/refs/db.json'))).toBe(true);

        const verify = await runCli(['db', 'verify'], connectionString);

        expect(verify.envelope).toMatchObject({ ok: true, diagnostics: [] });
        expect(verify.exitCode).toBe(0);
      });
    },
    timeouts.spinUpPpgDev * 2,
  );

  it(
    'refuses a schema with a view before changing the project',
    async () => {
      copyFixture(VIEW_FIXTURE);
      const fixtureFile = (relative: string) => readFileSync(join(VIEW_FIXTURE, relative), 'utf-8');

      const init = await harness().run(
        [
          'orm',
          'init',
          '--from-prisma7-schema',
          'prisma/schema.prisma',
          '--confirm',
          basename(projectDir),
        ],
        { cwd: projectDir },
      );

      expect(init.exitCode).toBe(2);
      expect(envelopeOf(init)).toMatchObject({
        ok: false,
        error: {
          code: 'CLI.INIT_PRISMA7_SCHEMA_REFUSED',
          why: expect.stringContaining(
            'prisma/schema.prisma:26:1 PSL.PRISMA7_VIEW_UNSUPPORTED View "UserInfo" is not supported',
          ),
          meta: {
            diagnostics: [expect.objectContaining({ code: 'PSL.PRISMA7_VIEW_UNSUPPORTED' })],
            packagesAdded: ['@prisma/orm-postgres', 'dotenv'],
          },
        },
      });
      expect(readProjectFile('prisma.config.ts')).toBe(fixtureFile('prisma.config.ts'));
      expect(readProjectFile('package.json')).toBe(fixtureFile('package.json.fixture'));
      expect(existsSync(join(projectDir, 'prisma7.config.ts'))).toBe(false);
      expect(existsSync(join(projectDir, 'src/prisma'))).toBe(false);
      expect(installs).toEqual([['add', '@prisma/orm-postgres', 'dotenv']]);
    },
    timeouts.coldTransformImport,
  );
});
