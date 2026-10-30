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

/** A step of a plan whose removal check carries a {@link RowsHoldingValueMark}. */
export interface MarkedRemoval<TOperation> {
  readonly operation: TOperation;
  readonly operationIndex: number;
  readonly mark: RowsHoldingValueMark;
}

/**
 * A runner failure's summary and report for the rows that hold the stored value a failed removal
 * check guards: `count` counts them, and `keepDataEdit` gives the edit that keeps them, when the
 * target can say it. Undefined when the count fails.
 */
export async function rowsHoldingValueFailure<TOperation>(input: {
  readonly failed: MarkedRemoval<TOperation>;
  readonly count: (removal: MarkedRemoval<TOperation>) => Promise<number>;
  readonly keepDataEdit: (removal: MarkedRemoval<TOperation>) => KeepDataEdit | undefined;
}): Promise<{ readonly summary: string; readonly report: RowsHoldingValue } | undefined> {
  const { failed } = input;
  const { mark } = failed;
  let rows: number;
  try {
    rows = await input.count(failed);
  } catch {
    return undefined;
  }
  return {
    summary: rowsHoldingValueSummary(mark.table, mark.column, mark.storedValue, rows),
    report: {
      enumValue: mark.enumValue,
      value: mark.storedValue,
      rows,
      operationIndex: failed.operationIndex,
      ...ifDefined('keepDataEdit', input.keepDataEdit(failed)),
    },
  };
}
