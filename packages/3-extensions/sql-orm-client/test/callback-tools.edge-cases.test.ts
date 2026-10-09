import { createPostgresAdapter } from '@internal/adapter-postgres/adapter';
import { type AnyExpression, ColumnRef, type OrderByItem } from '@internal/sql-relational-core/ast';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { websearchToTsquery } from '@internal/target-postgres/full-text';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { PostgresContract } from '../../../3-targets/6-adapters/postgres/src/core/types';
import { Collection } from '../src/collection';
import { orm } from '../src/orm';
import { compileSelect } from '../src/query-plan-select';
import type { CollectionState } from '../src/types';
import { baseContract, createCollectionFor } from './collection-fixtures';
import type { Contract as PolyContract } from './fixtures/polymorphism/generated/contract';
import polyContractJson from './fixtures/polymorphism/generated/contract.json' with {
  type: 'json',
};
import { buildTestContextFromContract, createMockRuntime, getTestContext } from './helpers';

const adapter = createPostgresAdapter();
const q = websearchToTsquery('alice');

function sqlOf(contract: unknown, plan: SqlQueryPlan<unknown>): string {
  return adapter.lower(plan.ast, {
    contract: contract as PostgresContract,
    params: plan.params,
  }).sql;
}

function usersSql(state: CollectionState): string {
  return sqlOf(baseContract, compileSelect(baseContract, 'public', 'User', 'users', state));
}

class Chain {
  constructor(readonly words: readonly string[]) {}

  readonly returnType = { codecId: 'pg/text@1', nullable: false } as const;

  followedBy(word: string): Chain {
    return new Chain([...this.words, word]);
  }

  buildAst(): AnyExpression {
    return ColumnRef.of('users', this.words.join('_'));
  }
}

function contextWithChainOperation() {
  const context = getTestContext();
  const operations = context.queryOperations.entries();
  return {
    ...context,
    queryOperations: {
      register: () => undefined,
      entries: () => ({
        ...operations,
        chain: { impl: (word: string) => new Chain([word]) },
        frozen: {
          impl: (column: string) =>
            Object.freeze({
              returnType: Object.freeze({ codecId: 'pg/text@1', nullable: false }),
              buildAst: () => ColumnRef.of('users', column),
            }),
        },
      }),
    },
  };
}

describe('a value from fns', () => {
  it('keeps the methods of an operation result and adds asc and desc', () => {
    const collection = new Collection(
      { runtime: createMockRuntime(), context: contextWithChainOperation() },
      'User',
      { namespaceId: 'public' },
    );
    let order: OrderByItem | undefined;

    collection.where((u, { fns }) => {
      const chain: unknown = Reflect.get(fns, 'chain');
      const value = typeof chain === 'function' ? chain('a') : undefined;
      order = value.desc();
      expect(value.followedBy('b').words).toEqual(['a', 'b']);
      return u.id.eq(1);
    });

    expect({ dir: order?.dir, expr: order?.expr }).toEqual({
      dir: 'desc',
      expr: ColumnRef.of('users', 'a'),
    });
  });

  it('keeps working on a frozen operation result', () => {
    const collection = new Collection(
      { runtime: createMockRuntime(), context: contextWithChainOperation() },
      'User',
      { namespaceId: 'public' },
    );
    let read: { readonly ast: unknown; readonly order: OrderByItem } | undefined;

    collection.where((u, { fns }) => {
      const frozen: unknown = Reflect.get(fns, 'frozen');
      const value = typeof frozen === 'function' ? frozen('email') : undefined;
      read = { ast: value.buildAst(), order: value.asc() };
      return u.id.eq(1);
    });

    expect({ ast: read?.ast, dir: read?.order.dir, expr: read?.order.expr }).toEqual({
      ast: ColumnRef.of('users', 'email'),
      dir: 'asc',
      expr: ColumnRef.of('users', 'email'),
    });
  });

  it('from fns.raw has asc and desc', () => {
    const { collection } = createCollectionFor('User');

    const users = collection
      .select('id')
      .orderBy((u, { fns }) => fns.raw`lower(${u.name})`.returns('pg/text@1').asc());

    expect(usersSql(users.state)).toBe(
      'SELECT "users"."id" AS "id" FROM "public"."users" ORDER BY lower("users"."name") ASC',
    );
  });
});

describe('a refused index through the ORM', () => {
  it('refuses an index that is not a full-text index when the query is built', () => {
    const { collection } = createCollectionFor('Post');

    expect(() =>
      collection.where((_p, { fns, indexes }) =>
        // @ts-expect-error posts_user_id_idx is a btree index
        fns.fullTextMatches(indexes.posts_user_id_idx, q),
      ),
    ).toThrow(expect.objectContaining({ code: 'RUNTIME.ARGUMENT_INVALID' }));
  });

  it('refuses a name two indexes share, and reads the others', () => {
    const { collection } = createCollectionFor('User');
    let reads: { readonly other: unknown; readonly shared: () => unknown } | undefined;

    collection.where((u, { indexes }) => {
      reads = {
        other: indexes.users_search,
        // @ts-expect-error users_invited_by_id_idx names two indexes of users
        shared: () => indexes.users_invited_by_id_idx,
      };
      return u.id.eq(1);
    });

    expect(reads?.other).toBeDefined();
    expect(() => reads?.shared()).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: 'Table "users" has more than one index named "users_invited_by_id_idx".',
      }),
    );
  });
});

describe('the indexes of a collection narrowed by variant', () => {
  const poly = new PostgresContractSerializer().deserializeContract<PolyContract>(polyContractJson);
  const tasks = orm({
    runtime: createMockRuntime(),
    context: buildTestContextFromContract(poly),
  }).public.Task;

  it('are the indexes of the base model table', () => {
    const features = tasks.variant('feature').select('id');

    const filtered = features.where((_t, { fns, indexes }) => {
      expectTypeOf<keyof typeof indexes>().toEqualTypeOf<
        'tasks_project_id_idx' | 'tasks_reporter_id_idx'
      >();
      return fns.eq(indexes.tasks_project_id_idx.columns.project_id, 1);
    });

    expect(sqlOf(poly, compileSelect(poly, 'public', 'Task', 'tasks', filtered.state))).toBe(
      'SELECT "tasks"."id" AS "id" FROM "public"."tasks" INNER JOIN "public"."features" ON "tasks"."id" = "features"."id" WHERE ("tasks"."type" = $1 AND "tasks"."project_id" = $2)',
    );
  });
});

describe('the body of a fragment for any model', () => {
  it('receives no index at run time', () => {
    const client = orm({ runtime: createMockRuntime(), context: getTestContext() });
    let seen: readonly string[] | undefined;
    const named = client.fragment({ name: { codecId: 'pg/text@1', nullable: false } }, (rows) =>
      rows.where((r, { indexes }) => {
        seen = Object.keys(indexes);
        return r.name.eq('Alice');
      }),
    );

    client.public.User.with(named);

    expect(seen).toEqual([]);
  });
});
