import type { TargetPackRef } from '@internal/framework-components/components';
import type { SqlNamespaceBase, SqlNamespaceInput } from '@internal/sql-contract/types';
import type { Prisma7TypeMap } from './native-types';

export interface Prisma7ColumnType {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams?: Readonly<Record<string, unknown>> | undefined;
}

/** How a literal `@default` is read for a column whose codec does not take the value as written. */
export type Prisma7LiteralDefaultForm =
  /** A string holding JSON text, parsed. */
  | { readonly kind: 'json' }
  /** A string, carried as the SQL expression of the default the database stores. */
  | {
      readonly kind: 'sqlExpression';
      /** The SQL literal for one written value, or `undefined` when the text is not a value of the column's type. */
      readonly literal: (text: string) => string | undefined;
      /** The SQL expression for a list default made of `literal` results. */
      readonly list: (literals: readonly string[]) => string;
    };

/** Everything a target supplies to the Prisma 7 interpreter. */
export interface Prisma7TargetBinding {
  readonly target: TargetPackRef<'sql', string>;
  readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
  /** The datasource `provider` values the target reads; messages name the first. */
  readonly providers: readonly [string, ...string[]];
  /** What Prisma 7 creates for each scalar and `@db.*` type. */
  readonly typeMap: Prisma7TypeMap;
  /** The entity kind the target registers for a native enum, and the type constructor that references one. */
  readonly nativeEnum: {
    readonly entityKind: string;
    readonly typeConstructor: readonly string[];
  };
  /** Prisma 7 index `type` names to the target's index types. */
  readonly indexTypes: Readonly<Record<string, string>>;
  /** The longest identifier the database keeps, in bytes. Prisma 7 cuts the names it generates to fit. */
  readonly identifierMaxBytes: number;
  /**
   * The relation field names `contract infer` gives a junction table whose
   * columns `A` and `B` reference `tableA` and `tableB`, so the junction model
   * reads as it will after the database is inferred.
   */
  readonly junctionRelationFieldNames: (
    tableA: string,
    tableB: string,
  ) => readonly [string, string];
  /** The "now" generator `@updatedAt` lowers to for a column with this codec; `undefined` when the target has none. */
  readonly updatedAtGeneratorId: (codecId: string) => string | undefined;
  /** How a literal `@default` on the column is read; `undefined` when the codec takes the written value. */
  readonly literalDefaultForm: (column: Prisma7ColumnType) => Prisma7LiteralDefaultForm | undefined;
}
