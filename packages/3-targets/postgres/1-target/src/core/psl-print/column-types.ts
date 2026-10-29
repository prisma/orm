import {
  type InferredTypeConstructors,
  type PslTypeArgument,
  writtenTypeChoiceCall,
} from '@internal/family-sql/psl-build';
import {
  type AuthoringTypeConstructorCall,
  type AuthoringTypeNamespace,
  authoringTypeConstructorArguments,
  type DataTypeSupport,
  findAuthoringTypeConstructorCall,
  getAuthoringTypeConstructor,
  writtenTypeArguments,
} from '@internal/framework-components/authoring';
import type { DataTypeLookup } from '@internal/framework-components/codec';
import { dataTypeParams } from '@internal/framework-components/codec';
import type { PslTypeConstructorCall } from '@internal/framework-components/psl-ast';
import { isSqlDataType, unquotedSqlBaseName } from '@internal/sql-contract/data-type';
import type { StorageColumn } from '@internal/sql-contract/types';
import { PG_ENUM_CODEC_ID } from '../codec-ids';
import { positionalArg, SYNTHETIC_SPAN, typeArgument } from '../psl-build/psl-literals';
import { refuseColumnWithoutPslType, refuseUnwritableTypeArgument } from './refusals';

/**
 * What a column's PSL type stands for. `dataType` is a type that stands for the column's codec and type params alone, written as a bare name such as `String` or a call such as `TimestamptzTemporal(3)`. A value object or an enum, including a native enum written `pg.enum(<Block>)`, names something more.
 */
export type PslColumnTypeKind = 'dataType' | 'valueObject' | 'enum';

/** The PSL type position of one column: its name and what it stands for, and the type-constructor call when it is written as one. */
export interface PslColumnType {
  readonly kind: PslColumnTypeKind;
  readonly typeName: string;
  readonly typeConstructor?: PslTypeConstructorCall;
}

/** The name of the column's data type without parameters. */
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

/** The arguments of `call` as PSL writes them, each a literal of its data type that reads back as the argument. */
function typeArgumentTexts(
  call: AuthoringTypeConstructorCall,
  authoringTypes: AuthoringTypeNamespace,
  dataTypes: DataTypeSupport,
  coordinate: string,
): readonly PslTypeArgument[] {
  const descriptor = getAuthoringTypeConstructor({ type: authoringTypes }, call.path);
  const written = descriptor && writtenTypeArguments(descriptor, call.args, dataTypes);
  return (
    written?.map((text) => ({ name: undefined, text })) ??
    refuseUnwritableTypeArgument(call, coordinate)
  );
}

function typeCall(path: readonly string[], args: readonly PslTypeArgument[]): PslColumnType {
  const name = path.join('.');
  const isNamespaced = path.length > 1;
  if (args.length === 0 && !isNamespaced) {
    return { kind: 'dataType', typeName: name };
  }
  return {
    kind: 'dataType',
    typeName: name,
    typeConstructor: {
      kind: 'typeConstructor',
      path,
      args: args.map(typeArgument),
      span: SYNTHETIC_SPAN,
    },
  };
}

/**
 * The call to the constructor marked `inferred` for the column's data type, the one `contract
 * infer` writes, when it produces exactly the column's codec and type parameters.
 */
function inferredConstructorCall(
  column: StorageColumn,
  inferredConstructors: InferredTypeConstructors,
): AuthoringTypeConstructorCall | undefined {
  const marked = inferredConstructors.get(column.dataType);
  const args = marked && authoringTypeConstructorArguments(marked.descriptor, column);
  return marked && args && { path: marked.path, args };
}

/**
 * The PSL type position for a storage column: a call to a type constructor the configured stack
 * contributes that produces exactly the column's codec, native type and type parameters. The
 * constructor `contract infer` writes for the column's data type comes first; otherwise
 * the first one in the stack that produces them, such as `TimestamptzTemporal` or
 * `pgvector.Vector(3)`. Where a type choice call becomes that call exactly, the type choice is
 * written instead, by name with only the arguments that differ from its defaults: `DateTime` for
 * `TimestamptzJsDate(3)`, `DateTime(as: temporal)` for `TimestamptzTemporal` (ADR 279). An enum-typed column takes the
 * `pg.enum(<Block>)` constructor, named after the value set the column points at; a column typed by
 * a domain enum takes that enum's name. A column no PSL type reads back is refused.
 */
export function buildColumnType(input: {
  readonly column: StorageColumn;
  readonly inferredConstructors: InferredTypeConstructors;
  readonly authoringTypes: AuthoringTypeNamespace;
  readonly dataTypes: DataTypeSupport;
  readonly enumBlockNames: ReadonlyMap<string, string>;
  readonly coordinate: string;
  readonly namespaceId?: string;
}): PslColumnType {
  const { column, inferredConstructors, authoringTypes, enumBlockNames, coordinate } = input;
  const baseName = baseTypeName(column, input.dataTypes.lookup, coordinate);

  const enumBlockName = column.valueSet?.entityName ?? enumBlockNames.get(baseName);
  if (column.codecId === PG_ENUM_CODEC_ID && enumBlockName !== undefined) {
    return {
      kind: 'enum',
      typeName: enumBlockName,
      typeConstructor: {
        kind: 'typeConstructor',
        path: ['pg', 'enum'],
        args: [
          positionalArg(
            column.valueSet !== undefined && column.valueSet.namespaceId !== input.namespaceId
              ? `${column.valueSet.namespaceId}.${enumBlockName}`
              : enumBlockName,
          ),
        ],
        span: SYNTHETIC_SPAN,
      },
    };
  }

  const domainEnumName = column.valueSet?.entityName;
  if (domainEnumName !== undefined) {
    return { kind: 'enum', typeName: domainEnumName };
  }

  const call =
    inferredConstructorCall(column, inferredConstructors) ??
    findAuthoringTypeConstructorCall(authoringTypes, column);
  if (call !== undefined) {
    const convenience = writtenTypeChoiceCall({
      authoringTypes,
      call,
      dataTypes: input.dataTypes,
      sameOutput: undefined,
    });
    return convenience !== undefined
      ? typeCall(convenience.path, convenience.args)
      : typeCall(call.path, typeArgumentTexts(call, authoringTypes, input.dataTypes, coordinate));
  }

  refuseColumnWithoutPslType(column, coordinate);
}
