/**
 * Journey: a contract.json an earlier version emitted, or one edited by hand, holds a default this
 * version's codecs refuse, on a table the database already has. Whichever way the planner writes
 * the default — a new column, a changed default, or on SQLite a rebuilt table — `db update` and
 * `migration plan` stop with the same contract error, naming the table and the column.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type EngineCommandResult,
  engineError,
  type JourneyContext,
  runContractEmit,
  runDbInit,
  runDbUpdate,
  runMigrationPlan,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const CANONICAL_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const TEXT_MARKER = 'stale-default-marker';

const SQLITE_CONFIG_TEMPLATE = join(
  __dirname,
  '../fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/prisma.config.sqlite.psl.ts',
);

function sqliteConfig(databasePath: string): string {
  return readFileSync(SQLITE_CONFIG_TEMPLATE, 'utf-8').replace('{{DB_PATH}}', () => databasePath);
}

interface Scenario {
  readonly name: string;
  readonly target: 'postgres' | 'sqlite';
  readonly before: string;
  /** The schema the database moves to, whose default is `marker`, which is then made stale. */
  readonly after: string;
  readonly marker: string;
  /** The JSON text that replaces the marker's string in contract.json. */
  readonly stale: string;
  readonly table: string;
  readonly column: string;
  readonly codecId: string;
  readonly value: unknown;
  readonly codecMessage: string;
}

const UPPER_CASE_UUID = 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11';
const UUID_MESSAGE =
  'pg/uuid@1 JSON value must be a UUID as PostgreSQL writes it, in lower case and hyphenated 8-4-4-4-12';

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'a column added to an existing Postgres table',
    target: 'postgres',
    before: 'model Token {\n  id Int @id\n}\n',
    after: `model Token {\n  id    Int  @id\n  added Uuid @default("${CANONICAL_UUID}")\n}\n`,
    marker: CANONICAL_UUID,
    stale: JSON.stringify(UPPER_CASE_UUID),
    table: 'Token',
    column: 'added',
    codecId: 'pg/uuid@1',
    value: UPPER_CASE_UUID,
    codecMessage: UUID_MESSAGE,
  },
  {
    name: 'a changed default on an existing Postgres column',
    target: 'postgres',
    before:
      'model Token {\n  id      Int  @id\n  changed Uuid @default("11111111-1111-1111-1111-111111111111")\n}\n',
    after: `model Token {\n  id      Int  @id\n  changed Uuid @default("${CANONICAL_UUID}")\n}\n`,
    marker: CANONICAL_UUID,
    stale: JSON.stringify(UPPER_CASE_UUID),
    table: 'Token',
    column: 'changed',
    codecId: 'pg/uuid@1',
    value: UPPER_CASE_UUID,
    codecMessage: UUID_MESSAGE,
  },
  {
    name: 'a column added to an existing SQLite table',
    target: 'sqlite',
    before: 'model Note {\n  id Int @id\n}\n',
    after: `model Note {\n  id   Int    @id\n  body String @default("${TEXT_MARKER}")\n}\n`,
    marker: TEXT_MARKER,
    stale: '1',
    table: 'Note',
    column: 'body',
    codecId: 'sqlite/text@1',
    value: 1,
    codecMessage: 'sqlite/text@1 JSON value must be a string',
  },
  {
    name: 'a SQLite table rebuilt for a changed default',
    target: 'sqlite',
    before: 'model Note {\n  id   Int    @id\n  body String @default("before")\n}\n',
    after: `model Note {\n  id   Int    @id\n  body String @default("${TEXT_MARKER}")\n}\n`,
    marker: TEXT_MARKER,
    stale: '1',
    table: 'Note',
    column: 'body',
    codecId: 'sqlite/text@1',
    value: 1,
    codecMessage: 'sqlite/text@1 JSON value must be a string',
  },
];

const json = { isTTY: false };

function writeSchema(ctx: JourneyContext, schema: string): void {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), `// use prisma-8\n\n${schema}`, 'utf-8');
}

async function emit(ctx: JourneyContext): Promise<void> {
  const run = await runContractEmit(ctx);
  expect(run.exitCode, stripAnsi(run.stderr)).toBe(0);
}

function reported(run: EngineCommandResult) {
  const error = engineError(run);
  return {
    exitCode: run.exitCode,
    error:
      error === undefined
        ? stripAnsi(run.stderr)
        : {
            code: error.code,
            summary: error.summary,
            why: error.why,
            nextActions: error.nextActions,
            meta: error.meta,
          },
  };
}

withTempDir(({ createTempDir }) => {
  for (const scenario of SCENARIOS) {
    describe(`Journey: a stale contract default on ${scenario.name}`, () => {
      const db = useDevDatabase();

      it(
        'stops db update and migration plan with the contract error naming the column',
        async () => {
          const ctx = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
            contractMode: 'psl',
          });
          if (scenario.target === 'sqlite') {
            writeFileSync(ctx.configPath, sqliteConfig(join(ctx.testDir, 'test.db')), 'utf-8');
          }

          writeSchema(ctx, scenario.before);
          await emit(ctx);
          for (const run of [await runDbInit(ctx), await runMigrationPlan(ctx)]) {
            expect(run.exitCode, stripAnsi(run.stderr)).toBe(0);
          }

          writeSchema(ctx, scenario.after);
          await emit(ctx);
          const contractJsonPath = join(ctx.testDir, 'contract.json');
          const emitted = readFileSync(contractJsonPath, 'utf-8');
          expect(emitted.split(`"${scenario.marker}"`)).toHaveLength(2);
          writeFileSync(
            contractJsonPath,
            emitted.replace(`"${scenario.marker}"`, scenario.stale),
            'utf-8',
          );

          const expected = {
            exitCode: 2,
            error: {
              code: 'CONTRACT.DEFAULT_INVALID',
              summary: `Column "${scenario.table}"."${scenario.column}" has a default its codec ${scenario.codecId} refuses: ${scenario.codecMessage}`,
              why: "A contract.json that an earlier version emitted, or a migration.ts it planned, can hold a default that this version's codec refuses, and so can either file after a hand edit.",
              nextActions: [
                {
                  kind: 'user-choice',
                  label:
                    'If contract.json holds the default, emit the contract again with this version, and correct the default in the contract source if emit refuses it. If a migration.ts sets it, correct it in that file.',
                },
              ],
              meta: {
                table: scenario.table,
                column: scenario.column,
                codecId: scenario.codecId,
                value: scenario.value,
                reason: 'codec-refused-default',
              },
            },
          };
          expect({
            update: reported(await runDbUpdate(ctx, ['--dry-run'], json)),
            plan: reported(await runMigrationPlan(ctx, [], json)),
          }).toEqual({ update: expected, plan: expected });
        },
        timeouts.spinUpPpgDev,
      );
    });
  }
});
