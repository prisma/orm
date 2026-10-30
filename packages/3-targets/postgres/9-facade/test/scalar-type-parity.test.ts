import postgresAdapter from '@internal/adapter-postgres/control';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { createControlStack } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';

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
  createdAt TimestamptzTemporal
  payload   Json
  document  Jsonb
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
      Json: { codecId: 'pg/json@1' },
      Jsonb: { codecId: 'pg/jsonb@1' },
      Bytes: { codecId: 'pg/bytea@1' },
      VarChar: { codecId: 'sql/varchar@1' },
      Char: { codecId: 'sql/char@1' },
      Numeric: { codecId: 'pg/numeric@1' },
      TimestampTemporal: { codecId: 'pg/timestamp-temporal@1' },
      TimestamptzTemporal: { codecId: 'pg/timestamptz-temporal@1' },
      TimeTemporal: { codecId: 'pg/time-temporal@1' },
      Timetz: { codecId: 'pg/timetz@1' },
      Uuid: { codecId: 'pg/uuid@1' },
      SmallInt: { codecId: 'pg/int2@1' },
      Real: { codecId: 'pg/float4@1' },
      DateTemporal: { codecId: 'pg/date-temporal@1' },
      DateString: { codecId: 'pg/date-string@1' },
      TimestampString: { codecId: 'pg/timestamp-string@1' },
      TimestamptzString: { codecId: 'pg/timestamptz-string@1' },
      TimestamptzJsDate: { codecId: 'pg/timestamptz-date@1' },
      TimeString: { codecId: 'pg/time-string@1' },
      Bit: { codecId: 'pg/bit@1' },
      VarBit: { codecId: 'pg/varbit@1' },
      Xml: { codecId: 'pg/xml@1' },
      Oid: { codecId: 'pg/oid@1' },
      Money: { codecId: 'pg/money@1' },
      IntervalParts: { codecId: 'pg/interval@1' },
      IntervalString: { codecId: 'pg/interval-string@1' },
      TimestampJsDate: { codecId: 'pg/timestamp-date@1' },
      TimestampInstant: { codecId: 'pg/timestamp-instant@1' },
      DateTime: { codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } },
      Date: { codecId: 'pg/date-string@1' },
      Time: { codecId: 'pg/time-string@1' },
      Duration: { codecId: 'pg/interval-string@1' },
    });
  });

  it('exposes the derived scalar names as controlStack.scalarTypes', () => {
    expect([...stack.scalarTypes].sort()).toEqual([
      'BigInt',
      'BigIntNumber',
      'Bit',
      'Boolean',
      'Bytes',
      'Char',
      'Date',
      'DateString',
      'DateTemporal',
      'DateTime',
      'Decimal',
      'Duration',
      'Float',
      'Inet',
      'Int',
      'IntervalParts',
      'IntervalString',
      'Json',
      'Jsonb',
      'Money',
      'Numeric',
      'Oid',
      'Real',
      'SmallInt',
      'String',
      'Time',
      'TimeString',
      'TimeTemporal',
      'TimestampInstant',
      'TimestampJsDate',
      'TimestampString',
      'TimestampTemporal',
      'TimestamptzJsDate',
      'TimestamptzString',
      'TimestamptzTemporal',
      'Timetz',
      'UnboundedInt',
      'Uuid',
      'VarBit',
      'VarChar',
      'Xml',
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
