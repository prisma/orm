/**
 * Journey: a date or time default is stored in its data type's canonical form.
 *
 * A database created from a contract that stored date and time defaults as they were written
 * verifies against the contract emitted from the same schema in canonical form, and the
 * planner finds nothing to change. `contract infer` prints each default back as a literal in the
 * canonical form. A default before year 1 is written as PostgreSQL reads it in both DDL paths.
 */
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { withClient } from '@repo/test-utils';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import { emittedColumns } from '../utils/emitted-columns';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runContractInfer,
  runDbInit,
  runDbSign,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationNew,
  runMigrationPlan,
  setupJourney,
  swapContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

/**
 * `emitted-before/contract.json` was emitted from `contract.prisma` by the emitter as it was before a date
 * or time default had one canonical form, so it holds each default as it was written. Nothing
 * re-emits it.
 */
const BEFORE = join(import.meta.dirname, '../date-time-defaults/_fixture-before-canonical-form');

const STANDARD_DEFAULTS = {
  a: { kind: 'literal', value: '2024-01-01T00:00:00Z' },
  b: { kind: 'literal', value: '2024-01-01T00:00:00Z' },
  c: { kind: 'literal', value: '2024-01-01T00:00:00Z' },
  localAt: { kind: 'literal', value: '2024-01-01T12:34:56.5' },
  day: { kind: 'literal', value: '2024-01-01' },
  clock: { kind: 'literal', value: '12:34:00' },
  zoned: { kind: 'literal', value: '12:34:56+02:00' },
  history: { kind: 'literal', value: ['2024-01-01T00:00:00Z', '2024-06-30T12:34:56Z'] },
};

interface SchemaVerifyResult {
  readonly schema: { readonly issues: readonly unknown[] };
}

function output(result: { stdout: string; stderr: string }): string {
  return `${stripAnsi(result.stderr)}\n${stripAnsi(result.stdout)}`;
}

/** The defaults of the one table in the emitted contract, which a TypeScript project writes under `output/`. */
function defaultsOf(ctx: JourneyContext, emitDir = ctx.testDir): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(emittedColumns(emitDir)).flatMap(([name, column]) =>
      column.default === undefined ? [] : [[name, column.default]],
    ),
  );
}

/** Each field line of the printed schema that declares a default, without its spacing. */
function printedDefaultFields(ctx: JourneyContext): readonly string[] {
  return readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8')
    .split('\n')
    .filter((line) => line.includes('@default('))
    .map((line) => line.trim().split(/\s+/).join(' '));
}

function beforeStorageHash(): string {
  const before: { readonly storage: { readonly storageHash: string } } = JSON.parse(
    readFileSync(join(BEFORE, 'emitted-before/contract.json'), 'utf-8'),
  );
  return before.storage.storageHash;
}

async function schemaIssues(ctx: JourneyContext): Promise<readonly unknown[]> {
  const verify = await runDbVerify(ctx, ['--schema-only', '--strict', '--json']);
  return parseJsonOutput<SchemaVerifyResult>(verify).schema.issues;
}

