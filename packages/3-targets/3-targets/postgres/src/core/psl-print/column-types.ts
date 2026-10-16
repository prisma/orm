import { type InferredTypeConstructors, pslTypeArgumentText } from '@internal/family-sql/psl-build';
import {
  type AuthoringTypeConstructorCall,
  type AuthoringTypeNamespace,
  authoringTypeConstructorArguments,
  findAuthoringTypeConstructorCall,
} from '@internal/framework-components/authoring';
import type { DataTypeLookup } from '@internal/framework-components/codec';
import { dataTypeParams } from '@internal/framework-components/codec';
import type { PslTypeConstructorCall } from '@internal/framework-components/psl-ast';
import { isSqlDataType, unquotedSqlBaseName } from '@internal/sql-contract/data-type';
import type { StorageColumn } from '@internal/sql-contract/types';
import { PG_ENUM_CODEC_ID } from '../codec-ids';
import { positionalArg, SYNTHETIC_SPAN } from '../psl-build/psl-literals';
import { refuseColumnWithoutPslType, refuseUnwritableTypeArgument } from './refusals';

/** The PSL type position of one column: a bare name, or a type-constructor call. */
export interface PslColumnType {
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

/** A type argument as PSL writes it: a number as written, a string between quotes. */
function typeArgumentText(value: unknown, coordinate: string): string {
  return pslTypeArgumentText(value) ?? refuseUnwritableTypeArgument(String(value), coordinate);
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
 * the first one in the stack that produces them, such as `DateTime` for a `timestamptz` column read
 * as a `Temporal.Instant`, or `pgvector.Vector(3)`. An enum-typed column takes the
 * `pg.enum(<Block>)` constructor, named after the value set the column points at; a column typed by
 * a domain enum takes that enum's name. A column no PSL type reads back is refused.
 */
export function buildColumnType(input: {
  readonly column: StorageColumn;
  readonly inferredConstructors: InferredTypeConstructors;
  readonly authoringTypes: AuthoringTypeNamespace;
  readonly dataTypeLookup: DataTypeLookup;
  readonly enumBlockNames: ReadonlyMap<string, string>;
  readonly coordinate: string;
  readonly namespaceId?: string;
}): PslColumnType {
  const { column, inferredConstructors, authoringTypes, enumBlockNames, coordinate } = input;
  const baseName = baseTypeName(column, input.dataTypeLookup, coordinate);

  const enumBlockName = column.valueSet?.entityName ?? enumBlockNames.get(baseName);
  if (column.codecId === PG_ENUM_CODEC_ID && enumBlockName !== undefined) {
    return {
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
    return { typeName: domainEnumName };
  }

  const call =
    inferredConstructorCall(column, inferredConstructors) ??
    findAuthoringTypeConstructorCall(authoringTypes, column);
  if (call !== undefined) {
    return typeCall(
      call.path,
      call.args.map((value) => typeArgumentText(value, coordinate)),
    );
  }

  refuseColumnWithoutPslType(column, coordinate);
}
