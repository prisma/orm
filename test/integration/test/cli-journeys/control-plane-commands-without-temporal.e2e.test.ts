/**
 * The built bin and a scaffolded `migration.ts`, each run as a child process that has no
 * `Temporal`, read, check and render date and time column defaults, and leave the process without
 * a global `Temporal`.
 *
 * The other journeys run commands in this process, where the vitest setup file has installed a
 * `Temporal` polyfill. Only a child process shows what the control plane does on its own.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { withClient } from '@repo/test-utils';
import { join, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  getLatestMigrationDir,
  type JourneyContext,
  runContractEmit,
  runMigrationPlan,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';
import {
  type ChildRun,
  childOutput,
  NO_GLOBAL_TEMPORAL,
  runNodeWithoutTemporal,
} from '../utils/without-temporal';

const BIN_PATH = resolve(
  import.meta.dirname,
  '../../../../packages/1-framework/3-tooling/cli/dist/bin.mjs',
);

const EMIT_SCHEMA = `// use prisma-8

model Event {
  id        Int      @id
  createdAt DateTime @default("2024-01-01T00:00:00Z")
}
`;

const DEFAULTS_SCHEMA = `// use prisma-8

model Event {
  id        Int            @id
  localAt   Timestamp(3)   @default("2024-01-01 00:00:00")
  instantAt Timestamptz    @default("2024-01-01T00:00:00Z")
  history   Timestamp(3)[] @default(["2024-01-01 00:00:00", "2024-06-30 12:34:56.789"])

  @@map("event")
}
`;

const INFER_SQL = `
CREATE TABLE "event" (
    "id" INTEGER NOT NULL,
    "localAt" TIMESTAMP(3) NOT NULL DEFAULT '2024-01-01 00:00:00',

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);
`;

function runBin(ctx: JourneyContext, argv: readonly string[]): Promise<ChildRun> {
  return runNodeWithoutTemporal([BIN_PATH, ...argv], { cwd: ctx.testDir });
}

function writeSchema(ctx: JourneyContext, schema: string): void {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), schema, 'utf-8');
}

async function emitInThisProcess(ctx: JourneyContext, schema: string): Promise<void> {
  writeSchema(ctx, schema);
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `contract emit\n${emit.stderr}\n${emit.stdout}`).toBe(0);
}

interface EmittedColumn {
  readonly default?: unknown;
}

interface EmittedContract {
  readonly storage: {
    readonly namespaces: {
      readonly public: {
        readonly entries: {
          readonly table: Record<string, { readonly columns: Record<string, EmittedColumn> }>;
        };
      };
    };
  };
}

function emittedColumns(ctx: JourneyContext): Record<string, EmittedColumn> {
  const contractJson: EmittedContract = JSON.parse(
    readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8'),
  );
  const tables = Object.values(contractJson.storage.namespaces.public.entries.table);
  const [table, ...rest] = tables;
  if (table === undefined || rest.length > 0) {
    throw new Error(`expected one table, got ${tables.length}`);
  }
  return table.columns;
}

withTempDir(({ createTempDir }) => {
  describe('Journey: the control plane in a process with no Temporal', () => {
    describe('contract emit', () => {
      it('the child process has no Temporal before or after a program that uses none', async () => {
        const run = await runNodeWithoutTemporal(['-e', ''], { cwd: createTempDir() });

        expect(run).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
      });

      it(
        'stores a DateTime default written in PSL',
        async () => {
          const ctx = setupJourney({ createTempDir, contractMode: 'psl', connectionString: 'x' });
          writeSchema(ctx, EMIT_SCHEMA);

          const emit = await runBin(ctx, ['contract', 'emit']);

          expect(emit, childOutput(emit)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
          expect(emittedColumns(ctx)['createdAt']?.default).toEqual({
            kind: 'literal',
            value: '2024-01-01T00:00:00Z',
          });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('db init', () => {
      const db = useDevDatabase();

      it(
        'creates timestamp, timestamptz and timestamp list defaults',
        async () => {
          const ctx = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
            contractMode: 'psl',
          });
          await emitInThisProcess(ctx, DEFAULTS_SCHEMA);

          const init = await runBin(ctx, ['db', 'init']);

          expect(init, childOutput(init)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
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

    describe('node migration.ts', () => {
      const db = useDevDatabase();

      it(
        'writes the operations of a migration that creates date and time defaults',
        async () => {
          const ctx = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
            contractMode: 'psl',
          });
          await emitInThisProcess(ctx, DEFAULTS_SCHEMA);
          const plan = await runMigrationPlan(ctx, ['--name', 'events']);
          expect(plan.exitCode, `migration plan\n${plan.stderr}\n${plan.stdout}`).toBe(0);
          const migrationDir = join(
            ctx.testDir,
            'migrations/app',
            getLatestMigrationDir(ctx) ?? '',
          );
          const opsPath = join(migrationDir, 'ops.json');
          rmSync(opsPath, { force: true });

          const run = await runNodeWithoutTemporal([join(migrationDir, 'migration.ts')], {
            cwd: ctx.testDir,
          });

          expect(run, childOutput(run)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
          const ops = readFileSync(opsPath, 'utf-8');
          expect({
            localAt: ops.includes(`DEFAULT '2024-01-01T00:00:00'`),
            instantAt: ops.includes(`DEFAULT '2024-01-01T00:00:00Z'`),
          }).toEqual({ localAt: true, instantAt: true });
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('contract infer', () => {
      const db = useDevDatabase({
        onReady: (cs) => withClient(cs, (client) => client.query(INFER_SQL)),
      });

      it(
        'prints a timestamp default as a literal',
        async () => {
          const ctx = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
            contractMode: 'psl',
          });

          const infer = await runBin(ctx, ['contract', 'infer']);

          expect(infer, childOutput(infer)).toMatchObject({ exitCode: 0, ...NO_GLOBAL_TEMPORAL });
          const field = readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8')
            .split('\n')
            .find((line) => line.trim().startsWith('localAt'));
          expect(field?.trim().split(/\s+/)).toEqual([
            'localAt',
            'Timestamp(3)',
            '@default("2024-01-01',
            '00:00:00")',
          ]);
        },
        timeouts.spinUpPpgDev,
      );
    });
  });
});
