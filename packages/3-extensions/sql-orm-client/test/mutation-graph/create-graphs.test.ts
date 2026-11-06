import { describe, expect, it } from 'vitest';
import { createStatementTables } from '../../src/collection-tables';
import { createAllGraph, upsertGraph } from '../../src/mutation-graph/collection-graphs';
import type { CollectionState } from '../../src/types';
import { createCollectionFor, withoutDefaultInInsert } from '../collection-fixtures';
import { getTestContext } from '../helpers';
import { printGraph } from './print-graph';
import { returnedAt } from './statements';

const users = createCollectionFor('User').collection.select('id', 'name');
const contextWithoutDefault = { ...getTestContext(), contract: withoutDefaultInInsert() };

function targetOf(state: CollectionState, context = getTestContext()) {
  return { context, state, modelName: 'User', namespaceId: 'public' };
}

const target = targetOf(users.state);
const targetWithIncludes = targetOf(users.include('posts').state);
const ada = { id: 1, name: 'Ada', email: 'ada@example.com' };
const grace = { id: 2, name: 'Grace', email: 'grace@example.com' };

describe('createAllGraph', () => {
  it('builds no node for no rows', () => {
    expect(printGraph(createAllGraph(target, [], undefined, 'rows'))).toBe('result: none');
  });

  it('builds one Insert of every row as the result when the target fills a missing column with DEFAULT', () => {
    const graph = createAllGraph(
      target,
      [ada, grace, { id: 3, name: 'Edsger' }],
      undefined,
      'rows',
    );

    expect(printGraph(graph)).toBe(['n1 Insert users 3 rows', 'result: n1'].join('\n'));
    expect(returnedAt(graph, 0)).toEqual([]);
  });

  it('builds an InsertChunked of one statement when the rows set the same columns, without DEFAULT in a row', () => {
    const graph = createAllGraph(
      targetOf(users.state, contextWithoutDefault),
      [ada, grace],
      undefined,
      'rows',
    );

    expect(printGraph(graph)).toBe(
      ['n1 InsertChunked users (1 statement)', 'result: n1'].join('\n'),
    );
  });

  it('builds an InsertChunked of the runs of rows that set the same columns, in their order', () => {
    const graph = createAllGraph(
      targetOf(users.state, contextWithoutDefault),
      [ada, { id: 3, name: 'Edsger' }, grace],
      undefined,
      'rows',
    );

    expect(printGraph(graph)).toBe(
      ['n1 InsertChunked users (3 statements)', 'result: n1'].join('\n'),
    );
  });

  it('asks the database to skip rows that collide with the conflict columns', () => {
    const graph = createAllGraph(target, [ada], { columns: ['email'] }, 'rows');

    expect(printGraph(graph)).toBe(
      ['n1 Insert users on conflict (email) do nothing', 'result: n1'].join('\n'),
    );
  });

  it('adds a Find that reads the inserted rows with their includes, as the result', () => {
    const graph = createAllGraph(targetWithIncludes, [ada, grace], undefined, 'rows');

    expect(printGraph(graph)).toBe(
      ['n1 Insert users 2 rows', 'n2 Find users <- FilterData n1 (id->id)', 'result: n2'].join(
        '\n',
      ),
    );
    expect(returnedAt(graph, 0)).toEqual(['id']);
    expect(returnedAt(graph, 1)).toEqual(['id', 'name', 'posts']);
  });

  it('refuses includes on a table with no identity columns', () => {
    const tables = createStatementTables({ namespaceId: 'public', tableName: 'no_such_table' });

    expect(() =>
      createAllGraph(
        targetOf({ ...users.include('posts').state, tables }),
        [ada],
        undefined,
        'rows',
      ),
    ).toThrow(expect.objectContaining({ code: 'ORM.ROW_IDENTITY_MISSING' }));
  });
});

describe('upsertGraph', () => {
  it('builds one Insert whose conflict clause sets the update values, as the result', () => {
    const graph = upsertGraph(target, ada, { name: 'Ada L.' }, ['email']);

    expect(printGraph(graph)).toBe(
      ['n1 Insert users on conflict (email) do update', 'result: n1'].join('\n'),
    );
  });

  it('builds the same graph when nothing is to be updated', () => {
    const graph = upsertGraph(target, ada, {}, ['email']);

    expect(printGraph(graph)).toBe(
      ['n1 Insert users on conflict (email) do update', 'result: n1'].join('\n'),
    );
  });

  it('adds a Find that reads the upserted row with its includes, as the result', () => {
    const graph = upsertGraph(targetWithIncludes, ada, { name: 'Ada L.' }, ['email']);

    expect(printGraph(graph)).toBe(
      [
        'n1 Insert users on conflict (email) do update',
        'n2 Find users <- FilterData n1 (id->id)',
        'result: n2',
      ].join('\n'),
    );
  });
});
