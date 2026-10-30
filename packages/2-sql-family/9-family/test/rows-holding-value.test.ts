import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  type MarkedRemoval,
  type RowsHoldingValueMark,
  rowsHoldingValueFailure,
  rowsHoldingValueMeta,
  rowsHoldingValueOf,
  rowsHoldingValueSummary,
} from '../src/core/migrations/rows-holding-value';

const mark = {
  enumValue: { namespaceId: asNamespaceId('app'), enum: 'Status', member: 'ARCHIVED' },
  value: 'ARCHIVED',
  codecRef: { codecId: 'pg/text@1' },
  table: 'task',
  column: 'status',
  storedValue: 'archived',
};

describe('rows that hold a removed stored value', () => {
  it('reads back the mark a removal check carries, its enum value a coordinate, and nothing from another check', () => {
    expect(
      rowsHoldingValueOf({
        description: 'check',
        sql: 'SELECT 1',
        meta: rowsHoldingValueMeta(mark),
      }),
    ).toEqual(mark);
    const numbered = {
      enumValue: { enum: 'Status', member: 'A' },
      value: 1,
      table: 'task',
      column: 'rank',
      storedValue: 1,
    };
    expect(
      rowsHoldingValueOf({
        description: 'check',
        sql: 'SELECT 1',
        meta: rowsHoldingValueMeta(numbered),
      }),
    ).toEqual(numbered);
    expect(rowsHoldingValueOf({ description: 'check', sql: 'SELECT 1' })).toBeUndefined();
  });

  it('says how many rows hold the value as the database stores it', () => {
    expect(rowsHoldingValueSummary('task', 'status', 'archived', 1)).toBe(
      '1 row of "task" holds "archived" in column "status", which takes no NULL, so the value cannot be removed.',
    );
    expect(rowsHoldingValueSummary('task', 'rank', 3, 2)).toBe(
      '2 rows of "task" hold 3 in column "rank", which takes no NULL, so the value cannot be removed.',
    );
  });
});

describe('rowsHoldingValueFailure', () => {
  const keepDataEdit = { remove: 'remove', replaceWith: 'replace' };
  const failed: MarkedRemoval<string> = { operation: 'remove task', operationIndex: 3, mark };

  it('counts the stored value the mark carries, and reports it with the edit that keeps the rows', async () => {
    const counted: RowsHoldingValueMark[] = [];
    expect(
      await rowsHoldingValueFailure({
        failed,
        count: async (removal) => {
          counted.push(removal.mark);
          return 2;
        },
        keepDataEdit: () => keepDataEdit,
      }),
    ).toEqual({
      summary:
        '2 rows of "task" hold "archived" in column "status", which takes no NULL, so the value cannot be removed.',
      report: {
        enumValue: mark.enumValue,
        value: 'archived',
        rows: 2,
        operationIndex: 3,
        keepDataEdit,
      },
    });
    expect(counted).toEqual([mark]);
  });

  it('leaves the failure without a count when the count fails', async () => {
    expect(
      await rowsHoldingValueFailure({
        failed,
        count: () => Promise.reject(new Error('locked')),
        keepDataEdit: () => keepDataEdit,
      }),
    ).toBeUndefined();
  });
});
