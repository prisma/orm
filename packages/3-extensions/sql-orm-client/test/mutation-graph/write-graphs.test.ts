import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import {
  createAllGraph,
  createGraph,
  deleteAllGraph,
  deleteFirstGraph,
  updateAllGraph,
  updateFirstGraph,
  upsertGraph,
} from '../../src/mutation-graph/collection-graphs';
import type { Graph } from '../../src/mutation-graph/graph';
import { removeUnreadFinds } from '../../src/mutation-graph/remove-unread-finds';
import { parseMutationInput } from '../../src/relation-mutations';
import type { RelationMutator } from '../../src/types';
import { baseContract, createCollectionFor, withoutCapabilityKeys } from '../collection-fixtures';
import { getTestContext } from '../helpers';
import { printGraph } from './print-graph';

type Mutator = RelationMutator<Contract<SqlStorage>, string>;

const withReturning = getTestContext();
const withoutReturning = {
  ...getTestContext(),
  contract: withoutCapabilityKeys(baseContract, ['returning']),
};
const ada = { id: 1, name: 'Ada', email: 'ada@example.com' };
const grace = { id: 2, name: 'Grace', email: 'grace@example.com' };

function usersOf(context: typeof withReturning, includePosts = false) {
  const users = createCollectionFor('User', context.contract).collection.where({ name: 'Ada' });
  const state = includePosts ? users.include('posts').state : users.state;
  return { context, state, modelName: 'User', namespaceId: 'public' };
}

function parsed(context: typeof withReturning, data: Record<string, unknown>) {
  return parseMutationInput(context.contract, 'public', 'User', data as never);
}

function asRun(graph: Graph): string {
  removeUnreadFinds(graph);
  return printGraph(graph);
}

function lines(...printed: string[]): string {
  return printed.join('\n');
}

const nestedCreate = {
  ...ada,
  invitedBy: (inviter: Mutator) => inviter.create(grace),
  posts: (posts: Mutator) => posts.create([{ id: 10, title: 'Hello', views: 0 }]),
};
const nestedUpdate = { posts: (posts: Mutator) => posts.connect({ id: 10 }) };

describe('write graphs as they run, on a contract with returning', () => {
  const context = withReturning;

  it('create() is one Insert that returns the row', () => {
    expect(asRun(createGraph(usersOf(context), parsed(context, ada)))).toBe(
      lines('n1 Insert users', 'result: n1'),
    );
  });

  it('create() with includes reads its row back by key with its includes', () => {
    expect(asRun(createGraph(usersOf(context, true), parsed(context, ada)))).toBe(
      lines('n1 Insert users', 'n2 FindByKeys users by (id) for create <- Rows n1', 'result: n2'),
    );
  });

  it('create() with relation operations inserts the related rows around the row', () => {
    expect(asRun(createGraph(usersOf(context), parsed(context, nestedCreate)))).toBe(
      lines(
        'n1 Insert users',
        'n2 Insert users <- PayloadData n1 (id->invited_by_id)',
        'n3 Insert posts <- PayloadData n2 (id->user_id)',
        'result: n2',
      ),
    );
  });

  it('createAll() is one Insert that returns the rows, and createAndCount() the Insert alone', () => {
    expect({
      rows: asRun(createAllGraph(usersOf(context), [ada, grace], undefined, 'rows')),
      count: asRun(createAllGraph(usersOf(context), [ada, grace], undefined, 'count')),
    }).toEqual({
      rows: lines('n1 Insert users 2 rows', 'result: n1'),
      count: lines('n1 Insert users 2 rows', 'result: n1'),
    });
  });

  it('upsert() is one Insert that returns the row', () => {
    expect(asRun(upsertGraph(usersOf(context), ada, { name: 'Ada L.' }, ['email']))).toBe(
      lines('n1 Insert users on conflict (email) do update', 'result: n1'),
    );
  });

  it('updateAll() is one Update, and updateAndCount() too', () => {
    expect({
      rows: asRun(updateAllGraph(usersOf(context), { name: 'Grace' }, 'rows')),
      count: asRun(updateAllGraph(usersOf(context), { name: 'Grace' }, 'count')),
    }).toEqual({
      rows: lines("n1 Update users set name = 'Grace' where name = 'Ada'", 'result: n1'),
      count: lines("n1 Update users set name = 'Grace' where name = 'Ada'", 'result: n1'),
    });
  });

  it('update() finds the row and updates it, and the Update returns it', () => {
    expect(asRun(updateFirstGraph(usersOf(context), { name: 'Grace' }))).toBe(
      lines(
        "n1 Find users where name = 'Ada' limit 1",
        "n2 Update users set name = 'Grace' <- FilterData n1 (id->id)",
        'result: n2',
      ),
    );
  });

  it('update() with relation operations runs them with the key of the Update', () => {
    expect(
      asRun(
        updateFirstGraph(
          usersOf(context),
          { name: 'Grace' },
          parsed(context, nestedUpdate).relationMutations,
        ),
      ),
    ).toBe(
      lines(
        "n1 Find users where name = 'Ada' limit 1",
        "n2 Update users set name = 'Grace' <- FilterData n1 (id->id)",
        'n3 Update posts set nothing where id = 10 <- PayloadData n2 (id->user_id)',
        'result: n2',
      ),
    );
  });

  it('deleteAll() is one Delete, and deleteAndCount() too', () => {
    expect({
      rows: asRun(deleteAllGraph(usersOf(context), 'rows')),
      count: asRun(deleteAllGraph(usersOf(context), 'count')),
    }).toEqual({
      rows: lines("n1 Delete users where name = 'Ada'", 'result: n1'),
      count: lines("n1 Delete users where name = 'Ada'", 'result: n1'),
    });
  });

  it('delete() finds the row and deletes it, and the Delete returns it', () => {
    expect(asRun(deleteFirstGraph(usersOf(context)))).toBe(
      lines(
        "n1 Find users where name = 'Ada' limit 1",
        'n2 Delete users <- FilterData n1 (id->id)',
        'result: n2',
      ),
    );
  });
});

