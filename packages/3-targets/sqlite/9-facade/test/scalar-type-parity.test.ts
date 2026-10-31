import sqliteAdapter from '@internal/adapter-sqlite/control';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql from '@internal/family-sql/control';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { createControlStack } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import sqlite from '@internal/target-sqlite/control';
import sqlitePackRef from '@internal/target-sqlite/pack';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { describe, expect, it } from 'vitest';

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
    context: contractSourceContextFromControlStack(stack),
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
// {codecId} pairs the retired map + codecLookup derivation produced.
describe('sqlite scalar types derived from the unified namespace', () => {
  it('pins every base scalar to its {codecId}', () => {
    const derived = collectScalarTypeConstructors(stack.authoringContributions.type);

    expect(Object.fromEntries(derived)).toEqual({
      String: { codecId: 'sqlite/text@1' },
      Int: { codecId: 'sqlite/integer@1' },
      BigInt: { codecId: 'sqlite/bigint@1' },
      BigIntNumber: { codecId: 'sqlite/bigintnumber@1' },
      Float: { codecId: 'sqlite/real@1' },
      Decimal: { codecId: 'sqlite/text@1' },
      DateTime: { codecId: 'sqlite/datetime@1' },
      Json: { codecId: 'sqlite/json@1' },
      Bytes: { codecId: 'sqlite/blob@1' },
      DatetimeJsDate: { codecId: 'sqlite/datetime@1' },
      DatetimeTemporal: { codecId: 'sqlite/datetime-temporal@1' },
      DatetimeString: { codecId: 'sqlite/datetime-string@1' },
      DateString: { codecId: 'sqlite/date-string@1' },
      DateTemporal: { codecId: 'sqlite/date-temporal@1' },
      TimeString: { codecId: 'sqlite/time-string@1' },
      TimeTemporal: { codecId: 'sqlite/time-temporal@1' },
      DurationString: { codecId: 'sqlite/duration-string@1' },
      Date: { codecId: 'sqlite/date-string@1' },
      Time: { codecId: 'sqlite/time-string@1' },
      Duration: { codecId: 'sqlite/duration-string@1' },
    });
  });

  it('exposes the derived scalar names as controlStack.scalarTypes', () => {
    expect([...stack.scalarTypes].sort()).toEqual([
      'BigInt',
      'BigIntNumber',
      'Bytes',
      'Date',
      'DateString',
      'DateTemporal',
      'DateTime',
      'DatetimeJsDate',
      'DatetimeString',
      'DatetimeTemporal',
      'Decimal',
      'Duration',
      'DurationString',
      'Float',
      'Int',
      'Json',
      'String',
      'Time',
      'TimeString',
      'TimeTemporal',
    ]);
  });

  it('emits a contract whose columns pin the namespace-derived {codecId}', () => {
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
                    id: { codecId: 'sqlite/integer@1' },
                    name: { codecId: 'sqlite/text@1' },
                    big: { codecId: 'sqlite/bigint@1' },
                    bounded: { codecId: 'sqlite/bigintnumber@1' },
                    ratio: { codecId: 'sqlite/real@1' },
                    price: { codecId: 'sqlite/text@1' },
                    createdAt: { codecId: 'sqlite/datetime@1' },
                    payload: { codecId: 'sqlite/json@1' },
                    raw: { codecId: 'sqlite/blob@1' },
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
