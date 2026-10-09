import type { ControlPolicy } from '@internal/contract/types';
import type { EnumTypeHandle } from '@internal/contract-authoring';
import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import type { ForeignKeyAuthoringInput } from '@internal/sql-contract/foreign-key-materialization';
import type { CheckKind } from '@internal/sql-schema-ir/naming';
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
  readonly noCheck: readonly CheckKind[] | undefined;
  /** The `enumType()` handle that types the column, which gives it a storage value set and a membership check. */
  readonly enumTypeHandle: EnumTypeHandle | undefined;
  readonly site: ColumnSite;
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
