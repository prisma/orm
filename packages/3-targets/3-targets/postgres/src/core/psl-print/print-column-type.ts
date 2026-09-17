import type { PslTypeMap } from '@internal/family-sql/psl-infer';
import type { PslTypeConstructorCall } from '@internal/framework-components/psl-ast';
import type { StorageColumn } from '@internal/sql-contract/types';
import { postgresError } from '../errors';
import { positionalArg, SYNTHETIC_SPAN } from '../psl-infer/psl-literals';

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

/**
 * The PSL type position for a storage column, from the reverse of the type map
 * `contract infer` uses. An enum-typed column takes the `pg.enum(<Block>)`
 * constructor, named after the value set the column points at.
 */
export function printColumnType(input: {
  readonly column: StorageColumn;
  readonly typeMap: PslTypeMap;
  readonly enumBlockNames: ReadonlyMap<string, string>;
  readonly coordinate: string;
}): PslColumnType {
  const { column, typeMap, enumBlockNames, coordinate } = input;

  const enumBlockName = column.valueSet?.entityName ?? enumBlockNames.get(column.nativeType);
  if (column.codecId === 'pg/enum@1' && enumBlockName !== undefined) {
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

  const resolution = typeMap.resolve(nativeTypeText(column));
  if ('unsupported' in resolution) {
    throw postgresError(
      'CONTRACT.CONVERT_UNSUPPORTED',
      `contract convert: column ${coordinate} has native type "${column.nativeType}", which cannot be written in Prisma 8 PSL.`,
      {
        why: 'The Postgres contract-to-PSL printer maps each native type back to the PSL type that produces it; this one is not in that map.',
        fix: 'Retype the column, or author the Prisma 8 contract by hand.',
        meta: { coordinate, nativeType: column.nativeType },
      },
    );
  }

  const { name, args } = resolution.pslType;
  if (args === undefined) {
    return { typeName: name };
  }
  return {
    typeName: name,
    typeConstructor: {
      kind: 'typeConstructor',
      path: [name],
      args: args.map(positionalArg),
      span: SYNTHETIC_SPAN,
    },
  };
}
