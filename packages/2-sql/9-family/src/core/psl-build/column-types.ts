import type { DataType } from '@internal/framework-components/codec';
import { resolveReportedSqlType } from '@internal/sql-contract/data-type';
import type { ReportedSqlType, SqlColumnIR } from '@internal/sql-schema-ir/types';
import { InternalError } from '@internal/utils/internal-error';
import { sqlFamilyError } from '../errors';
import {
  fewestArgumentsCall,
  type InferredTypeConstructors,
  pslTypeArgumentText,
} from './inferred-type-constructors';

/** A call to a type constructor as PSL writes it: the constructor's path and its arguments' text. */
export interface PslTypeCall {
  readonly path: readonly string[];
  readonly args: readonly string[];
}

/** The PSL type `contract infer` writes for a column that is not an enum, by table and column name. */
export type ColumnTypeOf = (tableName: string, columnName: string) => PslTypeCall;

/** One introspected table, with the schema it was read from. */
export interface IntrospectedTable {
  readonly schemaName: string;
  readonly tableName: string;
  readonly columns: readonly SqlColumnIR[];
}

/** The type the database reported for `column`, which introspection always records. */
function reportedTypeOf(column: SqlColumnIR, tableName: string): ReportedSqlType {
  if (column.reportedType === undefined) {
    throw new InternalError(
      `contract infer read column "${tableName}"."${column.name}" without the type the database reported for it.`,
    );
  }
  return column.reportedType;
}

function writtenCall(
  constructors: InferredTypeConstructors,
  dataTypes: readonly DataType[],
  reported: ReportedSqlType,
): PslTypeCall | undefined {
  const resolved = resolveReportedSqlType(reported, dataTypes);
  const marked = resolved && constructors.get(resolved.dataType);
  const call = resolved && marked && fewestArgumentsCall(marked, resolved.typeParams);
  if (call === undefined) return undefined;
  const args = call.args.map(pslTypeArgumentText);
  return args.every((arg) => arg !== undefined) ? { path: call.path, args } : undefined;
}

/**
 * The type of every column of `tables` that `isEnumColumn` does not claim: the call, with the
 * fewest arguments, to the constructor marked `inferred` for the data type that claims the
 * column's reported type. When any column has no such call, throws
 * `CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED` listing every one of them.
 */
export function inferColumnTypes(input: {
  readonly tables: readonly IntrospectedTable[];
  readonly constructors: InferredTypeConstructors;
  readonly isEnumColumn: (column: SqlColumnIR) => boolean;
}): ColumnTypeOf {
  const dataTypes = [...input.constructors.values()].map((marked) => marked.dataType);
  const types = new Map<string, PslTypeCall>();
  const unclaimed: string[] = [];
  for (const { schemaName, tableName, columns } of input.tables) {
    for (const column of columns) {
      if (input.isEnumColumn(column)) continue;
      const reported = reportedTypeOf(column, tableName);
      const call = writtenCall(input.constructors, dataTypes, reported);
      if (call === undefined) {
        unclaimed.push(
          `${schemaName}.${tableName}.${column.name}: ${reported.text}${column.many === true ? '[]' : ''}`,
        );
        continue;
      }
      types.set(JSON.stringify([tableName, column.name]), call);
    }
  }
  if (unclaimed.length > 0) {
    const columns = unclaimed.sort();
    throw sqlFamilyError(
      'CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED',
      [
        'contract infer: Prisma 8 cannot write these column types with the configured stack:',
        ...columns.map((line) => `  ${line}`),
      ].join('\n'),
      {
        why: 'Prisma 8 reads a column type only through a data type that the target or an extension pack declares.',
        fix: `No configured pack has a type for these columns. If a type comes from a database extension that has a Prisma 8 pack, add the pack to extensions in prisma.config.ts. Otherwise, to keep such a column, write the schema by hand and declare its field as Raw("<type>") with the type as listed, or change the column's type or remove the column from the database.`,
        meta: { columns },
      },
    );
  }
  return (tableName, columnName) => {
    const type = types.get(JSON.stringify([tableName, columnName]));
    if (type === undefined) {
      throw new InternalError(
        `contract infer resolved no type for "${tableName}"."${columnName}".`,
      );
    }
    return type;
  };
}
