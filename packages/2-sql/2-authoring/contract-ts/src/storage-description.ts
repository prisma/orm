import type {
  ContractModel,
  ControlPolicy,
  ExecutionMutationDefault,
} from '@internal/contract/types';
import type { EnumTypeHandle } from '@internal/contract-authoring';
import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import type { ForeignKeyAuthoringInput } from '@internal/sql-contract/foreign-key-materialization';
import type { CheckKind } from '@internal/sql-schema-ir/naming';
import type { ColumnSite } from './column-site';
import type {
  AuthoredColumnDefault,
  CheckNode,
  IndexNode,
  PrimaryKeyNode,
  UniqueConstraintNode,
} from './contract-definition';

/** One column of a table, before lowering: its type is still the authored descriptor and its default is still authored. */
export interface ColumnDescription {
  readonly columnName: string;
  readonly descriptor: ColumnTypeDescriptor;
  readonly nullable: boolean;
  readonly many: false | { readonly elementNullable: boolean };
  readonly default: AuthoredColumnDefault | undefined;
  readonly noCheck: readonly CheckKind[] | undefined;
  /** The `enumType()` handle that types the column, which gives it a storage value set and a membership check. */
  readonly domainEnum: EnumTypeHandle | undefined;
  readonly site: ColumnSite;
}

/** One table, before lowering. Its foreign keys already name their target tables. */
export interface TableDescription {
  readonly namespaceId: string;
  readonly tableName: string;
  readonly columns: readonly ColumnDescription[];
  readonly control: ControlPolicy | undefined;
  readonly primaryKey: PrimaryKeyNode | undefined;
  readonly uniques: readonly UniqueConstraintNode[];
  readonly indexes: readonly IndexNode[];
  readonly checks: readonly CheckNode[];
  readonly foreignKeys: readonly ForeignKeyAuthoringInput[];
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

/** The domain a model implies: the domain model, with its field-to-column bridge and relations, and the execution defaults of its fields. */
export interface ModelDomain {
  readonly namespaceId: string;
  readonly modelName: string;
  readonly model: ContractModel;
  readonly executionDefaults: readonly ExecutionMutationDefault[];
}

export interface ModelComponents {
  readonly storage: ModelStorage;
  readonly domain: ModelDomain;
}

/** The key of a table among all tables of a contract: its namespace and its name. */
export function tableKey(namespaceId: string, tableName: string): string {
  return JSON.stringify([namespaceId, tableName]);
}
