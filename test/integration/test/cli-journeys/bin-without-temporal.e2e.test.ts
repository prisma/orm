/**
 * The built bin, run as a child process on a runtime with no global `Temporal`, reads, checks and
 * renders date and time column defaults.
 *
 * The other journeys run commands in this process, where the vitest setup file has already
 * installed a `Temporal` polyfill. Only a child process shows what the bin does on its own.
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { withClient } from '@repo/test-utils';
import { join, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const execFileAsync = promisify(execFile);

const CLI_DIST = resolve(
  import.meta.dirname,
  '../../../../packages/1-framework/3-tooling/cli/dist',
);
const BIN_PATH = join(CLI_DIST, 'bin.mjs');
const COMMAND_FAMILY_PATH = join(CLI_DIST, 'exports/index.mjs');

/** Turns a native `Temporal` off, so the child has none on any Node version. */
const NODE_FLAGS = ['--no-harmony-temporal'] as const;

const EMIT_SCHEMA = `// use prisma-8

model Event {
  id        Int      @id
  createdAt DateTime @default("2024-01-01T00:00:00Z")
}
`;

const DB_INIT_SCHEMA = `// use prisma-8

model Event {
  id        Int            @id
  localAt   Timestamp(3)   @default("2024-01-01 00:00:00")
  instantAt Timestamptz    @default("2024-01-01T00:00:00Z")
  history   Timestamp(3)[] @default(["2024-01-01 00:00:00", "2024-06-30 12:34:56.789"])

  @@map("event")
}
`;

interface SpawnedRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function childEnv(): NodeJS.ProcessEnv {
  const { NODE_OPTIONS: _nodeOptions, ...env } = process.env;
  return { ...env, NO_COLOR: '1', CI: 'true' };
}

async function spawnNode(args: readonly string[], cwd: string): Promise<SpawnedRun> {
  try {
    const { stdout, stderr } = await execFileAsync('node', [...NODE_FLAGS, ...args], {
      cwd,
      env: childEnv(),
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    if (typeof failed.code !== 'number') {
      throw error;
    }
    return { exitCode: failed.code, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

function spawnBin(ctx: JourneyContext, argv: readonly string[]): Promise<SpawnedRun> {
  return spawnNode([BIN_PATH, ...argv], ctx.testDir);
}

function output(run: SpawnedRun): string {
  return `${run.stderr}\n${run.stdout}`;
}

function writeSchema(ctx: JourneyContext, schema: string): void {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), schema, 'utf-8');
}

interface EmittedColumn {
  readonly default?: { readonly kind: string; readonly value?: unknown };
}

function emittedColumns(ctx: JourneyContext): Record<string, EmittedColumn> {
  const contractJson = JSON.parse(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8')) as {
    storage: {
      namespaces: {
        public: {
          entries: { table: Record<string, { columns: Record<string, EmittedColumn> }> };
        };
      };
    };
  };
  const tables = Object.values(contractJson.storage.namespaces.public.entries.table);
  const [table, ...rest] = tables;
  if (table === undefined || rest.length > 0) {
    throw new Error(`expected one table, got ${tables.length}`);
  }
  return table.columns;
}

withTempDir(({ createTempDir }) => {
  describe('Journey: the built bin on a runtime with no global Temporal', () => {
    const db = useDevDatabase();

    it('the child process has no global Temporal before the bin runs', async () => {
      const run = await spawnNode(
        ['-e', 'process.stdout.write(typeof globalThis.Temporal)'],
        createTempDir(),
      );

      expect(run).toMatchObject({ exitCode: 0, stdout: 'undefined' });
    });

    it('a host that imports the command family, as the unified prisma CLI does, gets a Temporal', async () => {
      const run = await spawnNode(
        [
          '--input-type=module',
          '-e',
          `await import(${JSON.stringify(pathToFileURL(COMMAND_FAMILY_PATH).href)});
           process.stdout.write(typeof globalThis.Temporal);`,
        ],
        createTempDir(),
      );

      expect(run, output(run)).toMatchObject({ exitCode: 0, stdout: 'object' });
    });

    it(
      'contract emit stores a DateTime default written in PSL',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeSchema(ctx, EMIT_SCHEMA);

        const emit = await spawnBin(ctx, ['contract', 'emit']);

        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
        expect(emittedColumns(ctx)['createdAt']).toMatchObject({
          default: { kind: 'literal', value: '2024-01-01T00:00:00Z' },
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'db init creates timestamp, timestamptz and timestamp list defaults',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeSchema(ctx, DB_INIT_SCHEMA);

        const emit = await spawnBin(ctx, ['contract', 'emit']);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);

        const init = await spawnBin(ctx, ['db', 'init']);
        expect(init.exitCode, `db init\n${output(init)}`).toBe(0);

        const defaults = await withClient(db.connectionString, async (client) => {
          await client.query('INSERT INTO "event" ("id") VALUES (1)');
          const result = await client.query<Record<string, string>>(
            `SELECT "localAt"::text AS "localAt",
                    ("instantAt" AT TIME ZONE 'UTC')::text AS "instantAt",
                    "history"::text AS "history"
             FROM "event"`,
          );
          return result.rows;
        });
        expect(defaults).toEqual([
          {
            localAt: '2024-01-01 00:00:00',
            instantAt: '2024-01-01 00:00:00',
            history: '{"2024-01-01 00:00:00","2024-06-30 12:34:56.789"}',
          },
        ]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
