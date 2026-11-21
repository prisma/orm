import { describe, expect, it } from 'vitest';
import { createAllGraph } from '../../src/statement-graph/collection-graphs';
import { baseContract, createCollectionFor, withTarget } from '../collection-fixtures';
import { getTestContext } from '../helpers';
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

  it('refuses createAndCount() the same way', () => {
    const thrown = thrownOf(() => createAllGraph(target, overWireLimitRows, undefined, 'count'));

    expect(thrown).toMatchObject({
      code: 'ORM.ARGUMENT_INVALID',
      meta: { problem: 'too-many-bind-parameters', method: 'createAll()' },
    });
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
