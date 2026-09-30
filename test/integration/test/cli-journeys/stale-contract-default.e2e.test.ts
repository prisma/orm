/**
 * Journey: a contract.json an earlier version emitted can hold a literal default this version's
 * codec refuses, such as a uuid default in upper case. The commands that render DDL from it report
 * a contract error naming the column and the fix, where they used to crash as an unexpected error.
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

const refusal = {
  code: 'CONTRACT.DEFAULT_INVALID',
  summary: `Column "Token"."value" has a default its codec pg/uuid@1 refuses: pg/uuid@1 JSON value must be a UUID as PostgreSQL writes it, in lower case and hyphenated 8-4-4-4-12`,
  why: "A contract emitted by an earlier version, or edited by hand, can hold a default that this version's codec refuses.",
  meta: {
    table: 'Token',
    column: 'value',
    codecId: 'pg/uuid@1',
    value: UPPER_CASE,
    reason: 'codec-refused-default',
  },
};

withTempDir(({ createTempDir }) => {
  describe('Journey: a contract default the codec now refuses', () => {
    const db = useDevDatabase();

    it(
      'is reported as a contract error by db init, db update and migration plan',
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

        const json = { isTTY: false };
        const runs = {
          init: await runDbInit(ctx, ['--dry-run'], json),
          update: await runDbUpdate(ctx, ['--dry-run'], json),
          plan: await runMigrationPlan(ctx, [], json),
        };

        const reported = Object.fromEntries(
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
        const expected = {
          exitCode: 2,
          error: {
            ...refusal,
            nextActions: [
              {
                kind: 'user-choice',
                label:
                  'Emit the contract again with this version. If emit refuses the default, correct it in the schema.',
              },
            ],
          },
        };
        expect(reported).toEqual({ init: expected, update: expected, plan: expected });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
