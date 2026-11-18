import { describe, expect, it } from 'vitest';
import type { DescribeCollectionRowsOptions } from '../../src/collection-dispatch';
import { createCollectionTables } from '../../src/collection-tables';
import { conflictKeysOf, rowThatCannotConflict } from '../../src/statement-graph/conflict-keys';
import { createRowsOf } from '../../src/statement-graph/storage-rows';
import { emptyState } from '../../src/types';
import { getTestContext } from '../helpers';
import { generatedContext } from './generated-keys-contract';

const context: DescribeCollectionRowsOptions['context'] = getTestContext();
const ada = { id: 1, name: 'Ada', email: 'ada@example.com' };

describe('conflictKeysOf', () => {
  it.each([
    ['without conflictOn: every primary key and unique constraint', [], [['id'], ['email']]],
    ['with conflictOn: the named columns', ['email', 'name'], [['email', 'name']]],
  ] as const)('gives the keys %s', (_, conflictColumns, keys) => {
    expect(conflictKeysOf(context.contract, 'public', 'users', conflictColumns)).toEqual(keys);
  });
});

const invitedBy = [['invited_by_id']];

describe('rowThatCannotConflict', () => {
  it.each([
    ['its own value', 'User', invitedBy, [{ ...ada, invitedById: 2 }], [], undefined],
    ['a create default the ORM fills in', 'Tag', [['id']], [{ name: 'Go' }], [], undefined],
    ['a column the parent link fills in', 'User', invitedBy, [ada], ['invited_by_id'], undefined],
    [
      'null, at the first such row',
      'User',
      invitedBy,
      [
        { ...ada, invitedById: 2 },
        { ...ada, invitedById: null },
      ],
      [],
      1,
    ],
    ['an auto-increment column', 'Counter', [['id']], [{ label: 'a', slug: 's' }], [], 0],
    [
      'an auto-increment column next to a key with a value',
      'Counter',
      [['id'], ['slug']],
      [{ label: 'a', slug: 's' }],
      [],
      undefined,
    ],
    ['a database default', 'Note', [['id']], [{ body: 'a' }], [], 0],
  ] as const)('counts %s', (_, modelName, keys, rows, parentLink, expected) => {
    const rowContext = modelName === 'Counter' || modelName === 'Note' ? generatedContext : context;
    const storageRows = createRowsOf(
      {
        context: rowContext,
        state: emptyState(createCollectionTables(rowContext.contract, 'public', modelName)),
        modelName,
        namespaceId: 'public',
      },
      rows,
    );

    expect(rowThatCannotConflict(storageRows, keys, new Set(parentLink))).toBe(expected);
  });
});
