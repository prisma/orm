import type { ColumnDefaultLiteralInputValue } from '@internal/contract/types';
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

export interface DdlColumnOptions {
  readonly notNull?: boolean;
  readonly primaryKey?: boolean;
  readonly default?: AnyDdlColumnDefault;
  readonly codecRef?: CodecRef;
}

export function lit(value: ColumnDefaultLiteralInputValue): LiteralColumnDefault {
  return new LiteralColumnDefault(value);
}

export function fn(expression: string): FunctionColumnDefault {
  return new FunctionColumnDefault(opaqueSql(expression));
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

export function checkExpression(name: string, expression: string): CheckExpressionConstraint {
  return new CheckExpressionConstraint({ name, expression: opaqueSql(expression) });
}
