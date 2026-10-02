import sqliteAdapter from '@internal/adapter-sqlite/control';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql from '@internal/family-sql/control';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { createControlStack } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import sqlite, { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { sqliteDataTypes } from '@internal/target-sqlite/data-types';
import sqlitePackRef from '@internal/target-sqlite/pack';
import { describe, expect, it } from 'vitest';

const sqliteDataTypeLookup = createDataTypeLookup(sqliteDataTypes);

const stack = createControlStack({
  family: sql,
  target: sqlite,
  adapter: sqliteAdapter,
  driver: sqliteDriver,
});

const REPRESENTATIVE_SCHEMA = `model sample {
  id        Int      @id
  name      String
  big       BigInt
  bounded   BigIntNumber
  ratio     Float
  price     Decimal
  createdAt DateTime
  payload   Json
  raw       Bytes
}
`;

function emit() {
  const bound = bindPslSchema(REPRESENTATIVE_SCHEMA, {
    sourceId: 'scalar-type-parity.test.psl',
    context: contractSourceContextFromControlStack(stack, {
      dataTypeLookup: sqliteDataTypeLookup,
    }),
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: sqlitePackRef,
      createNamespace: sqliteCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

// The legacy scalar-type map channel (name-to-codecId, retired in TML-2985) is gone; the pinned literals
// below carry the parity claim forward — they are the exact
// {codecId, nativeType} pairs the retired map + codecLookup derivation produced.
describe('sqlite scalar types derived from the unified namespace', () => {
  it('pins every base scalar to its {codecId, nativeType}', () => {
    const derived = collectScalarTypeConstructors(stack.authoringContributions.type);

    expect(Object.fromEntries(derived)).toEqual({
      String: { codecId: 'sqlite/text@1', nativeType: 'text' },
      Int: { codecId: 'sqlite/integer@1', nativeType: 'integer' },
      BigInt: { codecId: 'sqlite/bigint@1', nativeType: 'integer' },
      BigIntNumber: { codecId: 'sqlite/bigintnumber@1', nativeType: 'integer' },
      Float: { codecId: 'sqlite/real@1', nativeType: 'real' },
      Decimal: { codecId: 'sqlite/text@1', nativeType: 'text' },
      DateTime: { codecId: 'sqlite/datetime@1', nativeType: 'text' },
      Json: { codecId: 'sqlite/json@1', nativeType: 'text' },
      Bytes: { codecId: 'sqlite/blob@1', nativeType: 'blob' },
    });
  });

  it('exposes the derived scalar names as controlStack.scalarTypes', () => {
    expect([...stack.scalarTypes].sort()).toEqual([
      'BigInt',
      'BigIntNumber',
      'Bytes',
      'DateTime',
      'Decimal',
      'Float',
      'Int',
      'Json',
      'String',
    ]);
  });

  it('emits a contract whose columns pin the namespace-derived {codecId, nativeType}', () => {
    const result = emit();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      storage: {
        namespaces: {
          __unbound__: {
            entries: {
              table: {
                sample: {
                  columns: {
                    id: { codecId: 'sqlite/integer@1', nativeType: 'integer' },
                    name: { codecId: 'sqlite/text@1', nativeType: 'text' },
                    big: { codecId: 'sqlite/bigint@1', nativeType: 'integer' },
                    bounded: { codecId: 'sqlite/bigintnumber@1', nativeType: 'integer' },
                    ratio: { codecId: 'sqlite/real@1', nativeType: 'real' },
                    price: { codecId: 'sqlite/text@1', nativeType: 'text' },
                    createdAt: { codecId: 'sqlite/datetime@1', nativeType: 'text' },
                    payload: { codecId: 'sqlite/json@1', nativeType: 'text' },
                    raw: { codecId: 'sqlite/blob@1', nativeType: 'blob' },
                  },
                },
              },
            },
          },
        },
      },
    });
  });
});
