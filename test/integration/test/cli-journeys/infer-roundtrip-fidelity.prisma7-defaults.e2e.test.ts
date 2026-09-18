/**
 * Infer -> Emit -> Verify for column defaults as Prisma 7 writes them.
 *
 * Every table but `sql_defaults` is what `prisma migrate diff --from-empty --script` from Prisma
 * 7.10.0 writes for the models below. `sql_defaults` holds defaults Prisma 7 cannot write, in SQL.
 *
 * ```prisma
 * model NumberDefaults {
 *   id            Int      @id
 *   negInt        Int      @default(-1)
 *   negSmallInt   Int      @default(-2) @db.SmallInt
 *   negFloat      Float    @default(-1.5)
 *   tinyFloat     Float    @default(0.0000001)
 *   negReal       Float    @default(-2.5) @db.Real
 *   negDecimal    Decimal  @default(-0.5)
 *   longDecimal   Decimal  @default(12345678901234567890.123456789)
 *   tinyDecimal   Decimal  @default(0.000000000000000001)
 *   scaleDecimal  Decimal  @default(1.50)
 *   wholeDecimal  Decimal  @default(10)
 *   scaledDecimal Decimal  @default(-1.25) @db.Decimal(10, 2)
 *   negSafeBigInt BigInt   @default(-5)
 *   negBigInt     BigInt   @default(-9007199254740993)
 *   hugeBigInt    BigInt   @default(9007199254740993)
 *   stamp         DateTime @default("2024-01-01T00:00:00.000Z")
 *   jsonNull      Json?    @default("null")
 *   @@map("number_defaults")
 * }
 *
 * model ListDefaults {
 *   id             Int       @id
 *   negInts        Int[]     @default([-1, 2])
 *   negSmallInts   Int[]     @default([-1, 2]) @db.SmallInt
 *   bigInts        BigInt[]  @default([1, 2])
 *   negBigInts     BigInt[]  @default([-1, 2])
 *   emptyBigInts   BigInt[]  @default([])
 *   hugeBigInts    BigInt[]  @default([9007199254740993, -9007199254740993])
 *   negFloats      Float[]   @default([-1.5, 2])
 *   negDecimals    Decimal[] @default([-1.5, 2])
 *   longDecimals   Decimal[] @default([12345678901234567890.123456789, 0.000000000000000001])
 *   scaledDecimals Decimal[] @default([-1.25, 2]) @db.Decimal(10, 2)
 *   emptyVarchars  String[]  @default([]) @db.VarChar(32)
 *   @@map("list_defaults")
 * }
 *
 * model RawListDefaults {
 *   id          Int        @id
 *   timestamps DateTime[] @default(["2024-01-01T00:00:00.000Z"])
 *   @@map("raw_list_defaults")
 * }
 * ```
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withClient } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type EngineCommandResult,
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runContractInfer,
  runDbInit,
  runDbVerify,
  runDbVerifyWithDb,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const NUMBER_AND_LIST_DEFAULTS_SQL = `
CREATE TABLE "number_defaults" (
    "id" INTEGER NOT NULL,
    "negInt" INTEGER NOT NULL DEFAULT -1,
    "negSmallInt" SMALLINT NOT NULL DEFAULT -2,
    "negFloat" DOUBLE PRECISION NOT NULL DEFAULT -1.5,
    "tinyFloat" DOUBLE PRECISION NOT NULL DEFAULT 0.0000001,
    "negReal" REAL NOT NULL DEFAULT -2.5,
    "negDecimal" DECIMAL(65,30) NOT NULL DEFAULT -0.5,
    "longDecimal" DECIMAL(65,30) NOT NULL DEFAULT 12345678901234567890.123456789,
    "tinyDecimal" DECIMAL(65,30) NOT NULL DEFAULT 0.000000000000000001,
    "scaleDecimal" DECIMAL(65,30) NOT NULL DEFAULT 1.50,
    "wholeDecimal" DECIMAL(65,30) NOT NULL DEFAULT 10,
    "scaledDecimal" DECIMAL(10,2) NOT NULL DEFAULT -1.25,
    "negSafeBigInt" BIGINT NOT NULL DEFAULT -5,
    "negBigInt" BIGINT NOT NULL DEFAULT -9007199254740993,
    "hugeBigInt" BIGINT NOT NULL DEFAULT 9007199254740993,
    "stamp" TIMESTAMP(3) NOT NULL DEFAULT '2024-01-01 00:00:00 +00:00',
    "jsonNull" JSONB DEFAULT 'null',

    CONSTRAINT "number_defaults_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "list_defaults" (
    "id" INTEGER NOT NULL,
    "negInts" INTEGER[] DEFAULT ARRAY[-1, 2]::INTEGER[],
    "negSmallInts" SMALLINT[] DEFAULT ARRAY[-1, 2]::SMALLINT[],
    "bigInts" BIGINT[] DEFAULT ARRAY[1, 2]::BIGINT[],
    "negBigInts" BIGINT[] DEFAULT ARRAY[-1, 2]::BIGINT[],
    "emptyBigInts" BIGINT[] DEFAULT ARRAY[]::BIGINT[],
    "hugeBigInts" BIGINT[] DEFAULT ARRAY[9007199254740993, -9007199254740993]::BIGINT[],
    "negFloats" DOUBLE PRECISION[] DEFAULT ARRAY[-1.5, 2]::DOUBLE PRECISION[],
    "negDecimals" DECIMAL(65,30)[] DEFAULT ARRAY[-1.5, 2]::DECIMAL(65,30)[],
    "longDecimals" DECIMAL(65,30)[] DEFAULT ARRAY[12345678901234567890.123456789, 0.000000000000000001]::DECIMAL(65,30)[],
    "scaledDecimals" DECIMAL(10,2)[] DEFAULT ARRAY[-1.25, 2]::DECIMAL(10,2)[],
    "emptyVarchars" VARCHAR(32)[] DEFAULT ARRAY[]::VARCHAR(32)[],

    CONSTRAINT "list_defaults_pkey" PRIMARY KEY ("id")
);
`;

const SQL_DEFAULTS_SQL = `
CREATE TABLE "sql_defaults" (
    "id" INTEGER NOT NULL,
    "textNull" VARCHAR(32) DEFAULT NULL::character varying,
    "floatNaN" DOUBLE PRECISION NOT NULL DEFAULT 'NaN',
    "floatNegInf" DOUBLE PRECISION NOT NULL DEFAULT '-Infinity',
    "realNaN" REAL NOT NULL DEFAULT 'NaN',
    "decimalNaN" NUMERIC NOT NULL DEFAULT 'NaN',
    "timeWithZone" TIMETZ NOT NULL DEFAULT '12:34:56+00',

    CONSTRAINT "sql_defaults_pkey" PRIMARY KEY ("id")
);
`;

const RAW_LIST_DEFAULTS_SQL = `
CREATE TABLE "raw_list_defaults" (
    "id" INTEGER NOT NULL,
    "timestamps" TIMESTAMP(3)[] DEFAULT ARRAY['2024-01-01 00:00:00 +00:00']::TIMESTAMP(3)[],

    CONSTRAINT "raw_list_defaults_pkey" PRIMARY KEY ("id")
);
`;

/**
 * `db init` renders a `dbgenerated` timestamp default through a codec that needs a global
 * `Temporal`, which the CLI does not install.
 */