withTempDir(({ createTempDir }) => {
  describe('Journey: date and time defaults stored before the canonical form', () => {
    const db = useDevDatabase();

    it(
      'a database made from the earlier contract verifies against the re-emitted one, plans no change, and infers the canonical form',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        copyFileSync(
          join(BEFORE, 'emitted-before/contract.json'),
          join(ctx.testDir, 'contract.json'),
        );

        const planBefore = await runMigrationPlan(ctx, ['--name', 'before']);
        expect(planBefore.exitCode, `migration plan\n${output(planBefore)}`).toBe(0);
        const migrateBefore = await runMigrate(ctx);
        expect(migrateBefore.exitCode, `db migrate\n${output(migrateBefore)}`).toBe(0);

        copyFileSync(join(BEFORE, 'contract.prisma'), join(ctx.testDir, 'contract.prisma'));
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
        expect(defaultsOf(ctx)).toEqual(STANDARD_DEFAULTS);

        expect(await schemaIssues(ctx)).toEqual([]);

        const from = ['--from', beforeStorageHash()];
        const plan = await runMigrationPlan(ctx, ['--name', 'canonical-form', ...from, '--json']);
        expect(parseJsonOutput(plan)).toMatchObject({
          code: 'MIGRATION.PLANNING_FAILED',
          meta: {
            conflicts: [
              expect.objectContaining({
                summary: expect.stringContaining('planner produced no operations'),
              }),
            ],
          },
        });

        const empty = await runMigrationNew(ctx, ['--name', 'canonical-form', ...from]);
        expect(empty.exitCode, `migration new\n${output(empty)}`).toBe(0);
        const migrate = await runMigrate(ctx);
        expect(migrate.exitCode, `db migrate\n${output(migrate)}`).toBe(0);
        const verify = await runDbVerify(ctx, ['--strict']);
        expect(verify.exitCode, `db verify\n${output(verify)}`).toBe(0);

        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${output(infer)}`).toBe(0);
        expect(printedDefaultFields(ctx)).toEqual([
          'a Timestamptz @default("2024-01-01T00:00:00Z")',
          'b Timestamptz @default("2024-01-01T00:00:00Z")',
          'c Timestamptz @default("2024-01-01T00:00:00Z")',
          'clock Time @default("12:34:00")',
          'day Date @default("2024-01-01")',
          'history Timestamptz[] @default(["2024-01-01T00:00:00Z", "2024-06-30T12:34:56Z"])',
          'localAt Timestamp(3) @default("2024-01-01T12:34:56.5")',
          'zoned Timetz @default("12:34:56+02:00")',
        ]);

        const emitInferred = await runContractEmit(ctx);
        expect(emitInferred.exitCode, `contract emit\n${output(emitInferred)}`).toBe(0);
        expect(defaultsOf(ctx)).toEqual(STANDARD_DEFAULTS);
      },
      timeouts.spinUpPpgDev * 2,
    );
  });

  describe('Journey: a database db init made from the earlier contract', () => {
    const db = useDevDatabase();

    it(
      'is signed with the re-emitted contract after its marker no longer matches',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        copyFileSync(
          join(BEFORE, 'emitted-before/contract.json'),
          join(ctx.testDir, 'contract.json'),
        );
        const init = await runDbInit(ctx);
        expect(init.exitCode, `db init\n${output(init)}`).toBe(0);

        copyFileSync(join(BEFORE, 'contract.prisma'), join(ctx.testDir, 'contract.prisma'));
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);

        const stale = await runDbVerify(ctx);
        expect(stale.exitCode, `db verify\n${output(stale)}`).not.toBe(0);
        const sign = await runDbSign(ctx);
        expect(sign.exitCode, `db sign\n${output(sign)}`).toBe(0);
        const verify = await runDbVerify(ctx, ['--strict']);
        expect(verify.exitCode, `db verify\n${output(verify)}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey: TypeScript date and time defaults', () => {
    const db = useDevDatabase();

    it(
      'stores the canonical form, creates the database, and verifies it',
      async () => {
        const ctx = setupJourney({ connectionString: db.connectionString, createTempDir });
        swapContract(ctx, 'contract-date-time-defaults');

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
        expect(defaultsOf(ctx, ctx.outputDir)).toEqual({
          jsDate: { kind: 'literal', value: '2024-01-01T00:00:00Z' },
          instantText: { kind: 'literal', value: '2024-01-01T00:00:00Z' },
          localText: { kind: 'literal', value: '2024-01-01T12:34:56.5' },
          dayText: { kind: 'literal', value: '-000043-03-15' },
          clockText: { kind: 'literal', value: '12:34:56.5' },
          zoned: { kind: 'literal', value: '12:34:56+02:00' },
          span: { kind: 'literal', value: 'P1Y2M3DT4H5M6.5S' },
        });

        const init = await runDbInit(ctx);
        expect(init.exitCode, `db init\n${output(init)}`).toBe(0);
        expect(await schemaIssues(ctx)).toEqual([]);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey: a date default before year 1', () => {
    const db = useDevDatabase();

    const created = `// use prisma-8

model Created {
  id      Int       @id
  instant DateTime  @default("0044-03-15 00:00:00+00 BC")
  day     Date      @default("0044-03-15 BC")
  local   Timestamp @default("-000043-03-15T12:00:00")

  @@map("created")
}
`;
    const altered = (defaults: boolean) => `model Altered {
  id      Int       @id
  instant DateTime  ${defaults ? '@default("-000043-03-15T00:00:00Z")' : ''}
  day     Date      ${defaults ? '@default("-000043-03-15")' : ''}
  local   Timestamp ${defaults ? '@default("0044-03-15 12:00:00 BC")' : ''}

  @@map("altered")
}
`;

    it(
      'is created by CREATE TABLE and by SET DEFAULT, and verifies',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeFileSync(join(ctx.testDir, 'contract.prisma'), `${created}\n${altered(false)}`);
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode, `db init\n${output(init)}`).toBe(0);

        writeFileSync(join(ctx.testDir, 'contract.prisma'), `${created}\n${altered(true)}`);
        const emitDefaults = await runContractEmit(ctx);
        expect(emitDefaults.exitCode, `contract emit\n${output(emitDefaults)}`).toBe(0);
        const update = await runDbUpdate(ctx);
        expect(update.exitCode, `db update\n${output(update)}`).toBe(0);

        expect(await schemaIssues(ctx)).toEqual([]);
        const rows = await withClient(db.connectionString, async (client) => {
          await client.query('INSERT INTO "created" ("id") VALUES (1)');
          await client.query('INSERT INTO "altered" ("id") VALUES (1)');
          const selected = await client.query<Record<string, string>>(
            `SELECT "instant"::text AS "instant", "day"::text AS "day", "local"::text AS "local"
             FROM "created" UNION ALL
             SELECT "instant"::text, "day"::text, "local"::text FROM "altered"`,
          );
          return selected.rows;
        });
        const bc = {
          instant: '0044-03-15 00:00:00+00 BC',
          day: '0044-03-15 BC',
          local: '0044-03-15 12:00:00 BC',
        };
        expect(rows).toEqual([bc, bc]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
