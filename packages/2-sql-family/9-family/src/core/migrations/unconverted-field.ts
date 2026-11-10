import type { ContractWithDomain } from '@internal/contract/types';
import type { MigrationSubject } from '@internal/framework-components/control';
import { type } from 'arktype';
import { fieldOfColumn } from './field-of-column';
import type { SqlMigrationPlanOperationStep } from './types';

const ConvertedColumnMeta = type({
  convertedColumn: { table: 'string', column: 'string', by: "'cast' | 'conversion'" },
});

/**
 * A column whose values a step converts to the column's new type, or checks that it did: `by` says
 * who converts them, the database's own cast or the migration's own conversion.
 */
export interface ConvertedColumn {
  readonly table: string;
  readonly column: string;
  readonly by: 'cast' | 'conversion';
}

/**
 * The meta of a step that converts the values of `column` in `table` to the column's new type, or
 * checks that it did. When the step fails, the runner names the field that stores the column.
 */
export function convertedColumnMeta(
  table: string,
  column: string,
  by: ConvertedColumn['by'],
): { readonly convertedColumn: ConvertedColumn } {
  return { convertedColumn: { table, column, by } };
}

/** The column a step converts to its new type, as {@link convertedColumnMeta} marks it. */
export function convertedColumnOf(
  step: SqlMigrationPlanOperationStep,
): ConvertedColumn | undefined {
  const meta = ConvertedColumnMeta(step.meta ?? {});
  return meta instanceof type.errors ? undefined : meta.convertedColumn;
}

/**
 * The field of `contract` whose column a failed step converts, or undefined when the step
 * converts no column, no field stores the column, or tables of two storage namespaces share its name.
 */
export function unconvertedFieldOf(
  step: SqlMigrationPlanOperationStep,
  contract: ContractWithDomain,
): MigrationSubject | undefined {
  const converted = convertedColumnOf(step);
  return converted === undefined
    ? undefined
    : fieldOfColumn(contract, converted.table, converted.column);
}
