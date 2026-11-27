import {
  PRISMA_TABLE_NAMES,
  PRISMA_TABLES_SCHEMA,
  RELEASE_CANDIDATE_PRISMA_TABLES_SCHEMA,
} from '@internal/target-postgres/contract-free';
import postgres from '@internal/target-postgres/control';
import { describe, expect, it } from 'vitest';
import { ledger, ledgerContract, ledgerReadShape, marker } from '../src/core/marker-ledger';

interface ContractColumn {
  readonly dataType: string;
  readonly nullable: boolean;
  readonly many?: unknown;
}

const contractSpace = postgres.contractSpace;
if (contractSpace === undefined) throw new Error('the Postgres target carries no _prisma space');

const contractTables = (
  contractSpace.contractJson.storage.namespaces as unknown as Record<
    string,
    {
      readonly entries: {
        readonly table: Record<string, { columns: Record<string, ContractColumn> }>;
      };
    }
  >
)[PRISMA_TABLES_SCHEMA]?.entries.table;

const formatTypeOf: Record<string, string> = {
  'pg/text': 'text',
  'pg/jsonb': 'jsonb',
  'pg/int4': 'integer',
  'pg/int8': 'bigint',
  'pg/timestamptz': 'timestamp with time zone',
};

function contractColumns(table: string) {
  const columns = contractTables?.[table]?.columns ?? {};
  return Object.entries(columns)
    .map(([name, column]) => ({
      name,
      type: `${formatTypeOf[column.dataType] ?? column.dataType}${column.many === undefined ? '' : '[]'}`,
      notNull: !column.nullable,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function checkedColumns(operationId: string) {
  const [migration] = contractSpace?.migrations ?? [];
  const operation = migration?.ops.find((op) => op.id === operationId) as
    | { readonly precheck: readonly { readonly params: readonly unknown[] }[] }
    | undefined;
  return (operation?.precheck ?? [])
    .map(({ params: [, , name, type, notNull] }) => ({ name, type, notNull }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function handleColumns(handle: object): readonly string[] {
  return Object.values(handle)
    .flatMap((value: unknown) =>
      typeof value === 'object' && value !== null && 'columnName' in value
        ? [String(value.columnName)]
        : [],
    )
    .sort();
}

describe("the descriptions of Prisma's own tables", () => {
  const tableNames = Object.values(PRISMA_TABLE_NAMES);

  it('describe the same tables in the contract', () => {
    expect(Object.keys(contractTables ?? {}).sort()).toEqual([...tableNames].sort());
  });

  it.each(tableNames)(
    'check the columns of %s, in both schemas, exactly as the contract describes them',
    (table) => {
      expect({
        current: checkedColumns(`_prisma.check-columns.${table}`),
        releaseCandidate: checkedColumns(`_prisma.check-release-candidate-columns.${table}`),
      }).toEqual({ current: contractColumns(table), releaseCandidate: contractColumns(table) });
    },
  );

  it("name in the adapter's handles only columns the contract describes", () => {
    const names = (table: string) => contractColumns(table).map(({ name }) => name);
    expect({
      marker: handleColumns(marker),
      ledgerReadShape: handleColumns(ledgerReadShape),
      ledger: handleColumns(ledger).every((name) => names('ledger').includes(name)),
      ledgerContract: handleColumns(ledgerContract).every((name) =>
        names('contract').includes(name),
      ),
    }).toEqual({
      marker: names('marker'),
      ledgerReadShape: names('ledger'),
      ledger: true,
      ledgerContract: true,
    });
  });

  it('keep the tables in the schema names the target defines', () => {
    expect({
      marker: marker.source,
      ledger: ledgerReadShape.source,
      contract: ledgerContract.source,
    }).toMatchObject({
      marker: { name: 'marker', schema: PRISMA_TABLES_SCHEMA },
      ledger: { name: 'ledger', schema: PRISMA_TABLES_SCHEMA },
      contract: { name: 'contract', schema: PRISMA_TABLES_SCHEMA },
    });
    expect({
      current: PRISMA_TABLES_SCHEMA,
      releaseCandidate: RELEASE_CANDIDATE_PRISMA_TABLES_SCHEMA,
    }).toEqual({ current: '_prisma', releaseCandidate: 'prisma_contract' });
  });
});
