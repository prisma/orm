import postgresAdapter from '@internal/adapter-postgres/control';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import {
  collectScalarTypeConstructors,
  type ScalarTypeConstructorOutput,
} from '@internal/framework-components/authoring';
import { createControlStack } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
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
  createdAt DateTime
  payload   Json
  document  Jsonb
  raw       Bytes
}
`;

function emit(scalarColumnDescriptors: ReadonlyMap<string, ScalarTypeConstructorOutput>) {
  const { document, sourceFile } = parse(REPRESENTATIVE_SCHEMA);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    target: postgresPackRef,
    scalarColumnDescriptors,
    authoringContributions: stack.authoringContributions,
    controlMutationDefaults: stack.controlMutationDefaults,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    codecLookup: stack.codecLookup,
    capabilities: stack.capabilities,
  });
}

describe('postgres scalar types derived from the unified namespace', () => {
  it('pins every bare-eligible scalar to its zero-arg instantiation', () => {
    const derived = collectScalarTypeConstructors(stack.authoringContributions.type);

    expect(Object.fromEntries(derived)).toEqual({
      String: { codecId: 'pg/text@1', nativeType: 'text' },
      Boolean: { codecId: 'pg/bool@1', nativeType: 'bool' },
      Int: { codecId: 'pg/int4@1', nativeType: 'int4' },
      BigInt: { codecId: 'pg/int8@1', nativeType: 'int8' },
      BigIntNumber: { codecId: 'pg/int8number@1', nativeType: 'int8' },
      UnboundedInt: { codecId: 'pg/unboundedint@1', nativeType: 'numeric' },
      Float: { codecId: 'pg/float8@1', nativeType: 'float8' },
      Inet: { codecId: 'pg/inet@1', nativeType: 'inet' },
      Decimal: { codecId: 'pg/numeric@1', nativeType: 'numeric' },
      DateTime: { codecId: 'pg/timestamptz-temporal@1', nativeType: 'timestamptz' },
      Json: { codecId: 'pg/json@1', nativeType: 'json' },
      Jsonb: { codecId: 'pg/jsonb@1', nativeType: 'jsonb' },
      Bytes: { codecId: 'pg/bytea@1', nativeType: 'bytea' },
      VarChar: { codecId: 'sql/varchar@1', nativeType: 'character varying' },
      Char: { codecId: 'sql/char@1', nativeType: 'character' },
      Numeric: { codecId: 'pg/numeric@1', nativeType: 'numeric' },
      Timestamp: { codecId: 'pg/timestamp-temporal@1', nativeType: 'timestamp' },
      Timestamptz: { codecId: 'pg/timestamptz-temporal@1', nativeType: 'timestamptz' },
      Time: { codecId: 'pg/time-temporal@1', nativeType: 'time' },
      Timetz: { codecId: 'pg/timetz@1', nativeType: 'timetz' },
      Uuid: { codecId: 'pg/uuid@1', nativeType: 'uuid' },
      SmallInt: { codecId: 'pg/int2@1', nativeType: 'int2' },
      Real: { codecId: 'pg/float4@1', nativeType: 'float4' },
      Date: { codecId: 'pg/date-temporal@1', nativeType: 'date' },
      DateString: { codecId: 'pg/date-string@1', nativeType: 'date' },
      TimestampString: { codecId: 'pg/timestamp-string@1', nativeType: 'timestamp' },
      TimestamptzString: { codecId: 'pg/timestamptz-string@1', nativeType: 'timestamptz' },
      TimeString: { codecId: 'pg/time-string@1', nativeType: 'time' },
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
      'TimestamptzString',
      'Timetz',
      'UnboundedInt',
      'Uuid',
      'VarChar',
    ]);
  });

  it('emits a contract whose columns pin the namespace-derived {codecId, nativeType}', () => {
    const result = emit(collectScalarTypeConstructors(stack.authoringContributions.type));

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
                    id: { codecId: 'pg/int4@1', nativeType: 'int4' },
                    name: { codecId: 'pg/text@1', nativeType: 'text' },
                    active: { codecId: 'pg/bool@1', nativeType: 'bool' },
                    big: { codecId: 'pg/int8@1', nativeType: 'int8' },
                    bounded: { codecId: 'pg/int8number@1', nativeType: 'int8' },
                    unbounded: { codecId: 'pg/unboundedint@1', nativeType: 'numeric' },
                    ratio: { codecId: 'pg/float8@1', nativeType: 'float8' },
                    price: { codecId: 'pg/numeric@1', nativeType: 'numeric' },
                    createdAt: { codecId: 'pg/timestamptz-temporal@1', nativeType: 'timestamptz' },
                    payload: { codecId: 'pg/json@1', nativeType: 'json' },
                    document: { codecId: 'pg/jsonb@1', nativeType: 'jsonb' },
                    raw: { codecId: 'pg/bytea@1', nativeType: 'bytea' },
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
