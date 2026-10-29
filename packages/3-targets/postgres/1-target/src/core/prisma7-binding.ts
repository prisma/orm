import type { JsonValue } from '@internal/contract/types';
import { isSqlDataType, renderSqlTypeName } from '@internal/sql-contract/data-type';
import { InternalError } from '@internal/utils/internal-error';
import { postgresDataTypeEntries } from './data-type-entries';
import {
  pgBytea,
  pgDate,
  pgJson,
  pgJsonb,
  pgTime,
  pgTimestamp,
  pgTimestamptz,
  pgTimetz,
  postgresDataTypes,
} from './data-types';
import { defaultForeignKeyName, defaultPrimaryKeyName } from './default-constraint-names';
import { postgresTargetDescriptorMeta } from './descriptor-meta';
import { postgresCreateNamespace } from './postgres-schema';
import { postgresYearText } from './postgres-year-text';
import { prisma7TemporalStored, prisma7TemporalTagBody } from './prisma7-temporal-defaults';
import { prisma7PostgresTypeMap } from './prisma7-type-map';
import { junctionRelationFieldNames } from './psl-infer/junction-relation-field-names';
import { inlineLiteral } from './sql-utils';

/** The date and time types a Prisma 7 `DateTime` default can be written on. */
const DATE_TIME_TYPES: ReadonlySet<string> = new Set([
  pgTimestamp.id,
  pgTimestamptz.id,
  pgDate.id,
  pgTime.id,
  pgTimetz.id,
]);

const ENTRIES = postgresDataTypeEntries();

/** The tag the authoring entry of `dataType` writes its values with. */
function tagOf(dataType: string): string | undefined {
  const written = ENTRIES[dataType]?.written;
  return written?.kind === 'tag' ? written.tag : undefined;
}

/** A date or time column without a precision holds microseconds. */
function precisionOf(typeParams: Readonly<Record<string, unknown>> | undefined): number {
  const precision = typeParams?.['precision'];
  return typeof precision === 'number' ? precision : 6;
}

function base64ToHex(base64: string): string | undefined {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) return undefined;
  return `\\x${Buffer.from(base64, 'base64').toString('hex')}`;
}

/** The column's type as a migration writes it, such as `timestamp(6)`. */
function writtenTypeName(
  dataType: string,
  typeParams: Readonly<Record<string, unknown>> | undefined,
): string {
  const type = postgresDataTypes.find((candidate) => candidate.id === dataType);
  if (type === undefined || !isSqlDataType(type)) {
    throw new InternalError(`The Postgres target registers no SQL data type "${dataType}".`);
  }
  return renderSqlTypeName(type, typeParams ?? {});
}

/** The SQL expression of a literal default, written as DDL writes the value: one literal, or for a list an array of them cast to an array of the column type. A date or time is written with the year text PostgreSQL reads. */
function literalDefaultExpression(
  stored: JsonValue,
  column: {
    readonly dataType: string;
    readonly typeParams?: Readonly<Record<string, unknown>> | undefined;
  },
): string {
  const typeName = writtenTypeName(column.dataType, column.typeParams);
  const text = (value: JsonValue) =>
    typeof value === 'string' && DATE_TIME_TYPES.has(column.dataType)
      ? postgresYearText(value)
      : value;
  return Array.isArray(stored)
    ? inlineLiteral(stored.map(text), `${typeName}[]`)
    : inlineLiteral(text(stored), typeName);
}

/**
 * What the Postgres target supplies to the Prisma 7 interpreter. A `Bytes` or
 * `DateTime` default is read through the tag its column type's authoring entry
 * writes, as the current schema language reads it: a `Bytes` default's base64
 * as the hex body of `bytea`, and a `DateTime` default as the body of the date
 * or time tag that keeps what the written value means on the column.
 */
export const prisma7PostgresBinding = {
  target: postgresTargetDescriptorMeta,
  createNamespace: postgresCreateNamespace,
  providers: ['postgresql', 'postgres'],
  typeMap: prisma7PostgresTypeMap,
  nativeEnum: { entityKind: 'native_enum', typeConstructor: ['pg', 'enum'] },
  indexTypes: {
    BTree: 'btree',
    Hash: 'hash',
    Gin: 'gin',
    Gist: 'gist',
    SpGist: 'spgist',
    Brin: 'brin',
  },
  /** `NAMEDATALEN - 1`. */
  identifierMaxBytes: 63,
  defaultConstraintNames: { primaryKey: defaultPrimaryKeyName, foreignKey: defaultForeignKeyName },
  junctionRelationFieldNames,
  literalDefaultExpression,
  literalDefaultForm: ({
    dataType,
    typeParams,
  }: {
    readonly dataType: string;
    readonly typeParams?: Readonly<Record<string, unknown>> | undefined;
  }) => {
    if (dataType === pgJson.id || dataType === pgJsonb.id) return { kind: 'json' } as const;
    const tag = tagOf(dataType);
    if (tag === undefined) return undefined;
    if (dataType === pgBytea.id) return { kind: 'tag', tag, body: base64ToHex } as const;
    if (!DATE_TIME_TYPES.has(dataType)) return undefined;
    return {
      kind: 'tag',
      tag,
      body: (text: string) => prisma7TemporalTagBody(text, dataType),
      finerThanColumn: (text: string) => {
        const heldDigits = precisionOf(typeParams);
        const stored = prisma7TemporalStored(text, dataType, heldDigits);
        return stored === undefined ? undefined : { heldDigits, stored };
      },
    } as const;
  },
} as const;
