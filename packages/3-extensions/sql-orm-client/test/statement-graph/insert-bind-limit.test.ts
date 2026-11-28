import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { collectOrderedParamRefs } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { parseMutationInput } from '../../src/relation-mutations';
import { createAllGraph, createGraph } from '../../src/statement-graph/collection-graphs';
import { executeGraph } from '../../src/statement-graph/run-graph';
import type { RelationMutator } from '../../src/types';
import {
  baseContract,
  createCollectionFor,
  relatedCollectionOf,
  withTarget,
} from '../collection-fixtures';
import { createMockRuntime, getTestContext } from '../helpers';
import { printGraph } from './print-graph';

const users = createCollectionFor('User').collection.select('id', 'name');
const contextMysql = { ...getTestContext(), contract: withTarget(baseContract, 'mysql') };
const contextSqlite = { ...getTestContext(), contract: withTarget(baseContract, 'sqlite') };

function targetOf(context = getTestContext()) {
  return { context, state: users.state, modelName: 'User', namespaceId: 'public' };
}

const target = targetOf();

function rowOf(i: number, columns: readonly string[]): Record<string, unknown> {
  const value = (column: string) => (column === 'id' ? i + 1 : `u${i}`);
  return Object.fromEntries(columns.map((column) => [column, value(column)]));
}

function rowsOf(count: number, columns: readonly string[]): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => rowOf(i, columns));
}

const fourColumns = ['id', 'name', 'email', 'address'];
const threeColumns = ['id', 'name', 'email'];
const overWireLimitRows = rowsOf(16_384, fourColumns);

function thrownOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('createAllGraph bind-parameter limit', () => {
  it('refuses a createAll whose one statement binds more parameters than the target allows, before sending', () => {
    const thrown = thrownOf(() => createAllGraph(target, overWireLimitRows, undefined, 'rows'));

    expect(thrown).toMatchObject({
      code: 'ORM.ARGUMENT_INVALID',
      message:
        'createAll() on model "User" would bind 65536 parameters in one INSERT statement; PostgreSQL allows 65535 per statement.',
      meta: {
        problem: 'too-many-bind-parameters',
        method: 'createAll()',
        model: 'User',
        parameters: 65_536,
        limit: 65_535,
        target: 'postgres',
      },
    });
  });

  it('keeps one Insert of every row while the statement binds under the limit', () => {
    const graph = createAllGraph(target, rowsOf(16_383, fourColumns), undefined, 'rows');

    expect(printGraph(graph)).toBe(['n1 Insert users 16383 rows', 'result: n1'].join('\n'));
  });

  it('keeps one Insert of every row at exactly the limit', () => {
    const graph = createAllGraph(target, rowsOf(21_845, threeColumns), undefined, 'rows');

    expect(printGraph(graph)).toBe(['n1 Insert users 21845 rows', 'result: n1'].join('\n'));
  });

  it('names MySQL and its own limit on a mysql target', () => {
    const thrown = thrownOf(() =>
      createAllGraph(targetOf(contextMysql), overWireLimitRows, undefined, 'rows'),
    );

    expect(thrown).toMatchObject({
      code: 'ORM.ARGUMENT_INVALID',
      message:
        'createAll() on model "User" would bind 65536 parameters in one INSERT statement; MySQL allows 65535 per statement.',
      meta: { limit: 65_535, target: 'mysql' },
    });
  });

  it('builds the same statement on a target that declares no bind-parameter limit', () => {
    const graph = createAllGraph(targetOf(contextSqlite), overWireLimitRows, undefined, 'rows');

    expect(printGraph(graph)).toBe(['n1 Insert users 16384 rows', 'result: n1'].join('\n'));
  });

  it('refuses createAndCount() the same way and names createAndCount() as the operation', () => {
    const thrown = thrownOf(() => createAllGraph(target, overWireLimitRows, undefined, 'count'));

    expect(thrown).toMatchObject({
      code: 'ORM.ARGUMENT_INVALID',
      message:
        'createAndCount() on model "User" would bind 65536 parameters in one INSERT statement; PostgreSQL allows 65535 per statement.',
      meta: { problem: 'too-many-bind-parameters', method: 'createAndCount()' },
    });
  });
});