describe('write graphs as they run, on a contract without returning', () => {
  const context = withoutReturning;

  it('create() inserts the row and reads it back by key', () => {
    expect(asRun(createGraph(usersOf(context), parsed(context, ada)))).toBe(
      lines('n1 Insert users', 'n2 FindByKeys users by (id) for create <- Rows n1', 'result: n2'),
    );
  });

  it('create() with relation operations reads back the rows later nodes and the result read', () => {
    expect(asRun(createGraph(usersOf(context), parsed(context, nestedCreate)))).toBe(
      lines(
        'n1 Insert users',
        'n2 FindByKeys users by (id) for create <- Rows n1',
        'n3 Insert users <- PayloadData n2 (id->invited_by_id)',
        'n4 Insert posts <- PayloadData n3 (id->user_id)',
        'n5 FindByKeys users by (id) for create <- Rows n3',
        'result: n5',
      ),
    );
  });

  it('createAll() inserts the rows and reads them back by key, and createAndCount() only inserts', () => {
    expect({
      rows: asRun(createAllGraph(usersOf(context), [ada, grace], undefined, 'rows')),
      count: asRun(createAllGraph(usersOf(context), [ada, grace], undefined, 'count')),
    }).toEqual({
      rows: lines(
        'n1 Insert users 2 rows',
        'n2 FindByKeys users by (id) for createAll <- Rows n1',
        'result: n2',
      ),
      count: lines('n1 Insert users 2 rows', 'result: n1'),
    });
  });

  it('upsert() reads its row back by the conflict columns', () => {
    expect(asRun(upsertGraph(usersOf(context), ada, { name: 'Ada L.' }, ['email']))).toBe(
      lines(
        'n1 Insert users on conflict (email) do update',
        'n2 FindByKeys users by (email) for upsert <- Rows n1',
        'result: n2',
      ),
    );
  });

  it('updateAll() finds the keys, updates and reads the rows back, and updateAndCount() only updates', () => {
    expect({
      rows: asRun(updateAllGraph(usersOf(context), { name: 'Grace' }, 'rows')),
      count: asRun(updateAllGraph(usersOf(context), { name: 'Grace' }, 'count')),
    }).toEqual({
      rows: lines(
        "n1 Find users where name = 'Ada'",
        "n2 Update users set name = 'Grace' where name = 'Ada' <- FilterData n1 (id->id)",
        'n3 Find users <- FilterData n2 (id->id)',
        'result: n3',
      ),
      count: lines("n1 Update users set name = 'Grace' where name = 'Ada'", 'result: n1'),
    });
  });

  it('update() with relation operations runs them, then reads the row back', () => {
    expect(
      asRun(
        updateFirstGraph(
          usersOf(context),
          { name: 'Grace' },
          parsed(context, nestedUpdate).relationMutations,
        ),
      ),
    ).toBe(
      lines(
        "n1 Find users where name = 'Ada' limit 1",
        "n2 Update users set name = 'Grace' <- FilterData n1 (id->id)",
        'n3 Update posts set nothing where id = 10 <- PayloadData n2 (id->user_id)',
        'n4 Find users <- FilterData n2 (id->id)',
        'result: n4',
      ),
    );
  });

  it('deleteAll() and delete() read the rows before deleting them, and deleteAndCount() only deletes', () => {
    expect({
      all: asRun(deleteAllGraph(usersOf(context), 'rows')),
      first: asRun(deleteFirstGraph(usersOf(context))),
      count: asRun(deleteAllGraph(usersOf(context), 'count')),
    }).toEqual({
      all: lines(
        "n1 Find users where name = 'Ada'",
        "n2 Delete users where name = 'Ada'",
        'result: n1',
      ),
      first: lines(
        "n1 Find users where name = 'Ada' limit 1",
        'n2 Delete users <- FilterData n1 (id->id)',
        'result: n1',
      ),
      count: lines("n1 Delete users where name = 'Ada'", 'result: n1'),
    });
  });
});
