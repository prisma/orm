/**
 * Journey: a default on a column of every built-in Postgres type that has a codec, through every codec PSL names for it, is written by the CLI, read back from the database by the column's codec, and compared as a value. A second model holds the values whose writing this slice changed: years outside 1 to 9999, `infinity` on the text codecs, mixed and negative intervals, bytes and text with quotes and backslashes, `NaN` and the infinities, and list defaults of them. `db verify` reports no issue. A default changed behind the CLI's back is the one issue it reports.
 */
import { writeFileSync } from 'node:fs';
import { withClient } from '@repo/test-utils';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runDbInit,
  runDbVerify,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const BACKTICK = '`';
const tagged = (tag: string, body: string): string => `${tag}${BACKTICK}${body}${BACKTICK}`;

const SCHEMA = `// use prisma-8

native_enum Plan {
  free = "free"
  pro  = "pro"
}

model Sample {
  id          Int               @id
  text        String            @default("hello")
  flag        Boolean           @default(true)
  int4        Int               @default(42)
  int8        BigInt            @default(9007199254740993)
  float8      Float             @default(1.5)
  decimal     Decimal           @default(1.50)
  money       Numeric(10, 2)    @default(3.10)
  instant     TimestamptzTemporal          @default(${tagged('timestamptz', '2024-01-01T00:00:00Z')})
  doc         Json              @default(${tagged('json', '{"a": 1}')})
  docb        Jsonb             @default(${tagged('json', '{"b": [1, 2]}')})
  bytes       Bytes             @default(${tagged('bytea', '\\x6869')})
  varcode     VarChar(10)       @default("vc")
  code        sql.String(10)    @default("vc")
  initials    Char(3)           @default("ab")
  local       TimestampTemporal(3)      @default(${tagged('timestamp', '2024-01-01T12:34:56.5')})
  precise     TimestamptzTemporal(6)    @default(${tagged('timestamptz', '2024-01-01T00:00:00.123456Z')})
  clock       TimeTemporal              @default(${tagged('time', '12:34:56')})
  zoned       Timetz            @default(${tagged('timetz', '12:34:56+02:00')})
  token       Uuid              @default("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")
  host        Inet              @default("10.0.0.1/32")
  small       SmallInt          @default(7)
  ratio       Real              @default(2.5)
  day         DateTemporal              @default(${tagged('date', '2024-01-01')})
  dayText     DateString        @default(${tagged('date', '2024-01-01')})
  localText   TimestampString   @default(${tagged('timestamp', '2024-01-01T00:00:00')})
  jsDate      TimestamptzJsDate @default(${tagged('timestamptz', '2024-01-01T00:00:00.5Z')})
  instantText TimestamptzString @default(${tagged('timestamptz', '2024-01-01T00:00:00Z')})
  clockText   TimeString        @default(${tagged('time', '12:00:00')})
  bits        Bit(3)            @default("101")
  varbits     VarBit(5)         @default("1")
  span        IntervalParts          @default(${tagged('interval', 'P1DT2H')})
  tags        String[]          @default(["a", "b"])
  counts      Int[]             @default([1, 2])
  plan        pg.enum(Plan)     @default("pro")
  safeBig     BigIntNumber      @default(42)
  huge        UnboundedInt      @default(123456789012345678901234567890)

  @@map("sample")
}

model Edge {
  id           Int                 @id
  dayBc        DateTemporal                @default(${tagged('date', '0044-03-15 BC')})
  dayFar       DateTemporal                @default(${tagged('date', '+012026-01-02')})
  localBc      TimestampTemporal(3)        @default(${tagged('timestamp', '0044-03-15 12:00:00 BC')})
  instantFar   TimestamptzTemporal(6)      @default(${tagged('timestamptz', '+012026-01-02T03:04:05Z')})
  forever      TimestamptzString   @default(${tagged('timestamptz', 'infinity')})
  dawn         DateString          @default(${tagged('date', '-infinity')})
  localForever TimestampString     @default(${tagged('timestamp', 'infinity')})
  mixed        IntervalParts            @default(${tagged('interval', 'P1Y-2M3DT-4H5M-6.5S')})
  backwards    IntervalParts            @default(${tagged('interval', 'P-1DT-4H-5M')})
  quoteBytes   Bytes               @default(${tagged('bytea', '\\x27225c00ff')})
  quoteText    String              @default("it's a \\\\ backslash")
  notANumber   Float               @default(NaN)
  above        Float               @default(Infinity)
  below        Real                @default(-Infinity)
  numericNaN   Decimal             @default(NaN)
  stamps       TimestampTemporal(3)[]      @default([${tagged('timestamp', '0044-03-15 12:00:00 BC')}, ${tagged('timestamp', '2024-01-01T00:00:00')}])
  spans        IntervalParts[]          @default([${tagged('interval', 'P1Y-2M')}, ${tagged('interval', 'PT0S')}])
  blobs        Bytes[]             @default([${tagged('bytea', '\\x27')}, ${tagged('bytea', '\\x5c')}])
  texts        String[]            @default(["a'b", "c\\\\d", ""])
  floats       Float[]             @default([NaN, Infinity, -Infinity, 1.5])

  @@map("edge")
}
`;

interface SchemaVerifyResult {
  readonly schema: {
    readonly issues: readonly { readonly path: readonly string[]; readonly explanation?: string }[];
  };
}

function output(result: { stdout: string; stderr: string }): string {
  return `${stripAnsi(result.stderr)}\n${stripAnsi(result.stdout)}`;
}

async function issuePaths(ctx: JourneyContext): Promise<readonly string[]> {
  const verify = await runDbVerify(ctx, ['--schema-only', '--strict', '--json']);
  return parseJsonOutput<SchemaVerifyResult>(verify).schema.issues.map((issue) =>
    issue.path.join('/'),
  );
}

withTempDir(({ createTempDir }) => {
  describe('Journey: every built-in Postgres type default, read by its codec', () => {
    const db = useDevDatabase();

    it(
      'verifies clean after db init, and reports exactly the default changed by raw SQL',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeFileSync(join(ctx.testDir, 'contract.prisma'), SCHEMA, 'utf-8');
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode, `db init\n${output(init)}`).toBe(0);

        expect(await issuePaths(ctx)).toEqual([]);

        await withClient(db.connectionString, async (client) => {
          await client.query(`ALTER TABLE "sample" ALTER COLUMN "money" SET DEFAULT 3.11`);
        });
        expect(await issuePaths(ctx)).toEqual(['database/public/sample/column:money/default']);
        const shown = output(await runDbVerify(ctx, ['--schema-only', '--strict']));
        expect(shown).toContain(
          'mismatch: database/public/sample/column:money/default. The contract holds "3.10", and the database holds "3.11"',
        );
      },
      timeouts.spinUpPpgDev * 2,
    );
  });
});
