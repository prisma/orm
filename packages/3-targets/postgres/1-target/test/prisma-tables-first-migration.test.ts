import { describe, expect, it } from 'vitest';
import FirstMigration from '../migrations/20261126T1200_create_prisma_tables/migration';
import metadata from '../migrations/20261126T1200_create_prisma_tables/migration.json' with {
  type: 'json',
};
import ops from '../migrations/20261126T1200_create_prisma_tables/ops.json' with { type: 'json' };
import endContract from '../migrations/snapshots/5807887e31e02b4ff9bd120ad0ac274610400ae9d7819564d209b835b763a177/contract.json' with {
  type: 'json',
};

interface ContractColumn {
  readonly dataType: string;
  readonly nullable: boolean;
  readonly many?: unknown;
}

const tableNames = ['marker', 'ledger', 'contract'] as const;

const endTables = (
  endContract.storage.namespaces as unknown as Record<
    string,
    {
      readonly entries: {
        readonly table: Record<string, { columns: Record<string, ContractColumn> }>;
      };
    }
  >
)['_prisma']?.entries.table;

const formatTypeOf: Record<string, string> = {
  'pg/text': 'text',
  'pg/jsonb': 'jsonb',
  'pg/int4': 'integer',
  'pg/int8': 'bigint',
  'pg/timestamptz': 'timestamp with time zone',
};

function endContractColumns(table: string) {
  return Object.entries(endTables?.[table]?.columns ?? {})
    .map(([name, column]) => ({
      name,
      type: `${formatTypeOf[column.dataType] ?? column.dataType}${column.many === undefined ? '' : '[]'}`,
      notNull: !column.nullable,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function checkedColumns(operationId: string) {
  const operation = ops.find((op) => op.id === operationId) as
    | { readonly precheck: readonly { readonly params: readonly unknown[] }[] }
    | undefined;
  return (operation?.precheck ?? [])
    .map(({ params: [, , name, type, notNull] }) => ({ name, type, notNull }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

describe("the first migration of the Postgres target's _prisma space", () => {
  it('produces from its migration.ts exactly the operations in its ops.json', () => {
    const produced = JSON.parse(JSON.stringify(new FirstMigration().operations));
    expect(produced).toEqual(ops);
  });

  it("labels its operations in the planner's imperative form", () => {
    expect(ops.map((op) => op.label)).toEqual([
      'Check the columns of table "prisma_contract"."marker"',
      'Check the columns of table "prisma_contract"."ledger"',
      'Check the columns of table "prisma_contract"."contract"',
      'Rename schema "prisma_contract" to "_prisma"',
      'Create schema "_prisma"',
      'Create table "_prisma"."marker"',
      'Create table "_prisma"."ledger"',
      'Create table "_prisma"."contract"',
      'Check the columns of table "_prisma"."marker"',
      'Check the columns of table "_prisma"."ledger"',
      'Check the columns of table "_prisma"."contract"',
    ]);
  });

  it('gives, where the role may not act as the owner of the old schema or a table in it, the statements that make the migrating role own the schema and every table', () => {
    const rename = ops.find((op) => op.id === '_prisma.rename-release-candidate-schema');
    const ownership = (rename?.precheck ?? [])
      .map((check) => check.description)
      .filter(
        (description) =>
          description.includes('owns schema "prisma_contract"') ||
          description.includes('owns table'),
      );
    const statements = [
      'ALTER SCHEMA "prisma_contract" OWNER TO <migrating role>',
      'ALTER TABLE "prisma_contract"."marker" OWNER TO <migrating role>',
      'ALTER TABLE "prisma_contract"."ledger" OWNER TO <migrating role>',
      'ALTER TABLE "prisma_contract"."contract" OWNER TO <migrating role>',
    ];
    expect({
      checks: ownership.length,
      missing: ownership.flatMap((description) =>
        statements.filter((statement) => !description.includes(statement)),
      ),
    }).toEqual({ checks: 4, missing: [] });
  });

  it('ends at the contract its snapshot holds', () => {
    expect(endContract.storage.storageHash).toBe(metadata.to);
  });

  it('describes the same tables in its end contract', () => {
    expect(Object.keys(endTables ?? {}).sort()).toEqual([...tableNames].sort());
  });

  it.each(tableNames)(
    'checks the columns of %s, in both schemas, exactly as its end contract describes them',
    (table) => {
      expect({
        current: checkedColumns(`_prisma.check-columns.${table}`),
        releaseCandidate: checkedColumns(`_prisma.check-release-candidate-columns.${table}`),
      }).toEqual({
        current: endContractColumns(table),
        releaseCandidate: endContractColumns(table),
      });
    },
  );
});
