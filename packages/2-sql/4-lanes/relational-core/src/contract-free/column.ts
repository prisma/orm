import type { ColumnDefaultLiteralInputValue } from '@internal/contract/types';
import type { SqlExpression } from '@internal/sql-contract/sql-expression';
import { requireSqlExpression } from '@internal/sql-contract/sql-expression';
import type { ReferentialAction } from '@internal/sql-contract/types';
import type { CodecRef } from '../ast/codec-types';
import type { AnyDdlColumnDefault } from '../ast/ddl-types';
import {
  CheckExpressionConstraint,
  DdlColumn,
  ForeignKeyConstraint,
  FunctionColumnDefault,
  LiteralColumnDefault,
  PrimaryKeyConstraint,
  UniqueConstraint,
} from '../ast/ddl-types';
import { opaqueSql } from '../ast/opaque-sql';

/** SQL in a migration-file argument: a `sql` value, or a string. The string form is permanent: committed files use it, and the generator writes it when a template cannot hold the text unchanged. */
export type MigrationSqlText = string | SqlExpression;

/** The SQL text of `value`. A `sql` value from another installed copy is canonicalized; anything that is neither a string nor a `sql` value throws CONTRACT.ARGUMENT_INVALID. */
export function sqlTextOf(value: MigrationSqlText): string {
  if (typeof value === 'string') return value;
  return requireSqlExpression(value, 'SQL text').text;
}

export interface DdlColumnOptions {
  readonly notNull?: boolean;
  readonly primaryKey?: boolean;
  readonly default?: AnyDdlColumnDefault;
  readonly codecRef?: CodecRef;
}

export function lit(value: ColumnDefaultLiteralInputValue): LiteralColumnDefault {
  return new LiteralColumnDefault(value);
}

export function fn(expression: MigrationSqlText): FunctionColumnDefault {
  return new FunctionColumnDefault(opaqueSql(sqlTextOf(expression)));
}

export function col(name: string, type: string, options?: DdlColumnOptions): DdlColumn {
  return new DdlColumn({ name, type, ...options });
}

export function primaryKey(
  columns: readonly string[],
  options?: { readonly name?: string },
): PrimaryKeyConstraint {
  return new PrimaryKeyConstraint({ columns, ...options });
}

export function foreignKey(
  columns: readonly string[],
  refTable: string,
  refColumns: readonly string[],
  options?: {
    readonly name?: string;
    readonly onDelete?: ReferentialAction;
    readonly onUpdate?: ReferentialAction;
  },
): ForeignKeyConstraint {
  return new ForeignKeyConstraint({ columns, refTable, refColumns, ...options });
}

export function unique(
  columns: readonly string[],
  options?: { readonly name?: string },
): UniqueConstraint {
  return new UniqueConstraint({ columns, ...options });
}

export function checkExpression(
  name: string,
  expression: MigrationSqlText,
): CheckExpressionConstraint {
  return new CheckExpressionConstraint({ name, expression: opaqueSql(sqlTextOf(expression)) });
}
