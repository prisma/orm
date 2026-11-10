import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  requiredColumnMeta,
  requiredColumnOf,
  requiredColumnsOfMigration,
  rowsWithoutValueFailure,
  rowsWithoutValueSummary,
} from '../src/core/migrations/required-column';
import { contractOf } from './statement-fixtures';

const step = (meta?: Record<string, unknown>) => ({
  description: 'ensure no NULL values in "note"',
  sql: 'SELECT …',
  ...(meta === undefined ? {} : { meta }),
});

describe('requiredColumnOf', () => {
  it('reads the column a step checks before it becomes required, and nothing from other meta', () => {
    expect([
      requiredColumnOf(step(requiredColumnMeta('Item', 'note', 'nullValues'))),
      requiredColumnOf(step(requiredColumnMeta('User', 'code', 'newField'))),
      requiredColumnOf(step(requiredColumnMeta('User', 'email', 'backfillMissedRows'))),
      requiredColumnOf(step({ convertedColumn: { table: 'Item', column: 'note', by: 'cast' } })),
      requiredColumnOf(step()),
    ]).toEqual([
      { table: 'Item', column: 'note', reason: 'nullValues' },
      { table: 'User', column: 'code', reason: 'newField' },
      { table: 'User', column: 'email', reason: 'backfillMissedRows' },
      undefined,
      undefined,
    ]);
  });
});

describe('rowsWithoutValueSummary', () => {
  it('counts the rows that hold NULL, or that a new required column has no value for', () => {
    expect([
      rowsWithoutValueSummary({ table: 'Item', column: 'note', reason: 'nullValues' }, 3),
      rowsWithoutValueSummary({ table: 'Item', column: 'note', reason: 'nullValues' }, 1),
      rowsWithoutValueSummary({ table: 'User', column: 'code', reason: 'newField' }, 2),
      rowsWithoutValueSummary({ table: 'User', column: 'email', reason: 'backfillMissedRows' }, 1),
    ]).toEqual([
      '3 rows of "Item" hold NULL in "note", so it cannot become required.',
      '1 row of "Item" holds NULL in "note", so it cannot become required.',
      '"User" has 2 rows, so the new required column "code" cannot be added: it can be added to an empty table only.',
      '1 row of "User" still holds NULL in "email" after its backfill step, so it cannot become required.',
    ]);
  });
});

describe('requiredColumnsOfMigration', () => {
  const op = (...marks: ReturnType<typeof requiredColumnMeta>[]) => ({
    precheck: marks.map((meta) => step(meta)),
    execute: [step()],
    postcheck: [],
  });
  const operations = [
    op(requiredColumnMeta('Item', 'a', 'newField')),
    op(),
    op(requiredColumnMeta('Item', 'b', 'nullValues'), requiredColumnMeta('Item', 'c', 'newField')),
    op(requiredColumnMeta('Item', 'd', 'nullValues')),
  ];

  it('reads the marks of every operation of the migration that holds the failed operation', () => {
    expect(
      requiredColumnsOfMigration(
        operations,
        [{ operationCount: 1 }, { operationCount: 2 }, { operationCount: 1 }],
        1,
      ).map(({ operationIndex, required }) => [operationIndex, required.column]),
    ).toEqual([
      [2, 'b'],
      [2, 'c'],
    ]);
  });

  it('reads the whole plan when the edges do not cover the operation', () => {
    expect(
      requiredColumnsOfMigration(operations, [], 3).map(({ required }) => required.column),
    ).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('rowsWithoutValueFailure', () => {
  const contract = contractOf({ Item: { table: 'Item', fields: { a: 'a', b: 'b', c: 'c' } } });
  const mark = (column: string, reason: 'nullValues' | 'newField', operationIndex: number) => ({
    operation: undefined,
    operationIndex,
    required: { table: 'Item', column, reason },
  });
  const field = (name: string) => ({
    kind: 'field',
    namespaceId: asNamespaceId('app'),
    model: 'Item',
    field: name,
  });

  it('names the first mark of the failed operation with rows, then every other mark with rows until a count fails', async () => {
    const rows: Record<string, number | Error> = {
      a: 0,
      b: 3,
      c: 2,
      x: new Error('no such column'),
    };
    const failure = await rowsWithoutValueFailure({
      failed: [mark('a', 'nullValues', 1), mark('b', 'nullValues', 1)],
      others: [
        mark('b', 'nullValues', 1),
        mark('c', 'newField', 2),
        mark('x', 'newField', 3),
        mark('a', 'newField', 4),
      ],
      count: async ({ required }) => {
        const counted = rows[required.column] ?? 0;
        if (counted instanceof Error) throw counted;
        return counted;
      },
      contract,
    });
    expect(failure).toEqual({
      summary: '3 rows of "Item" hold NULL in "b", so it cannot become required.',
      reports: [
        { field: field('b'), reason: 'nullValues', rows: 3, operationIndex: 1 },
        { field: field('c'), reason: 'newField', rows: 2, operationIndex: 2 },
      ],
    });
  });

  it('reports nothing when no mark of the failed operation has rows', async () => {
    expect(
      await rowsWithoutValueFailure({
        failed: [mark('a', 'nullValues', 0)],
        others: [mark('c', 'newField', 1)],
        count: async () => 0,
        contract,
      }),
    ).toBeUndefined();
  });
});
