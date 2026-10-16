/**
 * Journey: a default on a column of every built-in SQLite type that has a codec and a PSL default is written by the CLI, read back from the database by the column's codec, and compared as a value. A second model holds edge values: bytes and text with quotes and backslashes, empty bytes, a very small float, years outside 1 to 9999, an offset, a JSON document that is a string, and the smallest integer. `db verify` reports no issue. A default changed behind the CLI's back is the one issue it reports.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
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
} from '../utils/journey-test-helpers';

const SQLITE_CONFIG_TEMPLATE = join(
  import.meta.dirname,
  '../fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys/prisma.config.sqlite.psl.ts',
);

const BACKTICK = '`';
const tagged = (tag: string, body: string): string => `${tag}${BACKTICK}${body}${BACKTICK}`;

const SCHEMA = `// use prisma-8

model Sample {
  id      Int          @id
  text    String       @default("hello")
  count   Int          @default(42)
  big     BigInt       @default(9007199254740993)
  small   BigIntNumber @default(7)
  ratio   Float        @default(1.5)
  price   Decimal      @default("1.50")
  code    sql.String(10) @default("vc")
  at      DateTime     @default(${tagged('datetime', '2024-01-01T00:00:00Z')})
  doc     Json         @default(${tagged('json', '{"b": [1, 2], "a": 1}')})
  bytes   Bytes        @default(${tagged('blob', '6869')})

  @@map("sample")
}

model Edge {
  id         Int          @id
  quoteBytes Bytes        @default(${tagged('blob', '27225c00ff')})
  noBytes    Bytes        @default(${tagged('blob', '')})
  quoteText  String       @default("it's a \\\\ backslash")
  tiny       Float        @default(0.000000000000000000001)
  far        DateTime     @default(${tagged('datetime', '+010000-01-01T00:00:00Z')})
  early      DateTime     @default(${tagged('datetime', '-000001-01-01T00:00:00Z')})
  offset     DateTime     @default(${tagged('datetime', '2024-01-01T05:30:00.5+05:30')})
  docString  Json         @default(${tagged('json', '"42"')})
  huge       BigInt       @default(-9223372036854775808)

  @@map("edge")
}
`;

interface SchemaVerifyResult {
  readonly schema: { readonly issues: readonly { readonly path: readonly string[] }[] };
}

function output(result: { stdout: string; stderr: string }): string {
  return `${stripAnsi(result.stderr)}\n${stripAnsi(result.stdout)}`;
}

function sqliteJourney(createTempDir: () => string): JourneyContext & { readonly dbPath: string } {
  const ctx = setupJourney({ createTempDir, contractMode: 'psl' });
  const dbPath = join(ctx.testDir, 'journey.db');
  writeFileSync(
    ctx.configPath,
    readFileSync(SQLITE_CONFIG_TEMPLATE, 'utf-8').replace('{{DB_PATH}}', () => dbPath),
    'utf-8',
  );
  return { ...ctx, dbPath };
}

async function issuePaths(ctx: JourneyContext): Promise<readonly string[]> {
  const verify = await runDbVerify(ctx, ['--schema-only', '--strict', '--json']);
  return parseJsonOutput<SchemaVerifyResult>(verify).schema.issues.map((issue) =>
    issue.path.join('/'),
  );
}

/** SQLite cannot alter a column's default, so the table is created again with one default changed. */
function changeDefault(dbPath: string, from: string, to: string): void {
  const db = new DatabaseSync(dbPath);
  try {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'sample'").get();
    const created = String(row?.['sql']);
    const changed = created.replace(from, to);
    expect(changed).not.toBe(created);
    db.exec('ALTER TABLE "sample" RENAME TO "sample_before"');
    db.exec(changed);
    db.exec('DROP TABLE "sample_before"');
  } finally {
    db.close();
  }
}

withTempDir(({ createTempDir }) => {
  describe('Journey: every built-in SQLite type default, read by its codec', () => {
    it(
      'verifies clean after db init, and reports exactly the default changed by raw SQL',
      async () => {
        const ctx = sqliteJourney(createTempDir);
        writeFileSync(join(ctx.testDir, 'contract.prisma'), SCHEMA, 'utf-8');
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode, `db init\n${output(init)}`).toBe(0);

        expect(await issuePaths(ctx)).toEqual([]);

        changeDefault(
          ctx.dbPath,
          "DEFAULT '2024-01-01T00:00:00.000Z'",
          "DEFAULT '2024-01-02T00:00:00Z'",
        );
        expect(await issuePaths(ctx)).toEqual(['database/sample/column:at/default']);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
