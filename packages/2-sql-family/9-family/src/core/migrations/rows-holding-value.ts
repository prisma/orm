import { asNamespaceId, type JsonValue } from '@internal/contract/types';
import type { CodecRef } from '@internal/framework-components/codec';
import type {
  EnumValueCoordinateJson,
  KeepDataEdit,
  RowsHoldingValue,
} from '@internal/framework-components/control';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { type } from 'arktype';
import { marksOfMigration } from './required-column';
import type { SqlMigrationPlanOperationStep } from './types';

const RowsHoldingValueMeta = type({
  rowsHoldingValue: {
    enumValue: { 'namespaceId?': 'string', enum: 'string', member: 'string' },
    value: 'string | number',
    'codecRef?': { codecId: 'string', 'typeParams?': 'unknown' },
    table: 'string',
    column: 'string',
    storedValue: 'string | number',
  },
});

/**
 * The enum value a removal check guards, with its stored value as the contract stores it and the
 * column's codec, which the call that removes it carries, and the column it is removed from.
 */
export interface RowsHoldingValueMark {
  readonly enumValue: EnumValueCoordinateJson;
  readonly value: string | number;
  readonly codecRef?: CodecRef;
  readonly table: string;
  readonly column: string;
  /** The value as the database stores it, which the runner counts. */
  readonly storedValue: string | number;
}

/**
 * The meta of the check before a stored enum value is removed from a column: it fails while rows
 * hold the value in a column that takes no NULL, and the runner then counts those rows.
 */
export function rowsHoldingValueMeta(mark: RowsHoldingValueMark): {
  readonly rowsHoldingValue: RowsHoldingValueMark;
} {
  return { rowsHoldingValue: mark };
}

/** The enum value a check guards, as {@link rowsHoldingValueMeta} marks it. */
export function rowsHoldingValueOf(
  step: SqlMigrationPlanOperationStep,
): RowsHoldingValueMark | undefined {
  const meta = RowsHoldingValueMeta(step.meta ?? {});
  if (meta instanceof type.errors) return undefined;
  const { enumValue, value, codecRef, table, column, storedValue } = meta.rowsHoldingValue;
  return {
    enumValue: {
      ...(enumValue.namespaceId === undefined
        ? {}
        : { namespaceId: asNamespaceId(enumValue.namespaceId) }),
      enum: enumValue.enum,
      member: enumValue.member,
    },
    value,
    ...(codecRef === undefined ? {} : { codecRef: codecRefOf(codecRef) }),
    table,
    column,
    storedValue,
  };
}

function codecRefOf(codecRef: { codecId: string; typeParams?: unknown }): CodecRef {
  return codecRef.typeParams === undefined
    ? { codecId: codecRef.codecId }
    : {
        codecId: codecRef.codecId,
        typeParams: blindCast<
          JsonValue,
          'the marker is JSON read back from ops.json, so its type parameters are JSON'
        >(codecRef.typeParams),
      };
}

/** What a runner failure says of the rows that hold a stored value a column cannot lose: the value as the database stores it. */
export function rowsHoldingValueSummary(
  table: string,
  column: string,
  storedValue: unknown,
  rows: number,
): string {
  const counted = `${rows} ${rows === 1 ? 'row' : 'rows'} of "${table}"`;
  return `${counted} ${rows === 1 ? 'holds' : 'hold'} ${JSON.stringify(storedValue)} in column "${column}", which takes no NULL, so the value cannot be removed.`;
}

/** A removal check of a plan's operation, with the {@link RowsHoldingValueMark} it carries. */
export interface MarkedRemoval<TOperation> {
  readonly operation: TOperation;
  readonly operationIndex: number;
  readonly check: SqlMigrationPlanOperationStep;
  readonly mark: RowsHoldingValueMark;
}

/** The marked removal checks of the migration of the operation at `operationIndex`, in plan order. */
export function removalsOfMigration<
  TOperation extends {
    readonly precheck: readonly SqlMigrationPlanOperationStep[];
    readonly execute: readonly SqlMigrationPlanOperationStep[];
    readonly postcheck: readonly SqlMigrationPlanOperationStep[];
  },
>(
  operations: readonly TOperation[],
  edges: readonly { readonly operationCount: number }[],
  operationIndex: number,
): readonly MarkedRemoval<TOperation>[] {
  return marksOfMigration(operations, edges, operationIndex, rowsHoldingValueOf).map(
    ({ operation, operationIndex: index, step, mark }) => ({
      operation,
      operationIndex: index,
      check: step,
      mark,
    }),
  );
}

/**
 * A runner failure's summary and reports for the rows that hold stored values removals cannot take
 * out of required columns. The failed removal is counted first, and the summary names it; undefined
 * when that count fails. Then each other removal of `others` whose check `checkFails` says fails is
 * counted, until a count fails, such as for a column an earlier operation adds, so that the advice
 * can name every column that still holds a removed value.
 */
export async function rowsHoldingValueFailure<TOperation>(input: {
  readonly failed: MarkedRemoval<TOperation>;
  readonly others: readonly MarkedRemoval<TOperation>[];
  readonly checkFails: (removal: MarkedRemoval<TOperation>) => Promise<boolean>;
  readonly count: (removal: MarkedRemoval<TOperation>) => Promise<number>;
  readonly keepDataEdit: (removal: MarkedRemoval<TOperation>) => KeepDataEdit | undefined;
}): Promise<
  { readonly summary: string; readonly reports: readonly RowsHoldingValue[] } | undefined
> {
  const { failed } = input;
  const report = (removal: MarkedRemoval<TOperation>, rows: number): RowsHoldingValue => ({
    enumValue: removal.mark.enumValue,
    value: removal.mark.storedValue,
    rows,
    operationIndex: removal.operationIndex,
    ...ifDefined('keepDataEdit', input.keepDataEdit(removal)),
  });
  let rows: number;
  try {
    rows = await input.count(failed);
  } catch {
    return undefined;
  }
  const reports = [report(failed, rows)];
  for (const other of input.others) {
    if (other.operationIndex === failed.operationIndex) continue;
    let otherRows: number;
    try {
      otherRows = (await input.checkFails(other)) ? await input.count(other) : 0;
    } catch {
      break;
    }
    if (otherRows > 0) reports.push(report(other, otherRows));
  }
  const { mark } = failed;
  return {
    summary: rowsHoldingValueSummary(mark.table, mark.column, mark.storedValue, rows),
    reports,
  };
}
