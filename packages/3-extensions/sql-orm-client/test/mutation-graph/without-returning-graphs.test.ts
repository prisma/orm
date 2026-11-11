import { describe, expect, it } from 'vitest';
import { createCollectionTables } from '../../src/collection-tables';
import {
  createAllGraph,
  createGraph,
  deleteAllGraph,
  deleteFirstGraph,
  updateAllGraph,
  updateFirstGraph,
  upsertGraph,
} from '../../src/mutation-graph/collection-graphs';
import { executeGraph, queryGraph } from '../../src/mutation-graph/run-graph';
import { parseMutationInput } from '../../src/relation-mutations';
import { emptyState } from '../../src/types';
import { baseContract, createCollectionFor, withoutCapabilityKeys } from '../collection-fixtures';
import { createMockRuntime, getTestContext } from '../helpers';
import { generatedContext } from './generated-keys-contract';
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

function generatedTarget(modelName: 'Counter' | 'Note', tableName: string) {
  return {
    context: generatedContext,
    state: emptyState(createCollectionTables(generatedContext.contract, 'public', modelName)),
    modelName,
    namespaceId: 'public',
    tableName,
  };
}

describe('write graphs on a contract without capability "returning"', () => {
  it('createAllGraph inserts, then reads the rows back by their keys', () => {
    expect(printGraph(createAllGraph(target, [ada], undefined, 'rows'))).toBe(
      ['n1 Insert users', 'n2 FindByKeys users by (id) for create <- Rows n1', 'result: n2'].join(
        '\n',
      ),
    );
  });

  it('createAllGraph for a count is the insert alone', () => {
    expect(printGraph(createAllGraph(target, [ada], undefined, 'count'))).toBe(
      ['n1 Insert users', 'result: n1'].join('\n'),
    );
  });

  it('refuses, before running anything, createAllGraph of several rows whose keys the database generates', async () => {
    const counters = generatedTarget('Counter', 'counters');
    const runtime = createMockRuntime();
    const graph = createAllGraph(counters, [{ label: 'a' }, { label: 'b' }], undefined, 'rows');

    await expect(
      queryGraph(graph, { runtime, context: generatedContext }, counters).toArray(),
    ).rejects.toMatchObject({
      code: 'ORM.CAPABILITY_MISSING',
      meta: { capability: 'returning', action: 'createAll()' },
    });
    expect(runtime.executions).toEqual([]);
  });

  it('counts the rows of createAllGraph for a count whose keys the database generates', async () => {
    const runtime = createMockRuntime();
    runtime.setNextStats([{ affectedRows: 2 }]);
    const graph = createAllGraph(
      generatedTarget('Counter', 'counters'),
      [{ label: 'a' }, { label: 'b' }],
      undefined,
      'count',
    );

    expect(await executeGraph(graph, { runtime, context: generatedContext })).toEqual({
      affectedRows: 2,
    });
  });

  it('refuses, before running anything, createAllGraph when a key column gets a database default that is not auto-increment', async () => {
    const notes = generatedTarget('Note', 'notes');
    const graph = createAllGraph(notes, [{ body: 'a' }], undefined, 'rows');

    await expect(
      queryGraph(
        graph,
        { runtime: createMockRuntime(), context: generatedContext },
        notes,
      ).toArray(),
    ).rejects.toMatchObject({
      code: 'ORM.CAPABILITY_MISSING',
      meta: { capability: 'returning', action: 'create()' },
    });
  });

  it('refuses, before running anything, a nested create whose key column gets a database default that is not auto-increment', async () => {
    const runtime = createMockRuntime();
    const notes = generatedTarget('Note', 'notes');
    const graph = createGraph(
      notes,
      parseMutationInput(generatedContext.contract, 'public', 'Note', { body: 'a' } as never),
    );

    await expect(
      queryGraph(graph, { runtime, context: generatedContext }, notes).toArray(),
    ).rejects.toMatchObject({
      code: 'ORM.CAPABILITY_MISSING',
      meta: { capability: 'returning', action: 'create()' },
    });
    expect(runtime.executions).toEqual([]);
  });

  it('refuses createAll() that skips conflicting rows and returns them, when it is called', () => {
    const { collection } = createCollectionFor('User', withoutReturning);

    expect(() => collection.createAll([ada], { onConflict: 'skip' })).toThrow(
      expect.objectContaining({ code: 'ORM.CAPABILITY_MISSING' }),
    );
  });

  it('updateFirstGraph updates the found row, then reads it back by the key the Update gives, which it may set', () => {
    expect(printGraph(updateFirstGraph(target, { id: 5, name: 'Ada L.' }))).toBe(
      [
        "n1 Find users where name = 'Ada' limit 1",
        "n2 Update users set id = 5, name = 'Ada L.' <- FilterData n1 (id->id)",
        'n3 Find users <- FilterData n2 (id->id)',
        'result: n3',
      ].join('\n'),
    );
  });

  it('updateAllGraph finds the keys, updates the rows with the caller filter and the keys, then reads the rows back by the keys the Update gives', () => {
    expect(printGraph(updateAllGraph(target, { name: 'Pioneer' }, 'rows'))).toBe(
      [
        "n1 Find users where name = 'Ada'",
        "n2 Update users set name = 'Pioneer' where name = 'Ada' <- FilterData n1 (id->id)",
        'n3 Find users <- FilterData n2 (id->id)',
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
        'n1 Insert counters on conflict do update',
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
  ])('refuses, before running anything, upsertGraph that %s', async (_case, create, update) => {
    const counters = generatedTarget('Counter', 'counters');
    const runtime = createMockRuntime();
    const graph = upsertGraph(counters, create, update, ['slug']);

    await expect(
      queryGraph(graph, { runtime, context: generatedContext }, counters).toArray(),
    ).rejects.toMatchObject({
      code: 'ORM.CAPABILITY_MISSING',
      meta: { capability: 'returning', action: 'upsert()' },
    });
    expect(runtime.executions).toEqual([]);
  });
});
