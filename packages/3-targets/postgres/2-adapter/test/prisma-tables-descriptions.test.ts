import type { ColumnProxy } from '@internal/sql-relational-core/contract-free';
import {
  PRISMA_TABLE_NAMES,
  PRISMA_TABLES_SCHEMA,
  RELEASE_CANDIDATE_PRISMA_TABLES_SCHEMA,
} from '@internal/target-postgres/contract-free';
import postgres from '@internal/target-postgres/control';
import { describe, expect, it } from 'vitest';
import { ledger, ledgerContract, ledgerReadShape, signatures } from '../src/core/marker-ledger';

interface ContractColumn {
  readonly codecId: string;
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

interface ColumnForm {
  readonly name: string;
  readonly codecId: string;
  readonly nullable: boolean;
  readonly many: boolean;
}

function byName(a: ColumnForm, b: ColumnForm): number {
  return a.name.localeCompare(b.name);
}

function contractColumns(table: string): readonly ColumnForm[] {
  const columns = contractTables?.[table]?.columns ?? {};
  return Object.entries(columns)
    .map(([name, column]) => ({
      name,
      codecId: column.codecId,
      nullable: column.nullable,
      many: column.many !== undefined,
    }))
    .sort(byName);
}

function handleColumns(handle: object): readonly ColumnForm[] {
  return Object.values(handle)
    .flatMap((value: unknown) =>
      typeof value === 'object' && value !== null && 'columnName' in value
        ? [value as ColumnProxy]
        : [],
    )
    .map((column) => ({
      name: column.columnName,
      codecId: column.codecId,
      nullable: column.nullable,
      many: column.toProjectionItem().codec?.many === true,
    }))
    .sort(byName);
}

describe("the descriptions of Prisma's own tables", () => {
  const tableNames = Object.values(PRISMA_TABLE_NAMES);

  it('describe the same tables in the contract', () => {
    expect(Object.keys(contractTables ?? {}).sort()).toEqual([...tableNames].sort());
  });

  it("declare in the adapter's handles only columns the contract describes, with its codecs, nullability and whether each holds a list", () => {
    const outside = (handle: object, table: string) =>
      handleColumns(handle).filter(
        (column) =>
          !contractColumns(table).some(
            (described) =>
              described.name === column.name &&
              described.codecId === column.codecId &&
              described.nullable === column.nullable &&
              described.many === column.many,
          ),
      );
    expect({
      signatures: handleColumns(signatures),
      ledgerReadShape: handleColumns(ledgerReadShape),
      ledgerOutside: outside(ledger, 'ledger'),
      ledgerContractOutside: outside(ledgerContract, 'contract'),
    }).toEqual({
      signatures: contractColumns('signatures'),
      ledgerReadShape: contractColumns('ledger'),
      ledgerOutside: [],
      ledgerContractOutside: [],
    });
  });

  it('keep the tables in the schema names the target defines', () => {
    expect({
      signatures: signatures.source,
      ledger: ledgerReadShape.source,
      contract: ledgerContract.source,
    }).toMatchObject({
      signatures: { name: 'signatures', schema: PRISMA_TABLES_SCHEMA },
      ledger: { name: 'ledger', schema: PRISMA_TABLES_SCHEMA },
      contract: { name: 'contract', schema: PRISMA_TABLES_SCHEMA },
    });
    expect({
      current: PRISMA_TABLES_SCHEMA,
      releaseCandidate: RELEASE_CANDIDATE_PRISMA_TABLES_SCHEMA,
    }).toEqual({ current: '_prisma', releaseCandidate: 'prisma_contract' });
  });
});