const DB_INIT_UNSUPPORTED_FIELDS = ['stamp'] as const;

interface VerifyIssue {
  readonly path: readonly string[];
}

interface SchemaVerifyResult {
  readonly schema: { readonly issues: readonly VerifyIssue[] };
}

function readContractPsl(ctx: JourneyContext): string {
  return readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8');
}

function output(run: EngineCommandResult): string {
  return `${stripAnsi(run.stderr)}\n${stripAnsi(run.stdout)}`;
}

function withoutFields(psl: string, fields: readonly string[]): string {
  return psl
    .split('\n')
    .filter((line) => !fields.includes(line.trim().split(/\s+/)[0] ?? ''))
    .join('\n');
}

async function inferInto(ctx: JourneyContext): Promise<string> {
  const infer = await runContractInfer(ctx);
  expect(infer.exitCode, `contract infer\n${output(infer)}`).toBe(0);
  return readContractPsl(ctx);
}

withTempDir(({ createTempDir }) => {
  describe('Journey: infer -> emit -> verify of defaults as Prisma 7 writes them', () => {
    describe('given scalar defaults, and list defaults whose every element has a PSL literal', () => {
      const db = useDevDatabase({
        onReady: (cs) =>
          withClient(cs, (client) =>
            client.query(`${NUMBER_AND_LIST_DEFAULTS_SQL}${SQL_DEFAULTS_SQL}`),
          ),
      });
      const emptyDb = useDevDatabase();

      it(
        'infer prints each default as the literal its codec accepts, or as dbgenerated when a scalar has none',
        async () => {
          const ctx = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
            contractMode: 'psl',
          });

          expect(await inferInto(ctx)).toMatchInlineSnapshot(`
            "// use prisma-8
            // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

            model ListDefaults {
              id             Int                @id(map: "list_defaults_pkey")
              negInts        Int[]?             @default([-1, 2]) @noCheck(elementNotNull)
              negSmallInts   SmallInt[]?        @default([-1, 2]) @noCheck(elementNotNull)
              bigInts        BigInt[]?          @default([1, 2]) @noCheck(elementNotNull)
              negBigInts     BigInt[]?          @default([-1, 2]) @noCheck(elementNotNull)
              emptyBigInts   BigInt[]?          @default([]) @noCheck(elementNotNull)
              hugeBigInts    BigInt[]?          @default([9007199254740993, -9007199254740993]) @noCheck(elementNotNull)
              negFloats      Float[]?           @default([-1.5, 2]) @noCheck(elementNotNull)
              negDecimals    Numeric(65, 30)[]? @default(["-1.5", "2"]) @noCheck(elementNotNull)
              longDecimals   Numeric(65, 30)[]? @default(["12345678901234567890.123456789", "0.000000000000000001"]) @noCheck(elementNotNull)
              scaledDecimals Numeric(10, 2)[]?  @default(["-1.25", "2"]) @noCheck(elementNotNull)
              emptyVarchars  VarChar(32)[]?     @default([]) @noCheck(elementNotNull)

              @@map("list_defaults")
            }

            model NumberDefaults {
              id            Int             @id(map: "number_defaults_pkey")
              negInt        Int             @default(-1)
              negSmallInt   SmallInt        @default(-2)
              negFloat      Float           @default(-1.5)
              tinyFloat     Float           @default(0.0000001)
              negReal       Real            @default(-2.5)
              negDecimal    Numeric(65, 30) @default("-0.5")
              longDecimal   Numeric(65, 30) @default("12345678901234567890.123456789")
              tinyDecimal   Numeric(65, 30) @default("0.000000000000000001")
              scaleDecimal  Numeric(65, 30) @default("1.50")
              wholeDecimal  Numeric(65, 30) @default("10")
              scaledDecimal Numeric(10, 2)  @default("-1.25")
              negSafeBigInt BigInt          @default(-5)
              negBigInt     BigInt          @default(-9007199254740993)
              hugeBigInt    BigInt          @default(9007199254740993)
              stamp         Timestamp(3)    @default(dbgenerated("'2024-01-01 00:00:00'::timestamp without time zone"))
              jsonNull      Jsonb?          @default(dbgenerated("'null'::jsonb"))

              @@map("number_defaults")
            }

            model SqlDefaults {
              id           Int          @id(map: "sql_defaults_pkey")
              textNull     VarChar(32)? @default(dbgenerated("NULL::character varying"))
              floatNaN     Float        @default("NaN")
              floatNegInf  Float        @default("-Infinity")
              realNaN      Real         @default("NaN")
              decimalNaN   Numeric      @default("NaN")
              timeWithZone Timetz       @default("12:34:56+00")

              @@map("sql_defaults")
            }
            "
          `);
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'the inferred schema emits, and strict verify finds nothing',
        async () => {
          const ctx = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
            contractMode: 'psl',
          });
          await inferInto(ctx);

          const emit = await runContractEmit(ctx);
          expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);

          const verify = await runDbVerify(ctx, ['--schema-only', '--strict', '--json']);
          expect(
            parseJsonOutput<SchemaVerifyResult>(verify).schema.issues,
            `db verify\n${output(verify)}`,
          ).toEqual([]);
        },
        timeouts.spinUpPpgDev,
      );

      it(
        'db init creates the inferred defaults in an empty database, and strict verify then finds nothing',
        async () => {
          const ctx = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
            contractMode: 'psl',
          });
          const psl = withoutFields(await inferInto(ctx), DB_INIT_UNSUPPORTED_FIELDS);
          writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');

          const emit = await runContractEmit(ctx);
          expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);

          const init = await runDbInit(ctx, ['--db', emptyDb.connectionString]);
          expect(init.exitCode, `db init\n${output(init)}`).toBe(0);

          const verify = await runDbVerifyWithDb(ctx, emptyDb.connectionString, [
            '--schema-only',
            '--strict',
            '--json',
          ]);
          expect(
            parseJsonOutput<SchemaVerifyResult>(verify).schema.issues,
            `db verify\n${output(verify)}`,
          ).toEqual([]);
        },
        timeouts.spinUpPpgDev,
      );
    });

    describe('given list defaults with an element that has no PSL literal', () => {
      const db = useDevDatabase({
        onReady: (cs) => withClient(cs, (client) => client.query(RAW_LIST_DEFAULTS_SQL)),
      });

      it(
        'infer prints them as dbgenerated, which emit accepts: a list column takes any storage default',
        async () => {
          const ctx = setupJourney({
            connectionString: db.connectionString,
            createTempDir,
            contractMode: 'psl',
          });

          expect(await inferInto(ctx)).toMatchInlineSnapshot(`
            "// use prisma-8
            // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

            model RawListDefaults {
              id         Int             @id(map: "raw_list_defaults_pkey")
              timestamps Timestamp(3)[]? @default(dbgenerated("ARRAY['2024-01-01 00:00:00'::timestamp(3) without time zone]")) @noCheck(elementNotNull)

              @@map("raw_list_defaults")
            }
            "
          `);

          const emit = await runContractEmit(ctx, ['--json']);
          expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
        },
        timeouts.spinUpPpgDev,
      );
    });
  });
});
