import type { ContractWithDomain } from '@internal/contract/types';
import type { RowsWithoutValue } from '@internal/framework-components/control';
import { type } from 'arktype';
import { fieldOfColumn } from './field-of-column';
import type { SqlMigrationPlanOperationStep } from './types';

const RequiredColumnMeta = type({
  requiredColumn: {
    table: 'string',
    column: 'string',
    reason: "'nullValues' | 'newField' | 'backfillMissedRows'",
  },
});

/** Where a column that is to become required finds no value. */
export interface RequiredColumn {
  readonly table: string;
  readonly column: string;
  readonly reason: RowsWithoutValue['reason'];
}

/**
 * The meta of a step that fails when rows have no value for a column that is to become required:
 * rows hold NULL in it, or, for a new column that can be added to an empty table only, the table
 * has rows. When the step fails, the runner counts those rows.
 */
export function requiredColumnMeta(
  table: string,
  column: string,
  reason: RowsWithoutValue['reason'],
): { readonly requiredColumn: RequiredColumn } {
  return { requiredColumn: { table, column, reason } };
}

/** The column a step checks before it becomes required, as {@link requiredColumnMeta} marks it. */
export function requiredColumnOf(step: SqlMigrationPlanOperationStep): RequiredColumn | undefined {
  const meta = RequiredColumnMeta(step.meta ?? {});
  return meta instanceof type.errors ? undefined : meta.requiredColumn;
}

/** What a runner failure says of the rows a column that is to become required has no value in. */
export function rowsWithoutValueSummary(required: RequiredColumn, rows: number): string {
  const { table, column } = required;
  if (required.reason === 'newField') {
    return `"${table}" has ${rows} ${rows === 1 ? 'row' : 'rows'}, so the new required column "${column}" cannot be added: it can be added to an empty table only.`;
  }
  const counted = `${rows} ${rows === 1 ? 'row' : 'rows'} of "${table}"`;
  if (required.reason === 'backfillMissedRows') {
    return `${counted} still ${rows === 1 ? 'holds' : 'hold'} NULL in "${column}" after its backfill step, so it cannot become required.`;
  }
  return `${counted} ${rows === 1 ? 'holds' : 'hold'} NULL in "${column}", so it cannot become required.`;
}

/** A step of a plan that marks a column as becoming required. */
export interface RequiredColumnMark<TOperation> {
  readonly operation: TOperation;
  readonly operationIndex: number;
  readonly required: RequiredColumn;
}

function migrationRange(
  edges: readonly { readonly operationCount: number }[],
  operationIndex: number,
  operationCount: number,
): { readonly start: number; readonly end: number } {
  let start = 0;
  for (const edge of edges) {
    const end = start + edge.operationCount;
    if (operationIndex < end) return { start, end };
    start = end;
  }
  return { start: 0, end: operationCount };
}

/** A step of a plan's operation that carries a mark, with the mark it carries. */
export interface MarkedStep<TOperation, TMark> {
  readonly operation: TOperation;
  readonly operationIndex: number;
  readonly step: SqlMigrationPlanOperationStep;
  readonly mark: TMark;
}

/**
 * The steps of `operations` that belong to the same migration as the operation at `operationIndex`
 * and carry a mark `markOf` reads, in plan order: `edges` say how many operations each migration of
 * the plan has.
 */
export function marksOfMigration<
  TOperation extends {
    readonly precheck: readonly SqlMigrationPlanOperationStep[];
    readonly execute: readonly SqlMigrationPlanOperationStep[];
    readonly postcheck: readonly SqlMigrationPlanOperationStep[];
  },
  TMark,
>(
  operations: readonly TOperation[],
  edges: readonly { readonly operationCount: number }[],
  operationIndex: number,
  markOf: (step: SqlMigrationPlanOperationStep) => TMark | undefined,
): readonly MarkedStep<TOperation, TMark>[] {
  const { start, end } = migrationRange(edges, operationIndex, operations.length);
  return operations.slice(start, end).flatMap((operation, offset) =>
    [...operation.precheck, ...operation.execute, ...operation.postcheck].flatMap((step) => {
      const mark = markOf(step);
      return mark === undefined ? [] : [{ operation, operationIndex: start + offset, step, mark }];
    }),
  );
}

/** The marks of the steps that mark a column as becoming required, as {@link marksOfMigration} finds them. */
export function requiredColumnsOfMigration<
  TOperation extends {
    readonly precheck: readonly SqlMigrationPlanOperationStep[];
    readonly execute: readonly SqlMigrationPlanOperationStep[];
    readonly postcheck: readonly SqlMigrationPlanOperationStep[];
  },
>(
  operations: readonly TOperation[],
  edges: readonly { readonly operationCount: number }[],
  operationIndex: number,
): readonly RequiredColumnMark<TOperation>[] {
  return marksOfMigration(operations, edges, operationIndex, requiredColumnOf).map(
    ({ operation, operationIndex: index, mark }) => ({
      operation,
      operationIndex: index,
      required: mark,
    }),
  );
}

/**
 * A runner failure's summary and reports for the rows that columns becoming required have no value
 * in. The failed operation's marks are counted first, and the first of them with such rows is the
 * one the summary names; undefined when none has any. The other marks of the same migration are
 * counted after it, until a count fails, such as for a column an earlier operation adds, so that
 * the advice can name every field that needs a value.
 */
export async function rowsWithoutValueFailure<TOperation>(input: {
  readonly failed: readonly RequiredColumnMark<TOperation>[];
  readonly others: readonly RequiredColumnMark<TOperation>[];
  readonly count: (mark: RequiredColumnMark<TOperation>) => Promise<number>;
  readonly contract: ContractWithDomain;
}): Promise<
  { readonly summary: string; readonly reports: readonly RowsWithoutValue[] } | undefined
> {
  const report = (mark: RequiredColumnMark<TOperation>, rows: number): RowsWithoutValue => ({
    field: fieldOfColumn(input.contract, mark.required.table, mark.required.column),
    reason: mark.required.reason,
    rows,
    operationIndex: mark.operationIndex,
  });
  for (const mark of input.failed) {
    const rows = await input.count(mark);
    if (rows === 0) continue;
    const reports = [report(mark, rows)];
    for (const other of input.others) {
      if (
        other.required.table === mark.required.table &&
        other.required.column === mark.required.column
      ) {
        continue;
      }
      let otherRows: number;
      try {
        otherRows = await input.count(other);
      } catch {
        break;
      }
      if (otherRows > 0) reports.push(report(other, otherRows));
    }
    return { summary: rowsWithoutValueSummary(mark.required, rows), reports };
  }
  return undefined;
}
