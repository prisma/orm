import type { JsonValue } from '@internal/contract/types';
import type { TargetPackRef } from '@internal/framework-components/components';
import type { SqlNamespaceBase, SqlNamespaceInput } from '@internal/sql-contract/types';
import type { Prisma7ExtensionPack, Prisma7TypeMap } from './native-types';

export interface Prisma7ColumnType {
  readonly codecId: string;
  /** The id of the data type the column's codec represents. */
  readonly dataType: string;
  readonly typeParams?: Readonly<Record<string, unknown>> | undefined;
}

/** How a literal `@default` is read for a column whose codec does not take the value as written. */
export type Prisma7LiteralDefaultForm =
  /** A string holding JSON text, parsed. */
  | { readonly kind: 'json' }
  /** A string, read as the body of the column type's tag, as `` tag`body` `` reads in the current schema language. */
  | {
      readonly kind: 'tag';
      readonly tag: string;
      /** The tag's body for the text Prisma 7 writes, which keeps what the value means on the column; `undefined` when the text is not a value Prisma 7 writes for the column. */
      readonly body: (text: string) => string | undefined;
      /** For text with more fraction digits than the column holds: the digits it holds and the text of the value the database stores instead. */
      readonly finerThanColumn?: (text: string) => Prisma7FinerThanColumn | undefined;
    };

/** A written value finer than its column: how many fraction digits the column holds and what the database stores instead. */
export interface Prisma7FinerThanColumn {
  readonly heldDigits: number;
  readonly stored: string;
}

/** How the target reads the datasource `extensions` list. */
export interface Prisma7DatabaseExtensions {
  /** The generator preview feature without which Prisma 7 refuses the list. */
  readonly previewFeature: string;
  /** The entity kind the target registers for a database extension. */
  readonly entityKind: string;
  /** The extensions an extension pack declares, by name, with that pack; a datasource `extensions` entry and a `@db.*` type the extension provides are both read through it. */
  readonly packs: Readonly<Record<string, Prisma7ExtensionPack>>;
}

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
  readonly extensions: Prisma7DatabaseExtensions;
  /** Prisma 7 index `type` names to the target's index types. */
  readonly indexTypes: Readonly<Record<string, string>>;
  /** The longest identifier the database keeps, in bytes. Prisma 7 cuts the names it generates to fit. */
  readonly identifierMaxBytes: number;
  /** The names the target's migration planner gives a primary key or foreign key the contract leaves unnamed. */
  readonly defaultConstraintNames: {
    readonly primaryKey: (tableName: string) => string;
    readonly foreignKey: (tableName: string, columns: readonly string[]) => string;
  };
  /**
   * The relation field names `contract infer` gives a junction table whose
   * columns `A` and `B` reference `tableA` and `tableB`, so the junction model
   * reads as it will after the database is inferred.
   */
  readonly junctionRelationFieldNames: (
    tableA: string,
    tableB: string,
  ) => readonly [string, string];
  /** How a literal `@default` on the column is read; `undefined` when the codec takes the written value. */
  readonly literalDefaultForm: (column: Prisma7ColumnType) => Prisma7LiteralDefaultForm | undefined;
  /** The SQL expression of a default whose value the column's type holds but its codec cannot hold exactly, such as a timestamp with digits below a millisecond read as a JavaScript `Date`: `stored` is the value, or a list column's elements, as the type stores them. */
  readonly literalDefaultExpression: (stored: JsonValue, column: Prisma7ColumnType) => string;
}
