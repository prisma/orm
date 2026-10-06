import type { PslTypeMap } from '@internal/family-sql/psl-build';
import {
  type AuthoringTypeConstructorCall,
  type AuthoringTypeNamespace,
  findAuthoringTypeConstructorCall,
} from '@internal/framework-components/authoring';
import type { DataTypeLookup } from '@internal/framework-components/codec';
import type { PslTypeConstructorCall } from '@internal/framework-components/psl-ast';
import {
  dataTypeParams,
  isSqlDataType,
  unquotedSqlBaseName,
} from '@internal/sql-contract/data-type';
import type { StorageColumn } from '@internal/sql-contract/types';
import { PG_ENUM_CODEC_ID } from '../codec-ids';
import { positionalArg, SYNTHETIC_SPAN } from '../psl-build/psl-literals';
import { refuseColumnWithoutPslType, refuseUnwritableTypeArgument } from './refusals';

/** The PSL type position of one column: a bare name, or a type-constructor call. */
export interface PslColumnType {
  readonly typeName: string;
  readonly typeConstructor?: PslTypeConstructorCall;
}

/**
 * The type arguments a native type takes, in the order the PSL type
 * constructor declares them.
 */
const TYPE_PARAM_ORDER = ['length', 'precision', 'scale'] as const;

/** The name of the column's data type without parameters, as the type map knows it. */
function baseTypeName(
  column: StorageColumn,
  dataTypeLookup: DataTypeLookup,
  coordinate: string,
): string {
  const dataType = dataTypeLookup.get(column.dataType);
  if (dataType === undefined || !isSqlDataType(dataType)) {
    return refuseColumnWithoutPslType(column, coordinate);
  }
  return unquotedSqlBaseName(dataType, dataTypeParams(dataType, column.typeParams));
}

/**
 * Re-composes the parenthesised native type the type map resolves
 * (`numeric(10,2)`) from a column's base type name and its type parameters.
 */
function typeMapText(column: StorageColumn, baseName: string): string {
  const args = TYPE_PARAM_ORDER.map((key) => column.typeParams?.[key]).filter(
    (value) => typeof value === 'number',
  );
  return args.length === 0 ? baseName : `${baseName}(${args.join(', ')})`;
}

/** A type argument as PSL writes it: a number as written, a string between quotes. */
function typeArgumentText(value: unknown, coordinate: string): string {
  if (typeof value !== 'string') return String(value);
  refuseUnwritableTypeArgument(value, coordinate);
  return `"${value}"`;
}

function typeCall(path: readonly string[], args: readonly string[]): PslColumnType {
  const name = path.join('.');
  const isNamespaced = path.length > 1;
  if (args.length === 0 && !isNamespaced) {
    return { typeName: name };
  }
  return {
    typeName: name,
    typeConstructor: {
      kind: 'typeConstructor',
      path,
      args: args.map(positionalArg),
      span: SYNTHETIC_SPAN,
    },
  };
}

/**
 * The call to the type constructor the type map `contract infer` uses names for the column's native
 * type, when the stack's constructor of that name produces exactly the column's codec, native type
 * and type parameters.
 */
function typeMapCall(
  column: StorageColumn,
  baseName: string,
  typeMap: PslTypeMap,
  authoringTypes: AuthoringTypeNamespace,
): AuthoringTypeConstructorCall | undefined {
  const resolution = typeMap.resolve(typeMapText(column, baseName));
  if ('unsupported' in resolution) return undefined;
  const { name } = resolution.pslType;
  const descriptor = authoringTypes[name];
  return descriptor === undefined
    ? undefined
    : findAuthoringTypeConstructorCall({ [name]: descriptor }, column);
}

/**
 * The PSL type position for a storage column: a call to a type constructor the configured stack
 * contributes that produces exactly the column's codec, native type and type parameters. The
 * constructor the type map `contract infer` uses names for the native type comes first; otherwise
 * the first one in the stack that produces them, such as `DateTime` for a `timestamptz` column read
 * as a `Temporal.Instant`, or `pgvector.Vector(3)`. An enum-typed column takes the
 * `pg.enum(<Block>)` constructor, named after the value set the column points at; a column typed by
 * a domain enum takes that enum's name. A column no PSL type reads back is refused.
 */
export function buildColumnType(input: {
  readonly column: StorageColumn;
  readonly typeMap: PslTypeMap;
  readonly authoringTypes: AuthoringTypeNamespace;
  readonly dataTypeLookup: DataTypeLookup;
  readonly enumBlockNames: ReadonlyMap<string, string>;
  readonly coordinate: string;
}): PslColumnType {
  const { column, typeMap, authoringTypes, enumBlockNames, coordinate } = input;
  const baseName = baseTypeName(column, input.dataTypeLookup, coordinate);

  const enumBlockName = column.valueSet?.entityName ?? enumBlockNames.get(baseName);
  if (column.codecId === PG_ENUM_CODEC_ID && enumBlockName !== undefined) {
    return {
      typeName: enumBlockName,
      typeConstructor: {
        kind: 'typeConstructor',
        path: ['pg', 'enum'],
        args: [positionalArg(enumBlockName)],
        span: SYNTHETIC_SPAN,
      },
    };
  }

  const domainEnumName = column.valueSet?.entityName;
  if (domainEnumName !== undefined) {
    return { typeName: domainEnumName };
  }

  const call =
    typeMapCall(column, baseName, typeMap, authoringTypes) ??
    findAuthoringTypeConstructorCall(authoringTypes, column);
  if (call !== undefined) {
    return typeCall(
      call.path,
      call.args.map((value) => typeArgumentText(value, coordinate)),
    );
  }

  refuseColumnWithoutPslType(column, coordinate);
}
