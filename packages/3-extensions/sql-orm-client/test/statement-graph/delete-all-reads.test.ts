import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { postgresServerVersions } from '@internal/target-postgres/server-version';
import { describe, expect, it } from 'vitest';
import { Collection } from '../../src/collection';
import { deleteAllGraph } from '../../src/statement-graph/collection-graphs';
import type { Graph } from '../../src/statement-graph/graph';
import { createCollectionFor } from '../collection-fixtures';
import { defineContract, field, model, rel } from '../contract-builder';
import { buildTestContextFromContract, createMockRuntime, getTestContract } from '../helpers';
import { printGraph } from './print-graph';

type Strategy = 'join' | 'query';
type Returning = 'with RETURNING' | 'without RETURNING';

function adapterFor(strategy: Strategy, returning: Returning): typeof postgresAdapter {
  const returns = returning === 'with RETURNING';
  return {
    ...postgresAdapter,
    capabilities: {
      ...postgresServerVersions[18],
      postgres: { ...postgresServerVersions[18].postgres, returning: returns },
      sql: {
        ...postgresServerVersions[18].sql,
        returning: returns,
        outerReferencesInDerivedTables: strategy === 'join',
        jsonAggWithoutTruncation: strategy === 'join',
      },
    },
  };
}

const cases = [
  ['join', 'with RETURNING'],
  ['join', 'without RETURNING'],
  ['query', 'with RETURNING'],
  ['query', 'without RETURNING'],
] as const;

const UserBase = model('User', {
  fields: { id: field.column(int4Column).id() },
}).sql({ table: 'users' });

const NoKey = model('NoKey', {
  fields: {
    message: field.column(textColumn),
    userId: field.column(int4Column).column('user_id'),
  },
  relations: { author: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }) },
}).sql({ table: 'no_key' });

const NullableKey = model('NullableKey', {
  fields: {
    message: field.column(textColumn),
    code: field.column(textColumn).optional().unique(),
    userId: field.column(int4Column).column('user_id'),
  },
  relations: { author: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }) },
}).sql({ table: 'nullable_key' });

const contract = defineContract({ models: { User: UserBase, NoKey, NullableKey } });

const tables = [
  ['NoKey', 'no_key'],
  ['NullableKey', 'nullable_key'],
] as const;

function rowsOf(modelName: 'NoKey' | 'NullableKey', strategy: Strategy, returning: Returning) {
  const runtime = createMockRuntime();
  const context = buildTestContextFromContract(contract, {
    adapter: adapterFor(strategy, returning),
  });
  const collection = new Collection({ runtime, context }, modelName, { namespaceId: 'public' });
  return { runtime, rows: collection.where({ message: 'hello' }) };
}

function includeRefusal(modelName: string, tableName: string) {
  return expect.objectContaining({
    code: 'ORM.ROW_IDENTITY_MISSING',
    message: `Cannot load include "author" of model "${modelName}": table "${tableName}" has no primary key, and no unique constraint whose columns are all NOT NULL, to match the included rows to their parent rows by.`,
  });
}

const withQueryReturning = [
  ['query', 'with RETURNING'],
  ['query', 'without RETURNING'],
] as const;

describe.each(tables)(
  'deleteAll() on table %s, which has no row identity',
  (modelName, tableName) => {
    it.each(withQueryReturning)(
      'refuses to return rows with includes read one query per relation (%s, %s)',
      (strategy, returning) => {
        const { rows, runtime } = rowsOf(modelName, strategy, returning);

        expect(() => rows.include('author').deleteAll()).toThrow(
          includeRefusal(modelName, tableName),
        );
        expect(runtime.executions).toEqual([]);
      },
    );

    it('returns rows with RETURNING and no includes from one DELETE', async () => {
      const { rows, runtime } = rowsOf(modelName, 'join', 'with RETURNING');
      runtime.setNextResults([[]]);

      await rows.deleteAll();

      expect(runtime.executions.map(({ plan }) => ('ast' in plan ? plan.ast.kind : ''))).toEqual([
        'delete',
      ]);
    });

    it('counts the deleted rows on a database without RETURNING', async () => {
      const { rows, runtime } = rowsOf(modelName, 'join', 'without RETURNING');
      runtime.setNextStats([{ affectedRows: 0 }]);

      await rows.deleteAndCount();

      expect(runtime.executions.map(({ plan }) => ('ast' in plan ? plan.ast.kind : ''))).toEqual([
        'delete',
      ]);
    });
  },
);

function deleteAllUsers(strategy: Strategy, returning: Returning, withPosts: boolean): Graph {
  const context = buildTestContextFromContract(getTestContract(), {
    adapter: adapterFor(strategy, returning),
  });
  const users = createCollectionFor('User', context.contract).collection.where({ name: 'Ada' });
  const state = withPosts ? users.include('posts').state : users.state;
  const graph = deleteAllGraph(
    { context, state, modelName: 'User', namespaceId: 'public' },
    'rows',
  );
  graph.removeUnreadFinds();
  return graph;
}

function deleteOf(graph: Graph): string | undefined {
  return printGraph(graph)
    .split('\n')
    .find((line) => line.includes('Delete'));
}

describe('deleteAll() that reads the rows it returns before it deletes them', () => {
  it.each(cases)(
    'deletes only the rows it read, by key, with includes (%s, %s)',
    (strategy, returning) => {
      expect(deleteOf(deleteAllUsers(strategy, returning, true))).toMatch(
        /Delete users where name = 'Ada' <- FilterData n\d+ \(id->id\)$/,
      );
    },
  );

  it('deletes only the rows it read, by key, on a database without RETURNING', () => {
    expect(deleteOf(deleteAllUsers('join', 'without RETURNING', false))).toMatch(
      /Delete users where name = 'Ada' <- FilterData n\d+ \(id->id\)$/,
    );
  });

  it('is one DELETE with RETURNING and no includes', () => {
    expect(printGraph(deleteAllUsers('join', 'with RETURNING', false))).toBe(
      ["n1 Delete users where name = 'Ada'", 'result: n1'].join('\n'),
    );
  });
});
