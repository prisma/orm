import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';

const precision = [
  { kind: 'number', name: 'precision', integer: true, minimum: 0, optional: true },
] as const;
const precisionParam = { precision: { kind: 'arg', index: 0 } } as const;
const length = [
  { kind: 'number', name: 'length', integer: true, minimum: 1, optional: true },
] as const;
const lengthParam = { length: { kind: 'arg', index: 0 } } as const;

/**
 * The adapter's type constructors for each type name `contract infer` writes, without their
 * documentation. The adapter sits above this package, so the infer tests restate them here, and
 * `adapter-postgres/test/inferred-type-constructors.test.ts` fails if the two disagree.
 */
export const adapterTypeConstructors = {
  String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1', nativeType: 'text' } },
  Boolean: { kind: 'typeConstructor', output: { codecId: 'pg/bool@1', nativeType: 'bool' } },
  Int: { kind: 'typeConstructor', output: { codecId: 'pg/int4@1', nativeType: 'int4' } },
  SmallInt: { kind: 'typeConstructor', output: { codecId: 'pg/int2@1', nativeType: 'int2' } },
  BigInt: { kind: 'typeConstructor', output: { codecId: 'pg/int8@1', nativeType: 'int8' } },
  Float: { kind: 'typeConstructor', output: { codecId: 'pg/float8@1', nativeType: 'float8' } },
  Real: { kind: 'typeConstructor', output: { codecId: 'pg/float4@1', nativeType: 'float4' } },
  Numeric: {
    kind: 'typeConstructor',
    args: [
      {
        kind: 'number',
        name: 'precision',
        integer: true,
        minimum: 1,
        maximum: 1000,
        optional: true,
      },
      {
        kind: 'number',
        name: 'scale',
        integer: true,
        minimum: -1000,
        maximum: 1000,
        optional: true,
      },
    ],
    output: {
      codecId: 'pg/numeric@1',
      nativeType: 'numeric',
      typeParams: { precision: { kind: 'arg', index: 0 }, scale: { kind: 'arg', index: 1 } },
    },
  },
  Timestamp: {
    kind: 'typeConstructor',
    args: precision,
    output: {
      codecId: 'pg/timestamp-temporal@1',
      nativeType: 'timestamp',
      typeParams: precisionParam,
    },
  },
  Timestamptz: {
    kind: 'typeConstructor',
    args: precision,
    output: {
      codecId: 'pg/timestamptz-temporal@1',
      nativeType: 'timestamptz',
      typeParams: precisionParam,
    },
  },
  Date: { kind: 'typeConstructor', output: { codecId: 'pg/date-temporal@1', nativeType: 'date' } },
  Time: {
    kind: 'typeConstructor',
    args: precision,
    output: { codecId: 'pg/time-temporal@1', nativeType: 'time', typeParams: precisionParam },
  },
  Timetz: {
    kind: 'typeConstructor',
    args: precision,
    output: { codecId: 'pg/timetz@1', nativeType: 'timetz', typeParams: precisionParam },
  },
  Json: { kind: 'typeConstructor', output: { codecId: 'pg/json@1', nativeType: 'json' } },
  Jsonb: { kind: 'typeConstructor', output: { codecId: 'pg/jsonb@1', nativeType: 'jsonb' } },
  Bytes: { kind: 'typeConstructor', output: { codecId: 'pg/bytea@1', nativeType: 'bytea' } },
  Uuid: { kind: 'typeConstructor', output: { codecId: 'pg/uuid@1', nativeType: 'uuid' } },
  Inet: { kind: 'typeConstructor', output: { codecId: 'pg/inet@1', nativeType: 'inet' } },
  VarChar: {
    kind: 'typeConstructor',
    args: length,
    output: { codecId: 'sql/varchar@1', nativeType: 'character varying', typeParams: lengthParam },
  },
  Char: {
    kind: 'typeConstructor',
    args: length,
    output: { codecId: 'sql/char@1', nativeType: 'character', typeParams: lengthParam },
  },
} as const satisfies AuthoringTypeNamespace;
