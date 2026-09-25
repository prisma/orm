import type { PslTypeMap } from '@internal/family-sql/psl-ast';
import {
  type AuthoringTypeConstructorCall,
  type AuthoringTypeNamespace,
  findAuthoringTypeConstructorCall,
} from '@internal/framework-components/authoring';
import type { PslTypeConstructorCall } from '@internal/framework-components/psl-ast';
import type { StorageColumn } from '@internal/sql-contract/types';
import { PG_ENUM_CODEC_ID } from '../codec-ids';
import { positionalArg, SYNTHETIC_SPAN } from '../psl-ast/psl-literals';
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

/**
 * Re-composes the parenthesised native type the type map resolves
 * (`numeric(10,2)`) from a column's bare native type and its type parameters.
 */
function nativeTypeText(column: StorageColumn): string {
  const args = TYPE_PARAM_ORDER.map((key) => column.typeParams?.[key]).filter(
    (value) => typeof value === 'number',
  );
  return args.length === 0 ? column.nativeType : `${column.nativeType}(${args.join(', ')})`;
}

/** A type argument as PSL writes it: a number as written, a string between quotes. */
function typeArgumentText(value: unknown, coordinate: string): string {
  if (typeof value !== 'string') return String(value);
  refuseUnwritableTypeArgument(value, coordinate);
  return `"${value}"`;
}

function typeCall(path: readonly string[], args: readonly string[]): PslColumnType {
  const name = path.join('.');
  if (args.length === 0) {
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
  typeMap: PslTypeMap,
  authoringTypes: AuthoringTypeNamespace,
): AuthoringTypeConstructorCall | undefined {
  const resolution = typeMap.resolve(nativeTypeText(column));
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
 * the first one in the stack that produces them, such as `TimestamptzString(3)` for a `timestamptz`
 * column carried as text, or `pgvector.Vector(3)`. An enum-typed column takes the
 * `pg.enum(<Block>)` constructor, named after the value set the column points at; a column typed by
 * a domain enum takes that enum's name. A column no PSL type reads back is refused.
 */
export function buildColumnType(input: {
  readonly column: StorageColumn;
  readonly typeMap: PslTypeMap;
  readonly authoringTypes: AuthoringTypeNamespace;
  readonly enumBlockNames: ReadonlyMap<string, string>;
  readonly coordinate: string;
}): PslColumnType {
  const { column, typeMap, authoringTypes, enumBlockNames, coordinate } = input;

  const enumBlockName = column.valueSet?.entityName ?? enumBlockNames.get(column.nativeType);
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
    typeMapCall(column, typeMap, authoringTypes) ??
    findAuthoringTypeConstructorCall(authoringTypes, column);
  if (call !== undefined) {
    return typeCall(
      call.path,
      call.args.map((value) => typeArgumentText(value, coordinate)),
    );
  }

  refuseColumnWithoutPslType(column, coordinate);
}
