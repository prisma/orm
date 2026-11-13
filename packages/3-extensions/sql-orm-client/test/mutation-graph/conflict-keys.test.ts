import { describe, expect, it } from 'vitest';
import type { DescribeCollectionRowsOptions } from '../../src/collection-dispatch';
import { createCollectionTables } from '../../src/collection-tables';
import { createAllGraph } from '../../src/mutation-graph/collection-graphs';
import { conflictKeysOf, rowThatCannotConflict } from '../../src/mutation-graph/conflict-keys';
import { createRowsOf } from '../../src/mutation-graph/storage-rows';
import { emptyState } from '../../src/types';
import { getTestContext } from '../helpers';
import { generatedContext } from './generated-keys-contract';

type Context = DescribeCollectionRowsOptions['context'];

const context: Context = getTestContext();

function targetOf(modelName: string, targetContext: Context = context) {
  return {
    context: targetContext,
    state: emptyState(createCollectionTables(targetContext.contract, 'public', modelName)),
    modelName,
    namespaceId: 'public',
  };
}

function check(
  modelName: string,
  tableName: string,
  onConflict: 'skip' | 'connect',
  conflictColumns: readonly string[],
  rows: readonly Record<string, unknown>[],
  parentLinkColumns: ReadonlySet<string> = new Set(),
  targetContext: Context = context,
) {
  const keys = conflictKeysOf(
    targetContext.contract,
    'public',
    tableName,
    onConflict,
    conflictColumns,
  );
  return rowThatCannotConflict(
    createRowsOf(targetOf(modelName, targetContext), rows),
    keys,
    parentLinkColumns,
  );
}

describe('conflictKeysOf', () => {
  it.each([
    [
      'skip without conflictOn: every primary key and unique constraint',
      'skip',
      [],
      [['id'], ['email']],
    ],
    ['connect without conflictOn: the primary key', 'connect', [], [['id']]],
    ['skip with conflictOn: the named columns', 'skip', ['email', 'name'], [['email', 'name']]],
    ['connect with conflictOn: the named columns', 'connect', ['email'], [['email']]],
  ] as const)('gives for %s', (_, onConflict, conflictColumns, keys) => {
    expect(
      conflictKeysOf(context.contract, 'public', 'users', onConflict, conflictColumns),
    ).toEqual(keys);
  });
});

describe('rowThatCannotConflict', () => {
  const ada = { id: 1, name: 'Ada', email: 'ada@example.com' };

  it.each([
    ['its own value', 'User', 'users', 'skip', ['invited_by_id'], [{ ...ada, invitedById: 2 }]],
    [
      'a value of one key when another key has none',
      'User',
      'users',
      'skip',
      [],
      [{ ...ada, id: null }],
    ],
    ['a create default the ORM fills in', 'Tag', 'tags', 'connect', [], [{ name: 'Go' }]],
  ] as const)(
    'finds no row when each row gives a conflict key %s',
    (_, modelName, tableName, onConflict, conflictColumns, rows) => {
      expect(check(modelName, tableName, onConflict, conflictColumns, rows)).toBeUndefined();
    },
  );

  it('counts a column the parent link fills in', () => {
    expect({
      linked: check('User', 'users', 'skip', ['invited_by_id'], [ada], new Set(['invited_by_id'])),
      unlinked: check('User', 'users', 'skip', ['invited_by_id'], [ada]),
    }).toEqual({ linked: undefined, unlinked: 0 });
  });

  it('finds the first row whose conflict key value is null', () => {
    expect(
      check(
        'User',
        'users',
        'skip',
        ['invited_by_id'],
        [
          { ...ada, invitedById: 2 },
          { ...ada, invitedById: null },
          { ...ada, invitedById: null },
        ],
      ),
    ).toBe(1);
  });

  it.each([
    ['auto-increment', 'Counter', 'counters', 'connect', [], [{ label: 'a', slug: 's' }]],
    ['database default', 'Note', 'notes', 'skip', [], [{ body: 'a' }]],
  ] as const)(
    'does not count a column the database fills in by %s',
    (_, modelName, tableName, onConflict, conflictColumns, rows) => {
      expect(
        check(modelName, tableName, onConflict, conflictColumns, rows, new Set(), generatedContext),
      ).toBe(0);
    },
  );

  it('accepts an auto-increment table row through another key, which connect does not watch', () => {
    const counter = [{ label: 'a', slug: 's' }];

    expect({
      skip: check('Counter', 'counters', 'skip', [], counter, new Set(), generatedContext),
      connect: check('Counter', 'counters', 'connect', [], counter, new Set(), generatedContext),
    }).toEqual({ skip: undefined, connect: 0 });
  });
});

describe('createAll and createAndCount with onConflict skip', () => {
  it.each([
    ['rows', 'createAll()'],
    ['count', 'createAndCount()'],
  ] as const)(
    'refuse a row that gives no value for any conflict key, with %s',
    (returns, method) => {
      expect(() =>
        createAllGraph(
          targetOf('User'),
          [
            { id: 1, name: 'Ada', email: 'ada@example.com', invitedById: 2 },
            { id: 2, name: 'Grace', email: 'grace@example.com', invitedById: null },
          ],
          { columns: ['invited_by_id'] },
          returns,
        ),
      ).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          message: `${method} row 1 for model "User" gives no value for any conflict key: (invited_by_id)`,
          meta: { method, model: 'User', index: 1, conflictKeys: [['invited_by_id']] },
        }),
      );
    },
  );

  it('refuse a row whose only key the database fills in', () => {
    expect(() =>
      createAllGraph(targetOf('Note', generatedContext), [{ body: 'a' }], { columns: [] }, 'count'),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message:
          'createAndCount() row 0 for model "Note" gives no value for any conflict key: (id)',
        meta: { method: 'createAndCount()', model: 'Note', index: 0, conflictKeys: [['id']] },
      }),
    );
  });
});
