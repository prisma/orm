import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  type MarkedRemoval,
  type RowsHoldingValueMark,
  removalsOfMigration,
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

describe('removalsOfMigration', () => {
  it('lists the marked removal checks of the migration of the operation, in plan order', () => {
    const check = (marked: RowsHoldingValueMark) => ({
      description: 'check',
      sql: 'SELECT 1',
      meta: rowsHoldingValueMeta(marked),
    });
    const operation = (precheck: readonly ReturnType<typeof check>[]) => ({
      precheck,
      execute: [],
      postcheck: [],
    });
    const other = { ...mark, table: 'project' };
    const operations = [
      operation([check({ ...mark, table: 'earlier' })]),
      operation([check(mark)]),
      operation([]),
      operation([check(other)]),
    ];

    expect(
      removalsOfMigration(operations, [{ operationCount: 1 }, { operationCount: 3 }], 1).map(
        ({ operationIndex, mark: marked }) => [operationIndex, marked.table],
      ),
    ).toEqual([
      [1, 'task'],
      [3, 'project'],
    ]);
  });
});

describe('rowsHoldingValueFailure', () => {
  const keepDataEdit = { remove: 'remove', replaceWith: 'replace' };
  const removal = (
    operationIndex: number,
    marked: RowsHoldingValueMark,
  ): MarkedRemoval<string> => ({
    operation: marked.table,
    operationIndex,
    check: {
      description: 'check',
      sql: `check ${marked.table}`,
      meta: rowsHoldingValueMeta(marked),
    },
    mark: marked,
  });
  const failed = removal(3, mark);
  const project = removal(5, { ...mark, table: 'project' });
  const optional = removal(6, { ...mark, table: 'note' });
  const added = removal(7, { ...mark, table: 'added' });
  const rowsOf: Readonly<Record<string, number>> = { task: 2, project: 4, note: 1, empty: 0 };

  function failure(others: readonly MarkedRemoval<string>[]) {
    return rowsHoldingValueFailure({
      failed,
      others: [failed, ...others],
      checkFails: async (marked) => marked.operation !== 'note',
      count: async ({ mark: counted }) => {
        const rows = rowsOf[counted.table];
        if (rows === undefined) throw new Error(`no table ${counted.table}`);
        return rows;
      },
      keepDataEdit: () => keepDataEdit,
    });
  }

  it('reports the failed removal first, then every other whose check fails while rows hold its value', async () => {
    const empty = removal(8, { ...mark, table: 'empty' });
    expect(await failure([project, optional, empty])).toEqual({
      summary:
        '2 rows of "task" hold "archived" in column "status", which takes no NULL, so the value cannot be removed.',
      reports: [
        { enumValue: mark.enumValue, value: 'archived', rows: 2, operationIndex: 3, keepDataEdit },
        { enumValue: mark.enumValue, value: 'archived', rows: 4, operationIndex: 5, keepDataEdit },
      ],
    });
  });

  it('stops at the first other removal it cannot count, such as one of a column an earlier operation adds', async () => {
    expect((await failure([added, project]))?.reports.map(({ rows }) => rows)).toEqual([2]);
  });

  it('leaves the failure without a count when the failed count fails', async () => {
    expect(
      await rowsHoldingValueFailure({
        failed,
        others: [],
        checkFails: async () => true,
        count: () => Promise.reject(new Error('locked')),
        keepDataEdit: () => keepDataEdit,
      }),
    ).toBeUndefined();
  });
});
