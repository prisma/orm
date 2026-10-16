/**
 * Journey: a contract.json an earlier version emitted, or one edited by hand, can hold what this
 * version refuses: a literal default its data type refuses, such as a uuid in upper case, which
 * the commands refuse when they load the contract, naming the column; or type parameters its data
 * type refuses, which the commands that render DDL report with the library's own error, not an
 * unexpected failure of the command.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  engineError,
  runContractEmit,
  runDbInit,
  runDbUpdate,
  runMigrationCheck,
  runMigrationPlan,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const CANONICAL = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
const UPPER_CASE = 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11';

const SCHEMA = `// use prisma-8

model Token {
  id    Int  @id
  value Uuid @default("${CANONICAL}")
}
`;

const UUID_MESSAGE =
  'pg/uuid JSON value must be "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", as pg/uuid stores this value';

const refusal = {
  code: 'CONTRACT.VALIDATION_FAILED',
  summary: 'Contract validation failed',
  why: expect.stringContaining(
    `failed to deserialize: Namespace "public", table "Token", column "value": the default "${UPPER_CASE}" is not a value of pg/uuid: ${UUID_MESSAGE}`,
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
        namespaceId: 'public',
        table: 'Token',
        column: 'value',
        dataType: 'pg/uuid',
        value: UPPER_CASE,
        message: UUID_MESSAGE,
        reason: 'type-refused-default',
      },
    ],
  },
};

const LENGTH_SCHEMA = `// use prisma-8

model Label {
  id   Int         @id
  name VarChar(10) @default("abc")
}
`;

async function reportedByDdlCommands(ctx: ReturnType<typeof setupJourney>) {
  const json = { isTTY: false };
  const runs = {
    init: await runDbInit(ctx, ['--dry-run'], json),
    update: await runDbUpdate(ctx, ['--dry-run'], json),
    plan: await runMigrationPlan(ctx, [], json),
  };
  return Object.fromEntries(
    Object.entries(runs).map(([name, run]) => {
      const error = engineError(run);
      return [
        name,
        {
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
        },
      ];
    }),
  );
}

withTempDir(({ createTempDir }) => {
  describe('Journey: a contract default the codec now refuses', () => {
    const db = useDevDatabase();

    it(
      'is refused when db init, db update and migration plan load the contract, naming the column',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeFileSync(join(ctx.testDir, 'contract.prisma'), SCHEMA, 'utf-8');
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, stripAnsi(emit.stderr)).toBe(0);

        const contractJsonPath = join(ctx.testDir, 'contract.json');
        const emitted = readFileSync(contractJsonPath, 'utf-8');
        expect(emitted.split(CANONICAL)).toHaveLength(2);
        writeFileSync(contractJsonPath, emitted.replace(CANONICAL, UPPER_CASE), 'utf-8');

        const reported = await reportedByDdlCommands(ctx);
        const expected = { exitCode: 2, error: refusal };
        expect(reported).toEqual({ init: expected, update: expected, plan: expected });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'reports type parameters the data type refuses as a contract error, not an unexpected one',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeFileSync(join(ctx.testDir, 'contract.prisma'), LENGTH_SCHEMA, 'utf-8');
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, stripAnsi(emit.stderr)).toBe(0);

        const contractJsonPath = join(ctx.testDir, 'contract.json');
        const emitted = readFileSync(contractJsonPath, 'utf-8');
        const lengthParams = /"typeParams": \{\s*"length": 10\s*\}/g;
        expect(emitted.match(lengthParams)).toHaveLength(2);
        writeFileSync(
          contractJsonPath,
          emitted.replace(lengthParams, '"typeParams": { "length": 0 }'),
          'utf-8',
        );

        const reported = await reportedByDdlCommands(ctx);

        const expected = {
          exitCode: 2,
          error: {
            code: 'CONTRACT.TYPE_PARAMS_INVALID',
            summary: 'pg/varchar: length must be at least 1 (was 0)',
            why: undefined,
            nextActions: [],
            meta: { dataType: 'pg/varchar', parameters: ['length'] },
          },
        };
        expect(reported).toEqual({ init: expected, update: expected, plan: expected });
      },
      timeouts.spinUpPpgDev,
    );
  });
  describe('Journey: migration check on a contract whose default its type now refuses', () => {
    const db = useDevDatabase();

    it(
      'reports the contract it cannot load, naming the column, instead of passing',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeFileSync(join(ctx.testDir, 'contract.prisma'), SCHEMA, 'utf-8');
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, stripAnsi(emit.stderr)).toBe(0);
        const plan = await runMigrationPlan(ctx, ['--name', 'initial']);
        expect(plan.exitCode, stripAnsi(plan.stderr)).toBe(0);

        const contractJsonPath = join(ctx.testDir, 'contract.json');
        const emitted = readFileSync(contractJsonPath, 'utf-8');
        writeFileSync(contractJsonPath, emitted.replace(CANONICAL, UPPER_CASE), 'utf-8');

        const check = await runMigrationCheck(ctx, [], { isTTY: false });
        const error = engineError(check);
        expect({ exitCode: check.exitCode, code: error?.code, meta: error?.meta }).toEqual({
          exitCode: 2,
          code: 'CONTRACT.VALIDATION_FAILED',
          meta: refusal.meta,
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
