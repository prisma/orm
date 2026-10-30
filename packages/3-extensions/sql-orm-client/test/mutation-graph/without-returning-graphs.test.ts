import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { autoincrement } from '@internal/sql-contract-ts/contract-builder';
import { describe, expect, it } from 'vitest';
import { createCollectionTables } from '../../src/collection-tables';
import {
  createAllGraph,
  deleteAllGraph,
  deleteFirstGraph,
  updateAllGraph,
  updateFirstGraph,
  upsertGraph,
} from '../../src/mutation-graph/collection-graphs';
import { InsertReportingKeys } from '../../src/mutation-graph/insert-reporting-keys';
import { emptyState } from '../../src/types';
import { baseContract, createCollectionFor, withoutCapabilityKeys } from '../collection-fixtures';
import { defineContract, field, model } from '../contract-builder';
import { buildTestContextFromContract, getTestContext } from '../helpers';
import { printGraph } from './print-graph';

const withoutReturning = withoutCapabilityKeys(baseContract, [
  'returning',
  'insertOnConflictTarget',
]);
const context = { ...getTestContext(), contract: withoutReturning };
const users = createCollectionFor('User', withoutReturning).collection.where({ name: 'Ada' });

function targetOf(state: typeof users.state) {
  return { context, state, modelName: 'User', namespaceId: 'public' };
}

const target = targetOf(users.state);
const ada = { id: 1, name: 'Ada', email: 'ada@example.com' };

const Counter = model('Counter', {
  fields: {
    id: field.column(int4Column).default(autoincrement()).id(),
    label: field.column(textColumn),
    slug: field.column(textColumn).unique(),
  },
}).sql({ table: 'counters' });
const Note = model('Note', {
  fields: {
    id: field.column(textColumn).defaultSql('gen_random_uuid()').id(),
    body: field.column(textColumn),
  },
}).sql({ table: 'notes' });
const generatedContract: Contract<SqlStorage> = {
  ...defineContract({ models: { Counter, Note } }),
  capabilities: { sql: { defaultInInsert: true } },
};
const generatedContext = {
  ...buildTestContextFromContract(generatedContract),
  contract: generatedContract,
};

function generatedTarget(modelName: 'Counter' | 'Note', tableName: string) {
  return {
    context: generatedContext,
    state: emptyState(createCollectionTables(generatedContract, 'public', modelName)),
    modelName,
    namespaceId: 'public',
    tableName,
  };
}

