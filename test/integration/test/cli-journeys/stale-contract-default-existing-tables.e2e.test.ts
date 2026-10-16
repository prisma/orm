/**
 * Journey: a contract.json an earlier version emitted, or one edited by hand, holds a default this
 * version's codecs refuse, on a table the database already has. Whichever way the planner writes
 * the default — a new column, a changed default, or on SQLite a rebuilt table — `db update` and
 * `migration plan` stop with the same error when they load the contract, naming the table and the column.
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

const STORED_UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
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
  /** The storage namespace the table is in, which the refusal names on Postgres. */
  readonly namespace: string;
  readonly table: string;
  readonly column: string;
  readonly dataType: string;
  readonly value: unknown;
  readonly typeMessage: string;
}

const UPPER_CASE_UUID = 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11';
const UUID_MESSAGE =
  'pg/uuid JSON value must be "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", as pg/uuid stores this value';

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'a column added to an existing Postgres table',
    target: 'postgres',
    before: 'model Token {\n  id Int @id\n}\n',
    after: `model Token {\n  id    Int  @id\n  added Uuid @default("${STORED_UUID}")\n}\n`,
    marker: STORED_UUID,
    stale: JSON.stringify(UPPER_CASE_UUID),
    namespace: 'public',
    table: 'Token',
    column: 'added',
    dataType: 'pg/uuid',
    value: UPPER_CASE_UUID,
    typeMessage: UUID_MESSAGE,
  },
  {
    name: 'a changed default on an existing Postgres column',
    target: 'postgres',
    before:
      'model Token {\n  id      Int  @id\n  changed Uuid @default("11111111-1111-1111-1111-111111111111")\n}\n',
    after: `model Token {\n  id      Int  @id\n  changed Uuid @default("${STORED_UUID}")\n}\n`,
    marker: STORED_UUID,
    stale: JSON.stringify(UPPER_CASE_UUID),
    namespace: 'public',
    table: 'Token',
    column: 'changed',
    dataType: 'pg/uuid',
    value: UPPER_CASE_UUID,
    typeMessage: UUID_MESSAGE,
  },
  {
    name: 'a column added to an existing SQLite table',
    target: 'sqlite',
    before: 'model Note {\n  id Int @id\n}\n',
    after: `model Note {\n  id   Int    @id\n  body String @default("${TEXT_MARKER}")\n}\n`,
    marker: TEXT_MARKER,
    stale: '1',
    namespace: '__unbound__',
    table: 'Note',
    column: 'body',
    dataType: 'sqlite/text',
    value: 1,
    typeMessage: 'sqlite/text JSON value must be a string',
  },
  {
    name: 'a SQLite table rebuilt for a changed default',
    target: 'sqlite',
    before: 'model Note {\n  id   Int    @id\n  body String @default("before")\n}\n',
    after: `model Note {\n  id   Int    @id\n  body String @default("${TEXT_MARKER}")\n}\n`,
    marker: TEXT_MARKER,
    stale: '1',
    namespace: '__unbound__',
    table: 'Note',
    column: 'body',
    dataType: 'sqlite/text',
    value: 1,
    typeMessage: 'sqlite/text JSON value must be a string',
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

          const where =
            scenario.target === 'postgres'
              ? `Namespace "${scenario.namespace}", table "${scenario.table}", column "${scenario.column}"`
              : `Table "${scenario.table}", column "${scenario.column}"`;
          const expected = {
            exitCode: 2,
            error: {
              code: 'CONTRACT.VALIDATION_FAILED',
              summary: 'Contract validation failed',
              why: expect.stringContaining(
                `failed to deserialize: ${where}: the default ${JSON.stringify(scenario.value)} is not a value of ${scenario.dataType}: ${scenario.typeMessage}`,
              ),
              nextActions: expect.arrayContaining([
                expect.objectContaining({
                  kind: 'open-url',
                  url: 'https://github.com/prisma/orm/tree/main/skills/prisma-8/upgrading/app',
                }),
                expect.objectContaining({
                  kind: 'run-command',
                  command: expect.stringContaining('contract emit'),
                }),
              ]),
              meta: {
                refusedDefaults: [
                  {
                    namespaceId: scenario.namespace,
                    table: scenario.table,
                    column: scenario.column,
                    dataType: scenario.dataType,
                    value: scenario.value,
                    message: scenario.typeMessage,
                    reason: 'type-refused-default',
                  },
                ],
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
