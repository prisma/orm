import type { ColumnDefault } from '@internal/contract/types';
import { dataTypeParams } from '@internal/framework-components/codec';
import { isSqlDataType, renderSqlTypeName } from '@internal/sql-contract/data-type';
import {
  DdlColumn,
  type DdlTableConstraint,
  FunctionColumnDefault,
  LiteralColumnDefault,
  opaqueSql,
  PrimaryKeyConstraint,
  UniqueConstraint,
} from '@internal/sql-relational-core/ast';
import type { SqlColumnIR, SqlTableIR, SqlUniqueIR } from '@internal/sql-schema-ir/types';
import { InternalError } from '@internal/utils/internal-error';

/** The type DDL writes for a column node: the type it is stored as, with the parameters the contract writes, as MySQL reports it in `COLUMN_TYPE`. */
function columnTypeSql(column: SqlColumnIR): string {
  const type = column.storedType;
  if (type === undefined || !isSqlDataType(type)) {
    throw new InternalError(
      `column "${column.name}" has no data type; the expected tree must be derived via contractToSchemaIR for planning`,
    );
  }
  return renderSqlTypeName(type, dataTypeParams(type, column.codecRef?.typeParams));
}

function ddlDefaultOf(columnDefault: ColumnDefault | undefined): DdlColumn['default'] {
  if (columnDefault === undefined) return undefined;
  return columnDefault.kind === 'literal'
    ? new LiteralColumnDefault(columnDefault.value)
    : new FunctionColumnDefault(opaqueSql(columnDefault.expression));
}

/** The default a column node's DDL writes: the one the contract authored, which `resolvedDefault` normalises for the diff. */
export function columnDefaultOf(column: SqlColumnIR): ColumnDefault | undefined {
  return column.authoredDefault ?? column.resolvedDefault;
}

/** The `DdlColumn` of a column node. An `autoincrement()` default stays a function default, which the adapter writes as `AUTO_INCREMENT`. */
export function ddlColumnFromNode(column: SqlColumnIR): DdlColumn {
  const columnDefault = ddlDefaultOf(columnDefaultOf(column));
  return new DdlColumn({
    name: column.name,
    type: columnTypeSql(column),
    ...(column.nullable ? {} : { notNull: true }),
    ...(columnDefault === undefined ? {} : { default: columnDefault }),
    ...(column.codecRef === undefined ? {} : { codecRef: column.codecRef }),
  });
}

/** The name a unique constraint is created and dropped by; MySQL names an unnamed one after its first column, which the contract never leaves to it. */
export function uniqueName(table: string, unique: SqlUniqueIR): string {
  return unique.name ?? `${table}_${unique.columns.join('_')}_key`;
}

/** The constraints `CREATE TABLE` writes for a table node: its primary key and unique constraints. Foreign keys are added after every table exists, so tables can reference each other. */
export function tableConstraintsFromNode(table: SqlTableIR): DdlTableConstraint[] {
  return [
    ...(table.primaryKey === undefined
      ? []
      : [new PrimaryKeyConstraint({ columns: table.primaryKey.columns })]),
    ...table.uniques.map(
      (unique) =>
        new UniqueConstraint({ columns: unique.columns, name: uniqueName(table.name, unique) }),
    ),
  ];
}