describe('write graphs on a contract without capability "returning"', () => {
  it('createAllGraph inserts, then reads the rows back by the keys the client wrote', () => {
    expect(printGraph(createAllGraph(target, [ada], undefined, 'rows'))).toBe(
      [
        'n1 InsertReportingKeys Insert users keys [{"id":1}]',
        'n2 FindByKeys users by (id) for create <- Rows n1',
        'result: n2',
      ].join('\n'),
    );
  });

  it('createAllGraph for a count is the insert alone', () => {
    expect(printGraph(createAllGraph(target, [ada], undefined, 'count'))).toBe(
      ['n1 Insert users', 'result: n1'].join('\n'),
    );
  });

  it('createAllGraph reads one generated key, decoded with its column codec', async () => {
    const graph = createAllGraph(
      generatedTarget('Counter', 'counters'),
      [{ label: 'a', slug: 'a' }],
      undefined,
      'rows',
    );
    const [[, insert] = []] = graph.nodes();

    expect(insert).toBeInstanceOf(InsertReportingKeys);
    const generated = (insert as InsertReportingKeys).generated;
    expect({ column: generated?.column, value: await generated?.decode('42') }).toEqual({
      column: 'id',
      value: 42,
    });
  });

  it('refuses createAllGraph of several rows whose keys the database generates', () => {
    expect(() =>
      createAllGraph(
        generatedTarget('Counter', 'counters'),
        [{ label: 'a' }, { label: 'b' }],
        undefined,
        'rows',
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.CAPABILITY_MISSING',
        meta: expect.objectContaining({ action: 'createAll()' }),
      }),
    );
  });

  it('refuses createAllGraph when a key column gets a database default that is not auto-increment', () => {
    expect(() =>
      createAllGraph(generatedTarget('Note', 'notes'), [{ body: 'a' }], undefined, 'rows'),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.CAPABILITY_MISSING',
        meta: expect.objectContaining({ action: 'create()' }),
      }),
    );
  });

  it('refuses createAllGraph that skips conflicting rows and returns them', () => {
    expect(() => createAllGraph(target, [ada], { columns: [] }, 'rows')).toThrow(
      expect.objectContaining({ code: 'ORM.CAPABILITY_MISSING' }),
    );
  });

  it('refuses createAllGraph on a table with no row identity', () => {
    const tables = createCollectionTables(withoutReturning, 'public', 'User');
    const noIdentity = targetOf({
      ...users.state,
      tables: {
        ...tables,
        root: tables.scope.aliasTable({ namespaceId: 'public', tableName: 'no_such_table' }),
      },
    });

    expect(() => createAllGraph(noIdentity, [ada], undefined, 'rows')).toThrow(
      expect.objectContaining({ code: 'ORM.ROW_IDENTITY_MISSING' }),
    );
  });

  it('updateFirstGraph updates the found row, then reads it back by its key, with a key it sets', () => {
    expect(printGraph(updateFirstGraph(target, { id: 5, name: 'Ada L.' }))).toBe(
      [
        "n1 Find users where name = 'Ada' limit 1",
        "n2 Update users set id = 5, name = 'Ada L.' <- FilterData n1 (id->id)",
        'n3 Find users <- FilterData n1 (id->id) with {"id":5}',
        'result: n3',
      ].join('\n'),
    );
  });

  it('updateAllGraph finds the keys, updates with the caller filter, then reads the rows back', () => {
    expect(printGraph(updateAllGraph(target, { name: 'Pioneer' }, 'rows'))).toBe(
      [
        "n1 Find users where name = 'Ada'",
        "n2 Update users set name = 'Pioneer' where name = 'Ada'",
        'n3 Find users <- FilterData n1 (id->id)',
        'result: n3',
      ].join('\n'),
    );
    expect(printGraph(updateAllGraph(target, { name: 'Pioneer' }, 'count'))).toBe(
      ["n1 Update users set name = 'Pioneer' where name = 'Ada'", 'result: n1'].join('\n'),
    );
  });

  it('deleteFirstGraph and deleteAllGraph read the rows before deleting them', () => {
    expect({
      first: printGraph(deleteFirstGraph(target)),
      all: printGraph(deleteAllGraph(target, 'rows')),
      count: printGraph(deleteAllGraph(target, 'count')),
    }).toEqual({
      first: [
        "n1 Find users where name = 'Ada' limit 1",
        'n2 Delete users <- FilterData n1 (id->id)',
        'result: n1',
      ].join('\n'),
      all: [
        "n1 Find users where name = 'Ada'",
        "n2 Delete users where name = 'Ada'",
        'result: n1',
      ].join('\n'),
      count: ["n1 Delete users where name = 'Ada'", 'result: n1'].join('\n'),
    });
  });

  it('upsertGraph names no conflict columns and reads the row back by the create values', () => {
    const counters = generatedTarget('Counter', 'counters');

    expect(
      printGraph(upsertGraph(counters, { label: 'a', slug: 'a' }, { label: 'b' }, ['slug'])),
    ).toBe(
      [
        'n1 InsertReportingKeys Insert counters on conflict do update keys [{"slug":"a"}]',
        'n2 FindByKeys counters by (slug) for upsert <- Rows n1',
        'result: n2',
      ].join('\n'),
    );
  });

  it('refuses upsertGraph when the create values can collide on another unique key', () => {
    expect(() => upsertGraph(target, ada, { name: 'b' }, ['email'])).toThrow(
      expect.objectContaining({
        code: 'ORM.CAPABILITY_MISSING',
        meta: expect.objectContaining({ capability: 'insertOnConflictTarget' }),
      }),
    );
  });

  it.each([
    ['updates a conflict column', { label: 'a', slug: 'a' }, { slug: 'b' }],
    ['gives a conflict column no create value', { label: 'a' }, { label: 'b' }],
  ])('refuses upsertGraph that %s', (_case, create, update) => {
    expect(() =>
      upsertGraph(generatedTarget('Counter', 'counters'), create, update, ['slug']),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.CAPABILITY_MISSING',
        meta: expect.objectContaining({ capability: 'returning' }),
      }),
    );
  });
});
