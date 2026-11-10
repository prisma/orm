import type { ColumnDefaultLiteralInputValue } from '@internal/contract/types';
import type { SqlExpression } from '@internal/sql-contract/sql-expression';
import { readSqlExpression } from '@internal/sql-contract/sql-expression';
import type { ReferentialAction } from '@internal/sql-contract/types';
import { structuredError } from '@internal/utils/structured-error';
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

/** Raw SQL given as a `sql` value or as a string, before it is read. The string form is permanent. */
export type SqlTextInput = string | SqlExpression;

/**
 * The SQL text of `value`. A `sql` value from another installed copy is canonicalized. Anything that is neither a
 * string nor a `sql` value throws CONTRACT.ARGUMENT_INVALID naming the argument `what`.
 */
export function sqlTextOf(value: SqlTextInput, what: string): string {
  if (typeof value === 'string') return value;
  const expression = readSqlExpression(value);
  if (expression !== undefined) return expression.text;
  throw structuredError(
    'CONTRACT.ARGUMENT_INVALID',
    `${what} must be a string or a sql\`...\` value.`,
    { meta: { what } },
  );
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

export function fn(expression: SqlTextInput): FunctionColumnDefault {
  return new FunctionColumnDefault(opaqueSql(sqlTextOf(expression, 'fn expression')));
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

export function checkExpression(name: string, expression: SqlTextInput): CheckExpressionConstraint {
  return new CheckExpressionConstraint({
    name,
    expression: opaqueSql(
      sqlTextOf(expression, `checkExpression ${JSON.stringify(name)} expression`),
    ),
  });
}
