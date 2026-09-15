import type { PslTypeConstructorCall } from '@internal/framework-components/psl-ast';
import type { StorageColumn } from '@internal/sql-contract/types';
import { InternalError } from '@internal/utils/internal-error';
import { positionalArg, SYNTHETIC_SPAN } from '../psl-infer/psl-literals';

export interface PrintedFieldType {
  readonly typeName: string;
  readonly typeConstructor?: PslTypeConstructorCall;
}

/**
 * The Prisma 8 type constructor that produces each Postgres codec, with the
 * `typeParams` keys that become its positional arguments, in order. This is
 * the inverse of the target's authoring type namespace: interpreting the
 * printed constructor yields the same `codecId`, `nativeType`, and
 * `typeParams`.
 */
const CONSTRUCTOR_BY_CODEC_ID: Readonly<
  Record<string, { name: string; params: readonly string[] }>
> = {
  'pg/text@1': { name: 'String', params: [] },
  'pg/bool@1': { name: 'Boolean', params: [] },
  'pg/int4@1': { name: 'Int', params: [] },
  'pg/int8@1': { name: 'BigInt', params: [] },
  'pg/float8@1': { name: 'Float', params: [] },
  'pg/bytea@1': { name: 'Bytes', params: [] },
  'pg/jsonb@1': { name: 'Jsonb', params: [] },
  'pg/json@1': { name: 'Json', params: [] },
  'pg/uuid@1': { name: 'Uuid', params: [] },
  'pg/inet@1': { name: 'Inet', params: [] },
  'pg/int2@1': { name: 'SmallInt', params: [] },
  'pg/float4@1': { name: 'Real', params: [] },
  'pg/date-temporal@1': { name: 'Date', params: [] },
  'pg/numeric@1': { name: 'Numeric', params: ['precision', 'scale'] },
  'pg/timestamp-temporal@1': { name: 'Timestamp', params: ['precision'] },
  'pg/timestamptz-temporal@1': { name: 'Timestamptz', params: ['precision'] },
  'pg/time-temporal@1': { name: 'Time', params: ['precision'] },
  'pg/timetz@1': { name: 'Timetz', params: ['precision'] },
  'sql/varchar@1': { name: 'VarChar', params: ['length'] },
  'sql/char@1': { name: 'Char', params: ['length'] },
};

export const PG_ENUM_CODEC_ID = 'pg/enum@1';

export function printColumnType(
  column: StorageColumn,
  enumHandleByTypeName: ReadonlyMap<string, string>,
  label: string,
): PrintedFieldType {
  if (column.codecId === PG_ENUM_CODEC_ID) {
    const typeName = column.typeParams?.['typeName'];
    const handle = typeof typeName === 'string' ? enumHandleByTypeName.get(typeName) : undefined;
    if (handle === undefined) {
      throw new InternalError(
        `${label}: enum column type "${String(typeName)}" has no native_enum block in its namespace`,
      );
    }
    return {
      typeName: handle,
      typeConstructor: {
        kind: 'typeConstructor',
        path: ['pg', 'enum'],
        args: [positionalArg(handle)],
        span: SYNTHETIC_SPAN,
      },
    };
  }
  const spelling = CONSTRUCTOR_BY_CODEC_ID[column.codecId];
  if (spelling === undefined) {
    throw new InternalError(
      `${label}: codec "${column.codecId}" (native type "${column.nativeType}") has no Prisma 8 PSL spelling`,
    );
  }
  const args: string[] = [];
  const unconsumed = new Set(Object.keys(column.typeParams ?? {}));
  for (const param of spelling.params) {
    const value = column.typeParams?.[param];
    if (value === undefined) break;
    args.push(String(value));
    unconsumed.delete(param);
  }
  if (unconsumed.size > 0) {
    throw new InternalError(
      `${label}: type params ${[...unconsumed].map((key) => `"${key}"`).join(', ')} of codec "${column.codecId}" have no place in the "${spelling.name}" constructor`,
    );
  }
  if (args.length === 0) return { typeName: spelling.name };
  return {
    typeName: spelling.name,
    typeConstructor: {
      kind: 'typeConstructor',
      path: [spelling.name],
      args: args.map(positionalArg),
      span: SYNTHETIC_SPAN,
    },
  };
}

/** The codec a `temporal.<preset>(…, onCreate: now, onUpdate: now)` preset produces, keyed by generator id. */
export const TEMPORAL_PRESET_BY_GENERATOR_ID: Readonly<
  Record<string, { readonly preset: string; readonly codecId: string }>
> = {
  plainDateTimeNow: { preset: 'timestamp', codecId: 'pg/timestamp-temporal@1' },
  instantNow: { preset: 'timestamptz', codecId: 'pg/timestamptz-temporal@1' },
};
