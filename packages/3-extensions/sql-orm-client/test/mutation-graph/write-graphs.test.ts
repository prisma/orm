import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
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
import type { Graph } from '../../src/mutation-graph/graph';
import { executeGraph, queryGraph } from '../../src/mutation-graph/run-graph';
import { parseMutationInput } from '../../src/relation-mutations';
import { emptyState, type RelationMutator } from '../../src/types';
import {
  baseContract,
  createCollectionFor,
  withoutCapabilityKeys,
  withReturningCapability,
} from '../collection-fixtures';
import { buildMixedPolyContract, createMockRuntime, getTestContext } from '../helpers';
import { generatedContext } from './generated-keys-contract';
import { printGraph } from './print-graph';

type Mutator = RelationMutator<Contract<SqlStorage>, string>;

const withReturning = getTestContext();
const withoutReturning = {
  ...getTestContext(),
  contract: withoutCapabilityKeys(baseContract, ['returning']),
};
const withoutConflictTarget = {
  ...getTestContext(),
  contract: withoutCapabilityKeys(baseContract, ['returning', 'insertOnConflictTarget']),
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

function asRun(graph: Graph, state = false): string {
  graph.removeUnreadFinds();
  return printGraph(graph, { state });
}

function generatedTarget(modelName: 'Counter' | 'Note' | 'Owner') {
  return {
    context: generatedContext,
    state: emptyState(createCollectionTables(generatedContext.contract, 'public', modelName)),
    modelName,
    namespaceId: 'public',
  };
}

function generatedCreate(modelName: 'Note' | 'Owner', data: Record<string, unknown>) {
  return createGraph(
    generatedTarget(modelName),
    parseMutationInput(generatedContext.contract, 'public', modelName, data as never),
  );
}

async function refusalOf(
  graph: Graph,
  target: Parameters<typeof queryGraph>[2] = generatedTarget('Counter'),
) {
  const runtime = createMockRuntime();
  const error = await queryGraph(graph, { runtime, context: target.context }, target)
    .toArray()
    .catch((caught: unknown) => caught);
  return { error, executions: runtime.executions };
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

  it('create() with includes reads its row back by key with its includes, after the Insert', () => {
    expect(asRun(createGraph(usersOf(context, true), parsed(context, ada)), true)).toBe(
      lines(
        'n1 State users',
        'n2 Insert users <- state n1',
        'n3 State users <- state n2',
        'n4 State posts',
        'n5 FindByKeys users by (id) for create <- Rows n2, state n3, state n4',
        'result: n5',
      ),
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

  it('delete() finds the row, which is the result, and deletes it', () => {
    expect(asRun(deleteFirstGraph(usersOf(context)))).toBe(
      lines(
        "n1 Find users where name = 'Ada' limit 1",
        'n2 Delete users <- FilterData n1 (id->id)',
        'result: n1',
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

  it('create() with relation operations reads back the rows later nodes and the result read, after the writes they read', () => {
    expect(asRun(createGraph(usersOf(context, true), parsed(context, nestedCreate)), true)).toBe(
      lines(
        'n1 State users',
        'n2 Insert users <- state n1',
        'n3 State users <- state n2',
        'n4 FindByKeys users by (id) for create <- Rows n2, state n3',
        'n5 Insert users <- PayloadData n4 (id->invited_by_id), state n3',
        'n6 State users <- state n5',
        'n7 State posts',
        'n8 Insert posts <- PayloadData n5 (id->user_id), state n7',
        'n9 State posts <- state n8',
        'n10 FindByKeys users by (id) for create <- Rows n5, state n6, state n9',
        'result: n10',
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

  it('createAll() that skips conflicting rows is refused before running anything, and createAndCount() counts', async () => {
    const target = usersOf(context);
    const runtime = createMockRuntime();
    runtime.setNextStats([{ affectedRows: 1 }]);
    const count = createAllGraph(target, [ada], { columns: [] }, 'count');

    expect({
      rows: await refusalOf(createAllGraph(target, [ada], { columns: [] }, 'rows'), target),
      count: await executeGraph(count, { runtime, context }),
    }).toMatchObject({
      rows: {
        error: {
          code: 'ORM.CAPABILITY_MISSING',
          message:
            'create() with onConflict "skip" on model "User" requires contract capability "returning": without it the rows are read back by key, which finds a skipped row\'s existing match. Use createAndCount() to skip conflicting rows.',
          meta: { capability: 'returning', action: 'create()' },
        },
        executions: [],
      },
      count: { affectedRows: 1 },
    });
  });

  it('create() and createAll() of a row whose key gets a database default that is not auto-increment are refused before running anything', async () => {
    const notes = generatedTarget('Note');
    const refusal = {
      error: {
        code: 'ORM.CAPABILITY_MISSING',
        meta: { capability: 'returning', action: 'create()' },
      },
      executions: [],
    };

    expect({
      create: await refusalOf(generatedCreate('Note', { body: 'a' }), notes),
      createAll: await refusalOf(createAllGraph(notes, [{ body: 'a' }], undefined, 'rows'), notes),
    }).toMatchObject({ create: refusal, createAll: refusal });
  });

  it('create() inserts a child create nothing reads whose key a database default other than auto-increment fills', () => {
    const folders = (mutator: Mutator) => mutator.create([{ name: 'docs' }]);

    expect(asRun(generatedCreate('Owner', { id: 1, folders }))).toBe(
      lines(
        'n1 Insert owners',
        'n2 Insert folders <- PayloadData n1 (id->owner_id)',
        'n3 FindByKeys owners by (id) for create <- Rows n1',
        'result: n3',
      ),
    );
  });

  it('create() with a child create whose own child creates read its database-default key is refused before running anything', async () => {
    const pages = (mutator: Mutator) => mutator.create([{ id: 1 }]);
    const folders = (mutator: Mutator) => mutator.create([{ name: 'docs', pages }]);

    expect(
      await refusalOf(generatedCreate('Owner', { id: 1, folders }), generatedTarget('Owner')),
    ).toMatchObject({
      error: {
        code: 'ORM.CAPABILITY_MISSING',
        message: expect.stringContaining(
          'create() on model "Folder" cannot find the row it inserts',
        ),
      },
      executions: [],
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

  it('upsert() without insertOnConflictTarget names no conflict columns and reads the row back by the create values', () => {
    expect(
      asRun(
        upsertGraph(generatedTarget('Counter'), { label: 'a', slug: 'a' }, { label: 'b' }, [
          'slug',
        ]),
      ),
    ).toBe(
      lines(
        'n1 Insert counters on conflict do update',
        'n2 FindByKeys counters by (slug) for upsert <- Rows n1',
        'result: n2',
      ),
    );
  });

  it('upsert() without insertOnConflictTarget is refused when the create values can collide on another unique key', () => {
    expect(() =>
      upsertGraph(usersOf(withoutConflictTarget), ada, { name: 'b' }, ['email']),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.CAPABILITY_MISSING',
        meta: expect.objectContaining({ capability: 'insertOnConflictTarget' }),
      }),
    );
  });

  it.each([
    ['updates a conflict column', { label: 'a', slug: 'a' }, { slug: 'b' }],
    ['gives a conflict column no create value', { label: 'a' }, { label: 'b' }],
  ])('upsert() that %s is refused before running anything', async (_case, create, update) => {
    expect(
      await refusalOf(upsertGraph(generatedTarget('Counter'), create, update, ['slug'])),
    ).toMatchObject({
      error: {
        code: 'ORM.CAPABILITY_MISSING',
        meta: { capability: 'returning', action: 'upsert()' },
      },
      executions: [],
    });
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

  it('update() with relation operations runs them, then reads the row back by the key the Update gives, after the writes', () => {
    expect(
      asRun(
        updateFirstGraph(
          usersOf(context, true),
          { id: 5, name: 'Grace' },
          parsed(context, nestedUpdate).relationMutations,
        ),
        true,
      ),
    ).toBe(
      lines(
        'n1 State users',
        "n2 Find users where name = 'Ada' limit 1 <- state n1",
        "n3 Update users set id = 5, name = 'Grace' <- FilterData n2 (id->id), state n1",
        'n4 State users <- state n3',
        'n5 State posts',
        'n6 Update posts set nothing where id = 10 <- PayloadData n3 (id->user_id), state n5',
        'n7 State posts <- state n6',
        'n8 Find users <- FilterData n3 (id->id), state n4, state n7',
        'result: n8',
      ),
    );
  });

  it('deleteAll() and delete() read the rows before deleting the rows they found by key, and deleteAndCount() only deletes', () => {
    expect({
      all: asRun(deleteAllGraph(usersOf(context, true), 'rows'), true),
      first: asRun(deleteFirstGraph(usersOf(context)), true),
      count: asRun(deleteAllGraph(usersOf(context), 'count')),
    }).toEqual({
      all: lines(
        'n1 State users',
        'n2 State posts',
        "n3 Find users where name = 'Ada' <- state n1, state n2",
        "n4 Delete users where name = 'Ada' <- FilterData n3 (id->id), state n1",
        'n5 State users <- state n4',
        'result: n3',
      ),
      first: lines(
        'n1 State users',
        "n2 Find users where name = 'Ada' limit 1 <- state n1",
        'n3 Delete users <- FilterData n2 (id->id), state n1',
        'n4 State users <- state n3',
        'result: n2',
      ),
      count: lines("n1 Delete users where name = 'Ada'", 'result: n1'),
    });
  });
});

describe('write graphs of a polymorphic base model with a variant in its own table', () => {
  const contract = withReturningCapability(buildMixedPolyContract());
  const context = { ...getTestContext(), contract };
  const tasks = createCollectionFor('Task' as never, contract).collection.where({ title: 'Crash' });
  const target = { context, state: tasks.state, modelName: 'Task', namespaceId: 'public' };

  it('reads the rows back with the variant joins after updateAll()', () => {
    expect(asRun(updateAllGraph(target, { title: 'Crash!' }, 'rows'))).toBe(
      lines(
        "n1 Update tasks set title = 'Crash!' where title = 'Crash'",
        'n2 Find tasks <- FilterData n1 (id->id)',
        'result: n2',
      ),
    );
  });
});
