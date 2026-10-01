import type { StorageColumn, StorageTable } from '@internal/sql-contract/types';
import type {
  AnyQueryAst,
  BinaryExpr,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  Direction,
  InsertAst,
  JoinAst,
  LiteralExpr,
  LoweredStatement,
  OperationExpr,
  ParamRef,
  SelectAst,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import type { AnyPostgresCodecDescriptor } from '@internal/target-postgres/codec-descriptor';

export interface PostgresAdapterOptions {
  readonly profileId?: string;
  /**
   * Custom PostgreSQL codec descriptors contributed alongside the built-ins.
   * The complete descriptor set is validated at construction and becomes the
   * single source for both codec materialization and target-specific lowering.
   */
  readonly codecDescriptors?: readonly AnyPostgresCodecDescriptor[];
}

export type { PostgresContract } from '@internal/target-postgres/types';

export type Expr = ColumnRef | ParamRef | DefaultValueExpr;

export interface OrderClause {
  readonly expr: ColumnRef;
  readonly dir: Direction;
}

export type PostgresLoweredStatement = LoweredStatement;

export type {
  AnyQueryAst,
  BinaryExpr,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  Direction,
  InsertAst,
  JoinAst,
  LiteralExpr,
  OperationExpr,
  ParamRef,
  SelectAst,
  StorageColumn,
  StorageTable,
  UpdateAst,
};
