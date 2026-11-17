import { ifDefined } from '@internal/utils/defined';

export type OperationClass =
  | 'dependency'
  | 'type'
  | 'table'
  | 'column'
  | 'primaryKey'
  | 'unique'
  | 'index'
  | 'foreignKey'
  | 'checkConstraint'
  | 'rlsPolicy'
  | 'rowLevelSecurity';

/** The target of an operation that names its schema: every operation except creating or dropping an extension the contract leaves to the search path. */
export interface PostgresSchemaTargetDetails {
  readonly schema: string;
  readonly objectType: OperationClass;
  readonly name: string;
  readonly table?: string;
}

/** The target of creating or dropping an extension the contract leaves to the connection's search path, which names no schema. */
export interface PostgresSearchPathExtensionTargetDetails {
  readonly schema?: never;
  readonly objectType: 'dependency';
  readonly name: string;
  readonly table?: never;
}

export type PostgresPlanTargetDetails =
  | PostgresSchemaTargetDetails
  | PostgresSearchPathExtensionTargetDetails;

export function buildTargetDetails(
  objectType: OperationClass,
  name: string,
  schema: string,
  table?: string,
): PostgresPlanTargetDetails {
  return {
    schema,
    objectType,
    name,
    ...ifDefined('table', table),
  };
}
