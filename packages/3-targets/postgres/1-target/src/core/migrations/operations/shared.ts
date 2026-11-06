import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type { CheckExpectation } from '@internal/framework-components/control';
import type { ReferentialAction } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import type { OperationClass, PostgresPlanTargetDetails } from '../planner-target-details';

export type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

/**
 * Literal-args shape for a foreign key definition. `references.schema`
 * carries the target table's namespace (schema) coordinate so the rendered
 * DDL qualifies the REFERENCES clause correctly for cross-schema FKs.
 */
export interface ForeignKeySpec {
  readonly name: string;
  readonly columns: readonly string[];
  readonly references: {
    readonly schema: string;
    readonly table: string;
    readonly columns: readonly string[];
  };
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
}

export function step(
  description: string,
  sql: string,
  params?: readonly unknown[],
  expectation?: CheckExpectation,
) {
  return {
    description,
    sql,
    ...ifDefined('params', params),
    ...ifDefined('expectation', expectation),
  };
}

export function targetDetails(
  objectType: OperationClass,
  name: string,
  schema: string,
  table?: string,
): { readonly id: 'postgres'; readonly details: PostgresPlanTargetDetails } {
  return {
    id: 'postgres',
    details: { schema, objectType, name, ...ifDefined('table', table) },
  };
}

/** The target of creating or dropping an extension the contract leaves to the search path, which names no schema. */
export function searchPathExtensionTarget(name: string): {
  readonly id: 'postgres';
  readonly details: PostgresPlanTargetDetails;
} {
  return { id: 'postgres', details: { objectType: 'dependency', name } };
}
