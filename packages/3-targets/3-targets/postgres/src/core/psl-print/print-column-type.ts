import type { PslTypeMap } from '@internal/family-sql/psl-infer';
import {
  type AuthoringTypeConstructorDescriptor,
  type AuthoringTypeNamespace,
  instantiateAuthoringTypeConstructor,
  isAuthoringArgRef,
  isAuthoringTypeConstructorDescriptor,
} from '@internal/framework-components/authoring';
import type { PslTypeConstructorCall } from '@internal/framework-components/psl-ast';
import type { StorageColumn } from '@internal/sql-contract/types';
import { postgresError } from '../errors';
import { CODEC_ID_BY_PRINTED_TYPE } from '../psl-infer/infer-default-codec';
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

function* typeConstructors(
  namespace: AuthoringTypeNamespace,
  path: readonly string[] = [],
): Generator<{
  readonly path: readonly string[];
  readonly descriptor: AuthoringTypeConstructorDescriptor;
}> {
  for (const [name, value] of Object.entries(namespace)) {
    if (isAuthoringTypeConstructorDescriptor(value)) {
      yield { path: [...path, name], descriptor: value };
    } else {
      yield* typeConstructors(value, [...path, name]);
    }
  }
}

function sameTypeParams(
  left: Readonly<Record<string, unknown>> | undefined,
  right: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {});
}

/**
 * The positional arguments that make `descriptor` produce exactly the column's
 * codec, native type and type parameters, when each parameter comes straight
 * from one argument; `undefined` when the constructor cannot produce them.
 */
function argumentsFor(
  descriptor: AuthoringTypeConstructorDescriptor,
  column: StorageColumn,
): readonly unknown[] | undefined {
  if (descriptor.entityRefArg !== undefined || descriptor.output.codecId !== column.codecId) {
    return undefined;
  }
  const args: unknown[] = [];
  for (const [key, template] of Object.entries(descriptor.output.typeParams ?? {})) {
    const value = column.typeParams?.[key];
    if (value !== undefined && isAuthoringArgRef(template) && template.path === undefined) {
      args[template.index] = value;
    }
  }
  if (args.some((value) => value === undefined)) return undefined;
  try {
    const produced = instantiateAuthoringTypeConstructor(descriptor, args);
    return produced.nativeType === column.nativeType &&
      sameTypeParams(produced.typeParams, column.typeParams)
      ? args
      : undefined;
  } catch {
    return undefined;
  }
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
 * The PSL type position for a storage column. The native type's default PSL
 * type, from the type map `contract infer` uses, is written when it reads back
 * with the column's codec. Otherwise the first type constructor the configured
 * stack contributes that produces exactly the column's codec, native type and
 * type parameters is written, such as `TimestamptzString(3)` for a
 * `timestamptz` column carried as text, or `pgvector.Vector(3)`. An enum-typed
 * column takes the `pg.enum(<Block>)` constructor, named after the value set
 * the column points at; a column typed by a domain enum takes that enum's name.
 * A column no PSL type reads back is refused.
 */
export function printColumnType(input: {
  readonly column: StorageColumn;
  readonly typeMap: PslTypeMap;
  readonly authoringTypes: AuthoringTypeNamespace;
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

  const domainEnumName = column.valueSet?.entityName;
  if (domainEnumName !== undefined) {
    return { typeName: domainEnumName };
  }

  const resolution = typeMap.resolve(nativeTypeText(column));
  if (
    !('unsupported' in resolution) &&
    CODEC_ID_BY_PRINTED_TYPE.get(resolution.pslType.name) === column.codecId
  ) {
    return typeCall([resolution.pslType.name], resolution.pslType.args ?? []);
  }

  for (const { path, descriptor } of typeConstructors(input.authoringTypes)) {
    const args = argumentsFor(descriptor, column);
    if (args !== undefined) {
      return typeCall(
        path,
        args.map((value) => (typeof value === 'string' ? JSON.stringify(value) : String(value))),
      );
    }
  }

  throw postgresError(
    'CONTRACT.PRINT_UNSUPPORTED',
    `contract print: column ${coordinate} has native type "${column.nativeType}" with codec "${column.codecId}", and no PSL type in the configured stack produces that pair.`,
    {
      why: 'A column is written as a PSL type that reads back with its codec and native type, and none of the types the target, adapter and extensions contribute does.',
      fix: 'Add the extension that contributes this type to the config, or keep authoring this contract in its current source.',
      meta: { coordinate, nativeType: column.nativeType, codecId: column.codecId },
    },
  );
}
