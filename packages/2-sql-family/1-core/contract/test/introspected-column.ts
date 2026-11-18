import type { DataType } from '@internal/framework-components/codec';
import type { SqlColumnIRInput } from '@internal/sql-schema-ir/types';
import { resolveReportedSqlType, resolveWrittenSqlTypes } from '../src/sql-data-type';

/** `column` as introspection builds it: the type its `reportedType` reports, or else the type its `typeText` names by any text one of `dataTypes` writes, reports or claims. */
export function introspectedColumn(
  column: SqlColumnIRInput,
  dataTypes: readonly DataType[],
): SqlColumnIRInput {
  const resolved =
    column.reportedType === undefined
      ? resolveWrittenSqlTypes(column.typeText, dataTypes)[0]
      : resolveReportedSqlType(column.reportedType, dataTypes);
  return {
    reportedType: { text: column.typeText, kind: undefined, schema: undefined, name: undefined },
    ...column,
    ...(resolved === undefined
      ? {}
      : { storedType: resolved.dataType, storedTypeParams: resolved.typeParams }),
  };
}
