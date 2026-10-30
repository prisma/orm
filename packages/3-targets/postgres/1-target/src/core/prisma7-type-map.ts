import { inferredTypeConstructors } from '@internal/family-sql/psl-build';
import { authoringTypeConstructorArguments } from '@internal/framework-components/authoring';
import { createDataTypeLookup, type DataTypeId } from '@internal/framework-components/codec';
import type { SqlTypeParams } from '@internal/sql-contract/data-type';
import { InternalError } from '@internal/utils/internal-error';
import {
  pgBit,
  pgBool,
  pgBytea,
  pgChar,
  pgDate,
  pgFloat4,
  pgFloat8,
  pgInet,
  pgInt2,
  pgInt4,
  pgInt8,
  pgJson,
  pgJsonb,
  pgMoney,
  pgNumeric,
  pgOid,
  pgText,
  pgTime,
  pgTimestamp,
  pgTimestamptz,
  pgTimetz,
  pgUuid,
  pgVarbit,
  pgVarchar,
  pgXml,
  postgresDataTypes,
} from './data-types';
import { postgresCodecDescriptorRegistry } from './registry';
import { postgresScalarAndNativeTypeConstructors } from './type-constructors';

/** A Prisma 8 constructor call: its path and the values of its arguments. */
export interface ConstructorCall {
  readonly constructorPath: readonly string[];
  readonly args: readonly unknown[];
}

/** The data type and parameters of the column Prisma 7 creates. */
export interface Prisma7ColumnType {
  readonly dataType: DataTypeId;
  readonly params: SqlTypeParams;
}

const of = (type: { readonly id: DataTypeId }, params: SqlTypeParams = {}): Prisma7ColumnType => ({
  dataType: type.id,
  params,
});

/**
 * What Prisma 7.10.0 creates in Postgres for each Prisma 7 scalar and `@db.*` native type, as a data type and its parameters. Derived from the SQL recorded in `test/integration/test/fixtures/prisma7-source/reference/migration.sql`. A `@db.*` attribute's own arguments replace the parameters; without any, the column gets these, so `@db.Char` is the `character(1)` Postgres stores for Prisma 7's `CHAR`, and `@db.Bit` the `bit(1)` it stores for `BIT`.
 */
export const prisma7PostgresTypes = {
  scalars: {
    String: of(pgText),
    Boolean: of(pgBool),
    Int: of(pgInt4),
    BigInt: of(pgInt8),
    Float: of(pgFloat8),
    Decimal: of(pgNumeric, { precision: 65, scale: 30 }),
    DateTime: of(pgTimestamp, { precision: 3 }),
    Json: of(pgJsonb),
    Bytes: of(pgBytea),
  },
  nativeTypes: {
    Text: of(pgText),
    VarChar: of(pgVarchar),
    Char: of(pgChar, { length: 1 }),
    Uuid: of(pgUuid),
    Inet: of(pgInet),
    Boolean: of(pgBool),
    Integer: of(pgInt4),
    SmallInt: of(pgInt2),
    BigInt: of(pgInt8),
    Real: of(pgFloat4),
    DoublePrecision: of(pgFloat8),
    Decimal: of(pgNumeric),
    Timestamp: of(pgTimestamp),
    Timestamptz: of(pgTimestamptz),
    Date: of(pgDate),
    Time: of(pgTime),
    Timetz: of(pgTimetz),
    Json: of(pgJson),
    JsonB: of(pgJsonb),
    ByteA: of(pgBytea),
    Bit: of(pgBit, { length: 1 }),
    VarBit: of(pgVarbit),
    Xml: of(pgXml),
    Oid: of(pgOid),
    Money: of(pgMoney),
  },
} as const;

const marked = inferredTypeConstructors({
  authoringTypes: postgresScalarAndNativeTypeConstructors,
  codecLookup: postgresCodecDescriptorRegistry,
  dataTypeLookup: createDataTypeLookup(postgresDataTypes),
});

/**
 * The constructor marked `inferred` for the column's data type, with every parameter Prisma 7 gives the column as an argument. The reader builds a contract, so it keeps each parameter rather than the fewest arguments printed PSL writes.
 */
function mappingOf({ dataType, params }: Prisma7ColumnType): ConstructorCall {
  const markedConstructor = marked.get(dataType);
  const args =
    markedConstructor === undefined
      ? undefined
      : authoringTypeConstructorArguments(markedConstructor.descriptor, {
          codecId: markedConstructor.descriptor.output.codecId,
          typeParams: params,
        });
  if (markedConstructor === undefined || args === undefined) {
    throw new InternalError(
      `No constructor marked inferred writes ${dataType} with these parameters.`,
    );
  }
  return { constructorPath: markedConstructor.path, args };
}

function mappingsOf(
  types: Readonly<Record<string, Prisma7ColumnType>>,
): Readonly<Record<string, ConstructorCall>> {
  return Object.fromEntries(Object.entries(types).map(([name, type]) => [name, mappingOf(type)]));
}

/**
 * The `@db.*` types of a PostgreSQL extension, with the extension that provides each. The binding names the pack that declares the extension; the target does not depend on it, and the reader uses the constructor only when the config composes the pack.
 */
const prisma7PostgresExtensionNativeTypes = {
  Citext: { constructorPath: ['citext', 'Citext'], args: [], extension: 'citext' },
} as const;

/** {@link prisma7PostgresTypes} as the Prisma 7 reader takes it: each type's constructor call. */
export const prisma7PostgresTypeMap = {
  scalars: mappingsOf(prisma7PostgresTypes.scalars),
  nativeTypes: mappingsOf(prisma7PostgresTypes.nativeTypes),
  extensionNativeTypes: prisma7PostgresExtensionNativeTypes,
};

/** The Prisma 7 `@db.*` names whose Prisma 8 constructor has another name, such as `Text` to `String`. */
export const prisma7PostgresRenamedNativeTypes: Readonly<Record<string, string>> =
  Object.fromEntries(
    Object.entries({
      ...prisma7PostgresTypeMap.nativeTypes,
      ...prisma7PostgresTypeMap.extensionNativeTypes,
    }).flatMap(([name, { constructorPath }]) => {
      const constructorName = constructorPath.join('.');
      return constructorName === name ? [] : [[name, constructorName]];
    }),
  );
