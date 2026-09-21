/**
 * Journey: every written `@default` is read by the authoring entry for the syntax it is written in,
 * cast into the column's data type, validated by the column's codec, stored in the contract in that
 * type's canonical form, created in the database by `db init`, verified clean by strict `db verify`,
 * and read back through the client as the codec's own value.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Contract } from '@prisma/orm-postgres/contract/types';
import type { SqlStorage } from '@prisma/orm-postgres/family-contract/types';
import postgres from '@prisma/orm-postgres/runtime';
import { withClient } from '@repo/test-utils';
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

const SCHEMA = `// use prisma-8

model Account {
  id      Int      @id @default(autoincrement())
  name    String   @default("anonymous")
  small   SmallInt @default(100)
  count   Int      @default(100000)
  balance BigInt   @default(100000000000000099)
  price   Decimal  @default(1.50)
  ratio   Float    @default(NaN)
  active  Boolean  @default(true)
  meta    Jsonb    @default(json\`{ "plan": "free", "seats": 1 }\`)
  scores  Int[]    @default([1, 2])
  docs    Jsonb[]  @default([json\`{}\`, json\`[]\`])
  expires DateTime @default(sql\`(now() + '3 days'::interval)\`)
}
`;

interface SchemaVerifyResult {
  readonly schema: { readonly issues: readonly unknown[] };
}

interface EmittedColumn {
  readonly default?: { readonly kind: string; readonly value?: unknown };
}

interface EmittedTable {
  readonly columns: Record<string, EmittedColumn>;
}

function output(result: { stdout: string; stderr: string }): string {
  return `${stripAnsi(result.stderr)}\n${stripAnsi(result.stdout)}`;
}

function readContractJson(ctx: JourneyContext): unknown {
  return JSON.parse(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8'));
}

/** The one table the schema declares, under whichever key the interpreter stores it. */
function emittedTable(contractJson: unknown): {
  readonly key: string;
  readonly table: EmittedTable;
} {
  const tables = (
    contractJson as {
      storage: { namespaces: { public: { entries: { table: Record<string, EmittedTable> } } } };
    }
  ).storage.namespaces.public.entries.table;
  const [entry, ...rest] = Object.entries(tables);
  if (entry === undefined || rest.length > 0) {
    throw new Error(`expected one table, got ${Object.keys(tables)}`);
  }
  return { key: entry[0], table: entry[1] };
}

async function rows(result: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const row of result) out.push(row);
  return out;
}

withTempDir(({ createTempDir }) => {
  describe('Journey: data types for column defaults', () => {
    const db = useDevDatabase();

    it(
      'emits, initialises, verifies clean, and reads the defaults back with their decoded types',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        writeFileSync(join(ctx.testDir, 'contract.prisma'), SCHEMA, 'utf-8');

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);

        const contractJson = readContractJson(ctx);
        const { key, table } = emittedTable(contractJson);
        const columns = table.columns;
        expect({
          name: columns['name']?.default,
          small: columns['small']?.default,
          count: columns['count']?.default,
          balance: columns['balance']?.default,
          price: columns['price']?.default,
          ratio: columns['ratio']?.default,
          active: columns['active']?.default,
          meta: columns['meta']?.default,
          scores: columns['scores']?.default,
          docs: columns['docs']?.default,
          expires: columns['expires']?.default,
        }).toEqual({
          name: { kind: 'literal', value: 'anonymous' },
          small: { kind: 'literal', value: 100 },
          count: { kind: 'literal', value: 100000 },
          balance: { kind: 'literal', value: '100000000000000099' },
          price: { kind: 'literal', value: '1.50' },
          ratio: { kind: 'literal', value: 'NaN' },
          active: { kind: 'literal', value: true },
          meta: { kind: 'literal', value: { plan: 'free', seats: 1 } },
          scores: { kind: 'literal', value: [1, 2] },
          docs: { kind: 'literal', value: [{}, []] },
          expires: { kind: 'function', expression: "(now() + '3 days'::interval)" },
        });

        const init = await runDbInit(ctx);
        expect(init.exitCode, `db init\n${output(init)}`).toBe(0);

        const verify = await runDbVerify(ctx, ['--schema-only', '--strict', '--json']);
        expect(
          parseJsonOutput<SchemaVerifyResult>(verify).schema.issues,
          `db verify\n${output(verify)}`,
        ).toEqual([]);

        await withClient(db.connectionString, (client) =>
          client.query(`insert into "${key}" default values`),
        );

        const client = postgres<Contract<SqlStorage>>({ contractJson, url: db.connectionString });
        const runtime = await client.connect();
        try {
          const sqlNamespace = (
            client.sql as unknown as {
              readonly public: Record<string, { select(...columns: string[]): { build(): never } }>;
            }
          ).public;
          const sqlTable = sqlNamespace[key];
          expect(
            sqlTable,
            `the client exposes ${key}; it has ${Object.keys(sqlNamespace)}`,
          ).toBeDefined();
          const plan = sqlTable
            ?.select(
              'id',
              'name',
              'small',
              'count',
              'balance',
              'price',
              'ratio',
              'active',
              'meta',
              'scores',
              'docs',
            )
            .build();
          expect(await rows(runtime.query(plan as never))).toEqual([
            {
              id: 1,
              name: 'anonymous',
              small: 100,
              count: 100000,
              balance: 100000000000000099n,
              price: '1.50',
              ratio: Number.NaN,
              active: true,
              meta: { plan: 'free', seats: 1 },
              scores: [1, 2],
              docs: [{}, []],
            },
          ]);
        } finally {
          await runtime.close();
        }
      },
      timeouts.spinUpPpgDev,
    );
  });
});