describe('nested insert bind-parameter limit', () => {
  // 21,845 rows x 3 columns pass the construction-time check at exactly 65,535 parameters.
  const postRows = Array.from({ length: 21_845 }, (_, i) => ({
    id: i + 1,
    title: `p${i}`,
    views: 0,
  }));

  function nestedGraphOf() {
    return createGraph(
      target,
      parseMutationInput(
        target.context.contract,
        'public',
        'User',
        {
          id: 1,
          name: 'Ada',
          email: 'ada@example.com',
          posts: (postsMutator: RelationMutator<Contract<SqlStorage>, 'Post'>) =>
            postsMutator.create(postRows),
        } as never,
        relatedCollectionOf(target.context),
      ),
    );
  }

  it('refuses a nested multi-row insert whose parent-key payload pushes it past the limit, before sending', async () => {
    const graph = nestedGraphOf();
    const runtime = createMockRuntime();
    // The parent's read-back row feeds the child's PayloadData edge.
    runtime.setNextResults([[{ id: 1 }]]);

    // The shared parent-key parameter of the payload joins the 65,535 row parameters, pushing the
    // statement to 65,536, one past the limit, at the moment withPayload applies it.
    await expect(executeGraph(graph, { runtime, context: target.context })).rejects.toMatchObject({
      code: 'ORM.ARGUMENT_INVALID',
      message:
        'create() on model "Post" would bind 65536 parameters in one INSERT statement; PostgreSQL allows 65535 per statement.',
      meta: expect.objectContaining({
        problem: 'too-many-bind-parameters',
        method: 'create()',
        model: 'Post',
        parameters: 65_536,
        limit: 65_535,
        target: 'postgres',
      }),
    });
    // The parent insert ran; only the nested insert is refused.
    expect(runtime.executions).toHaveLength(1);
  });
});

describe('nested insert bind-parameter limit on MySQL', () => {
  // 16,384 rows x 3 columns bind 49,152 parameters of their own, and the payload adds one parent-key
  // parameter that every row shares: 49,153 references, under the limit where a shared reference is
  // bound once. MySQL has only positional parameters, so its driver binds the shared one again in
  // every row: 16,384 x 4 = 65,536 values, one past its limit.
  const postRows = Array.from({ length: 16_384 }, (_, i) => ({
    id: i + 1,
    title: `p${i}`,
    views: 0,
  }));

  function nestedGraphOf(context: typeof target.context) {
    return createGraph(
      { ...target, context },
      parseMutationInput(
        context.contract,
        'public',
        'User',
        {
          id: 1,
          name: 'Ada',
          email: 'ada@example.com',
          posts: (postsMutator: RelationMutator<Contract<SqlStorage>, 'Post'>) =>
            postsMutator.create(postRows),
        } as never,
        relatedCollectionOf(context),
      ),
    );
  }

  it('refuses a nested insert whose shared payload parameter is bound once per row, past the MySQL limit', async () => {
    const graph = nestedGraphOf(contextMysql);
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }]]);

    await expect(executeGraph(graph, { runtime, context: contextMysql })).rejects.toMatchObject({
      code: 'ORM.ARGUMENT_INVALID',
      message:
        'create() on model "Post" would bind 65536 parameters in one INSERT statement; MySQL allows 65535 per statement.',
      meta: expect.objectContaining({
        problem: 'too-many-bind-parameters',
        method: 'create()',
        model: 'Post',
        parameters: 65_536,
        limit: 65_535,
        target: 'mysql',
      }),
    });
    // The parent insert ran; only the nested insert is refused.
    expect(runtime.executions).toHaveLength(1);
  });

  it('sends the same nested insert on PostgreSQL, which binds the shared parameter once', async () => {
    const graph = nestedGraphOf(target.context);
    const runtime = createMockRuntime();
    runtime.setNextResults([[{ id: 1 }], []]);

    await executeGraph(graph, { runtime, context: target.context });

    // The statement is the same one: 65,536 occurrences of 49,153 parameters, which PostgreSQL binds
    // as 49,153.
    const nested = runtime.executions[1]?.plan.ast;
    if (nested === undefined) throw new Error('the nested insert was not sent');
    expect(nested.collectParamRefs()).toHaveLength(65_536);
    expect(collectOrderedParamRefs(nested)).toHaveLength(49_153);
  });
});

describe('createAll bind-parameter limit', () => {
  it('refuses createAll() before any statement reaches the driver', () => {
    const { collection, runtime } = createCollectionFor('User');

    expect(() => collection.createAll(overWireLimitRows as never)).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        meta: expect.objectContaining({
          problem: 'too-many-bind-parameters',
          parameters: 65_536,
          limit: 65_535,
        }),
      }),
    );
    expect(runtime.executions).toEqual([]);
  });
});
