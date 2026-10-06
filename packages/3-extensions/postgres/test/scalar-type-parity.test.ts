import postgresAdapter from '@internal/adapter-postgres/control';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { createControlStack } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import postgres from '@internal/target-postgres/control';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);

const stack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
});

const REPRESENTATIVE_SCHEMA = `model sample {
  id        Int      @id
  name      String
  active    Boolean
  big       BigInt
  bounded   BigIntNumber
  unbounded UnboundedInt
  ratio     Float
  price     Decimal
  createdAt DateTime
  payload   Json
  document  Jsonb
  raw       Bytes
}
`;

function emit() {
  const bound = bindPslSchema(REPRESENTATIVE_SCHEMA, {
    sourceId: 'scalar-type-parity.test.psl',
    context: contractSourceContextFromControlStack(stack, {
      dataTypeLookup: postgresDataTypeLookup,
    }),
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: postgresPackRef,
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

describe('postgres scalar types derived from the unified namespace', () => {
  it('pins every bare-eligible scalar to its zero-arg instantiation', () => {
    const derived = collectScalarTypeConstructors(stack.authoringContributions.type);

    expect(Object.fromEntries(derived)).toEqual({
      String: { codecId: 'pg/text@1' },
      Boolean: { codecId: 'pg/bool@1' },
      Int: { codecId: 'pg/int4@1' },
      BigInt: { codecId: 'pg/int8@1' },
      BigIntNumber: { codecId: 'pg/int8number@1' },
      UnboundedInt: { codecId: 'pg/unboundedint@1' },
      Float: { codecId: 'pg/float8@1' },
      Inet: { codecId: 'pg/inet@1' },
      Decimal: { codecId: 'pg/numeric@1' },
      DateTime: { codecId: 'pg/timestamptz-temporal@1' },
      Json: { codecId: 'pg/json@1' },
      Jsonb: { codecId: 'pg/jsonb@1' },
      Bytes: { codecId: 'pg/bytea@1' },
      VarChar: { codecId: 'sql/varchar@1' },
      Char: { codecId: 'sql/char@1' },
      Numeric: { codecId: 'pg/numeric@1' },
      Timestamp: { codecId: 'pg/timestamp-temporal@1' },
      Timestamptz: { codecId: 'pg/timestamptz-temporal@1' },
      Time: { codecId: 'pg/time-temporal@1' },
      Timetz: { codecId: 'pg/timetz@1' },
      Uuid: { codecId: 'pg/uuid@1' },
      SmallInt: { codecId: 'pg/int2@1' },
      Real: { codecId: 'pg/float4@1' },
      Date: { codecId: 'pg/date-temporal@1' },
      DateString: { codecId: 'pg/date-string@1' },
      TimestampString: { codecId: 'pg/timestamp-string@1' },
      TimestamptzString: { codecId: 'pg/timestamptz-string@1' },
      TimestamptzJsDate: { codecId: 'pg/timestamptz-date@1' },
      TimeString: { codecId: 'pg/time-string@1' },
    });
  });

  it('exposes the derived scalar names as controlStack.scalarTypes', () => {
    expect([...stack.scalarTypes].sort()).toEqual([
      'BigInt',
      'BigIntNumber',
      'Boolean',
      'Bytes',
      'Char',
      'Date',
      'DateString',
      'DateTime',
      'Decimal',
      'Float',
      'Inet',
      'Int',
      'Json',
      'Jsonb',
      'Numeric',
      'Real',
      'SmallInt',
      'String',
      'Time',
      'TimeString',
      'Timestamp',
      'TimestampString',
      'Timestamptz',
      'TimestamptzJsDate',
      'TimestamptzString',
      'Timetz',
      'UnboundedInt',
      'Uuid',
      'VarChar',
    ]);
  });

  it('emits a contract whose columns pin the namespace-derived {codecId}', () => {
    const result = emit();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      storage: {
        namespaces: {
          public: {
            entries: {
              table: {
                sample: {
                  columns: {
                    id: { codecId: 'pg/int4@1' },
                    name: { codecId: 'pg/text@1' },
                    active: { codecId: 'pg/bool@1' },
                    big: { codecId: 'pg/int8@1' },
                    bounded: { codecId: 'pg/int8number@1' },
                    unbounded: { codecId: 'pg/unboundedint@1' },
                    ratio: { codecId: 'pg/float8@1' },
                    price: { codecId: 'pg/numeric@1' },
                    createdAt: { codecId: 'pg/timestamptz-temporal@1' },
                    payload: { codecId: 'pg/json@1' },
                    document: { codecId: 'pg/jsonb@1' },
                    raw: { codecId: 'pg/bytea@1' },
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
