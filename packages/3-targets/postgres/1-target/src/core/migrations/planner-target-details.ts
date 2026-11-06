import { invariant } from '@internal/utils/assertions';
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

export interface PostgresPlanTargetDetails {
  /** Absent for an extension in the unbound namespace, which names no schema. */
  readonly schema?: string;
  readonly objectType: OperationClass;
  readonly name: string;
  readonly table?: string;
}

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

/** The schema of an operation on a table, column or constraint, which always names one; only an unbound extension's operation omits it. */
export function schemaOfDetails(details: PostgresPlanTargetDetails): string {
  invariant(details.schema !== undefined, `operation target "${details.name}" names no schema`);
  return details.schema;
}
