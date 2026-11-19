import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import { autoincrement } from '@internal/sql-contract-ts/contract-builder';
import { describe, expect, it } from 'vitest';
import type { DescribeCollectionRowsOptions } from '../../src/collection-dispatch';
import { createCollectionTables } from '../../src/collection-tables';
import {
  conflictKeysOf,
  requireRowsThatCanConflict,
  rowThatCannotConflict,
} from '../../src/statement-graph/conflict-keys';
import { createRowsOf } from '../../src/statement-graph/storage-rows';
import { emptyState } from '../../src/types';
import { defineContract, field, model } from '../contract-builder';
import { getTestContext } from '../helpers';
import { generatedContext } from './generated-keys-contract';

const context: DescribeCollectionRowsOptions['context'] = getTestContext();
const ada = { id: 1, name: 'Ada', email: 'ada@example.com' };

describe('conflictKeysOf', () => {
  it.each([
    ['skip without conflictOn', 'skip', [], [['id'], ['email']]],
    ['connect without conflictOn', 'connect', [], [['id']]],
    ['skip with conflictOn', 'skip', ['email', 'name'], [['email', 'name']]],
    ['connect with conflictOn', 'connect', ['email'], [['email']]],
  ] as const)('gives the keys of %s', (_, onConflict, conflictColumns, keys) => {
    expect(
      conflictKeysOf(context.contract, 'public', 'users', onConflict, conflictColumns),
    ).toEqual(keys);
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

describe('the row check of onConflict skip on a table', () => {
  const Badge = model('Badge', {
    fields: {
      id: field.column(int4Column).default(autoincrement()).id(),
      code: field.column(textColumn),
    },
  }).sql(({ cols, constraints }) => ({
    table: 'badges',
    indexes: [constraints.index([cols.code], { unique: true })],
  }));
  const Log = model('Log', { fields: { message: field.column(textColumn) } }).sql({
    table: 'logs',
  });
  const contract = defineContract({ models: { Badge, Log } });
  const call = { action: 'createAll()', modelName: 'Badge', meta: { method: 'createAll()' } };

  it('accepts a row that gives only the column of a unique index next to a generated key', () => {
    expect(
      requireRowsThatCanConflict(
        contract,
        call,
        { namespaceId: 'public', tableName: 'badges' },
        { onConflict: 'skip', columns: [] },
        [{ code: 'gold' }],
        () => [],
      ),
    ).toEqual([['id'], ['code']]);
  });

  it('refuses a table with no primary key, unique constraint or unique index', () => {
    expect(() =>
      requireRowsThatCanConflict(
        contract,
        { ...call, modelName: 'Log' },
        { namespaceId: 'public', tableName: 'logs' },
        { onConflict: 'skip', columns: [] },
        [{ message: 'hello' }],
        () => [],
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message:
          'createAll() on model "Log" has nothing to skip on: table "logs" has no primary key, unique constraint or unique index over columns, so onConflict "skip" cannot skip any row',
        meta: { method: 'createAll()', problem: 'no-conflict-key' },
      }),
    );
  });

  it('refuses onConflict connect without conflictOn on a table with no primary key', () => {
    const nested = {
      action: 'create() nested mutation for relation "logs"',
      modelName: 'Log',
      meta: { kind: 'create', relation: 'logs' },
    };

    expect(() =>
      requireRowsThatCanConflict(
        contract,
        nested,
        { namespaceId: 'public', tableName: 'logs' },
        { onConflict: 'connect', columns: [] },
        [{ message: 'hello' }],
        () => [],
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message:
          'create() nested mutation for relation "logs" on model "Log" has nothing to connect on: table "logs" has no primary key, so onConflict "connect" needs conflictOn',
        meta: { kind: 'create', relation: 'logs', problem: 'no-conflict-key' },
      }),
    );
  });
});
