import type { ControlPolicy, EntityCoordinate } from '@internal/contract/types';
import type { EnumTypeHandle } from '@internal/contract-authoring';
import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import type { ForeignKeyAuthoringInput } from '@internal/sql-contract/foreign-key-materialization';
import type {
  AuthoredColumnDefault,
  CheckNode,
  IndexNode,
  PrimaryKeyNode,
  UniqueConstraintNode,
} from './contract-definition';
import type { ColumnSite } from './declaration-sites';

/** One column of a table, before lowering: its type is still the authored descriptor and its default is still authored. */
export interface ColumnDescription {
  readonly columnName: string;
  readonly descriptor: ColumnTypeDescriptor;
  readonly nullable: boolean;
  readonly many: false | { readonly elementNullable: boolean };
  readonly default: AuthoredColumnDefault | undefined;
  /** The `enumType()` handle that types the column, which gives it a storage value set and a membership check. */
  readonly enumTypeHandle: EnumTypeHandle | undefined;
  /** The value object the column holds, and whether the field is a list of them, stored as one JSON array. */
  readonly valueObject: ColumnValueObject | undefined;
  readonly site: ColumnSite;
}

export interface ColumnValueObject {
  readonly reference: EntityCoordinate<'storage', 'valueObject'>;
  /** Whether the column's JSON value is an array of value objects. The column's own `many` is a native array column, which a value object column never is. */
  readonly many: false | { readonly elementNullable: boolean };
}

/** One table, before lowering. It holds every table-level property a model or table node can state, and its foreign keys already name their target tables. */
export interface TableDescription {
  readonly namespaceId: string;
  readonly tableName: string;
  readonly columns: readonly ColumnDescription[];
  readonly id: PrimaryKeyNode | undefined;
  readonly uniques: readonly UniqueConstraintNode[];
  readonly indexes: readonly IndexNode[];
  readonly checks: readonly CheckNode[];
  readonly foreignKeys: readonly ForeignKeyAuthoringInput[];
  readonly control: ControlPolicy | undefined;
}

/**
 * The storage a model implies. A model with a table of its own describes that table; a single-table variant names the columns it needs on the table its base model owns.
 */
export type ModelStorage =
  | { readonly kind: 'ownTable'; readonly modelName: string; readonly table: TableDescription }
  | {
      readonly kind: 'baseTable';
      readonly modelName: string;
      readonly namespaceId: string;
      readonly tableName: string;
      readonly columns: readonly ColumnDescription[];
    };

/** The key of a table among all tables of a contract: its namespace and its name. */
export function tableKey(namespaceId: string, tableName: string): string {
  return JSON.stringify([namespaceId, tableName]);
}
