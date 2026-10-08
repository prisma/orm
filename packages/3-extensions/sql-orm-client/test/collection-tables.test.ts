import { createPostgresAdapter } from '@internal/adapter-postgres/adapter';
import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  type ExistsExpr,
  LiteralExpr,
  OrExpr,
  ParamRef,
  type SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import type { PostgresContract } from '../../../3-targets/6-adapters/postgres/src/core/types';
import { Collection } from '../src/collection';
import { reloadMutationRowsByIdentities } from '../src/collection-dispatch';
import { createCollectionTables } from '../src/collection-tables';
import { createModelAccessor } from '../src/model-accessor';
import { createCollectionFor } from './collection-fixtures';
import {
  buildMixedPolyContract,
  buildTestContextFromContract,
  createMockRuntime,
  getTestContext,
  getTestContract,
  isSelectAst,
  withPatchedDomainModels,
} from './helpers';

function createTaskCollection() {
  const contract = buildMixedPolyContract();
  const context = { ...getTestContext(), contract };
  const runtime = createMockRuntime();
  const collection = new Collection({ runtime, context }, 'Task', { namespaceId: 'public' });
  return { collection, runtime, contract };
}

interface TaskVariantCollection {
  variant(value: 'feature'): TaskVariantCollection;
  where(fn: (task: { subtasks: { some(): unknown } }) => unknown): TaskVariantCollection;
  updateAndCount(data: { title: string }): Promise<number>;
}

function firstExistsFrom(collection: { state: { filters: readonly unknown[] } }): TableSource {
  const [filter] = collection.state.filters;
  const from = blindCast<ExistsExpr, 'the test filter is one relation EXISTS'>(filter).subquery
    .from;
  if (!(from instanceof TableSource)) {
    throw new Error('Expected the relation subquery to read a table');
  }
  return from;
}

describe('aliased tables in collection state', () => {
  it('binds a ToWhereExpr literal on an MTI variant column and returns the rows', async () => {
    const { collection, runtime } = createTaskCollection();
    runtime.setNextResults([
      [{ id: 2, title: 'Dark mode', type: 'feature', features__priority: 7 }],
    ]);

    const filtered = collection.where({
      toWhereExpr: () => BinaryExpr.gte(ColumnRef.of('features', 'priority'), LiteralExpr.of(3)),
    });
    const rows = await filtered.all().toArray();

    const bound = BinaryExpr.gte(
      ColumnRef.of('features', 'priority'),
      ParamRef.of(3, { codec: { codecId: 'pg/int4@1' } }),
    );
    expect(rows).toEqual([{ id: 2, title: 'Dark mode', type: 'feature', priority: 7 }]);
    expect(filtered.state.filters).toEqual([bound]);
    const ast = runtime.executions[0]?.plan.ast;
    expect(isSelectAst(ast) ? ast.where : undefined).toEqual(bound);
  });

  it('gives composite-key identity filter parameters the codec of their column', async () => {
    const contract = getTestContract();
    const runtime = createMockRuntime();
    runtime.setNextResults([[]]);

    await reloadMutationRowsByIdentities<Record<string, unknown>>({
      context: buildTestContextFromContract(contract),
      runtime,
      tables: createCollectionTables(contract, 'public', 'Project'),
      modelName: 'Project',
      namespaceId: 'public',
      identityRows: [{ tenant_id: 'acme', id: 7 }],
      selectedFields: ['id'],
      includes: [],
    }).toArray();

    const tenantCodec =
      contract.storage.namespaces['public']?.entries.table?.['projects']?.columns['tenant_id']
        ?.codecId;
    const idCodec =
      contract.storage.namespaces['public']?.entries.table?.['projects']?.columns['id']?.codecId;
    expect(tenantCodec).toBeDefined();
    expect(idCodec).toBeDefined();
    expect(
      blindCast<SelectAst, 'the read-back is a select'>(runtime.executions[0]?.plan.ast).where,
    ).toEqual(
      OrExpr.of([
        AndExpr.of([
          BinaryExpr.eq(
            ColumnRef.of('projects', 'tenant_id'),
            ParamRef.of('acme', { codec: { codecId: tenantCodec ?? '' } }),
          ),
          BinaryExpr.eq(
            ColumnRef.of('projects', 'id'),
            ParamRef.of(7, { codec: { codecId: idCodec ?? '' } }),
          ),
        ]),
      ]),
    );
  });

  it('gives two collections derived from one parent the same names for the same calls', () => {
    const { collection: parent } = createCollectionFor('User');
    const first = parent.where((user) => user.posts.some());
    const second = parent.where((user) => user.posts.some());

    expect(firstExistsFrom(first)).toEqual(TableSource.named('posts', undefined, 'public'));
    expect(firstExistsFrom(second)).toEqual(TableSource.named('posts', undefined, 'public'));
  });

  it('keeps a name taken by one derived collection out of its sibling and its parent', () => {
    const { collection: parent } = createCollectionFor('User');
    const first = parent.where((user) => user.posts.some());
    const firstAgain = first.where((user) => user.posts.none());
    const second = parent.where((user) => user.posts.none());

    expect(firstAgain.state.filters).toHaveLength(2);
    expect(
      blindCast<ExistsExpr, 'the second filter is a relation NOT EXISTS'>(
        firstAgain.state.filters[1],
      ).subquery.from,
    ).toEqual(TableSource.named('posts', 'posts_2', 'public'));
    expect(firstExistsFrom(second)).toEqual(TableSource.named('posts', undefined, 'public'));
    expect(firstExistsFrom(parent.where((user) => user.posts.some()))).toEqual(
      TableSource.named('posts', undefined, 'public'),
    );
  });

  it('stores the names an orderBy callback allocates', () => {
    const { collection } = createCollectionFor('User');
    const ordered = collection.orderBy((user) => user.invitedBy.name.asc());
    const filtered = ordered.where((user) => user.invitedUsers.some());

    expect(firstExistsFrom(filtered)).toEqual(TableSource.named('users', 'users_3', 'public'));
  });

  it('names the count-mutation copy of the root apart from a relation filter over the root table', async () => {
    const { collection, runtime, contract } = createTaskCollection();
    runtime.setNextStats([{ affectedRows: 1 }]);

    await blindCast<
      TaskVariantCollection,
      'mixed poly test contract patches Task variants outside the static fixture type'
    >(collection)
      .variant('feature')
      .where((task) => task.subtasks.some())
      .updateAndCount({ title: 'Queued' });

    const plan = runtime.executions[0]?.plan;
    if (plan === undefined) {
      throw new Error('Expected the count mutation to execute one plan');
    }
    const sql = createPostgresAdapter().lower(plan.ast, {
      contract: blindCast<PostgresContract, 'the test contract targets postgres'>(contract),
      params: plan.params,
    }).sql;
    expect(sql).toMatchInlineSnapshot(
      `"UPDATE "public"."tasks" SET "title" = $1 WHERE EXISTS (SELECT "tasks_3"."id" AS "id" FROM "public"."tasks" AS "tasks_3" INNER JOIN "public"."features" ON "tasks_3"."id" = "features"."id" WHERE ("tasks_3"."id" = "tasks"."id" AND "tasks"."type" = $2 AND EXISTS (SELECT "tasks_2"."parent_id" AS "_exists" FROM "public"."tasks" AS "tasks_2" WHERE "tasks_2"."parent_id" = "tasks"."id")))"`,
    );
    expect(plan.params).toEqual(['Queued', 'feature']);
  });

  it('aliases a relation filter that targets one of the base model MTI variant tables', () => {
    const contract = withPatchedDomainModels(buildMixedPolyContract(), (models) => {
      const task = blindCast<{ relations: Record<string, unknown> }, 'Task model entry'>(
        models['Task'],
      );
      return {
        ...models,
        Task: {
          ...task,
          relations: {
            ...task.relations,
            features: {
              to: { model: 'Feature', namespace: 'public' },
              cardinality: '1:N',
              on: { localFields: ['id'], targetFields: ['assigneeId'] },
            },
          },
        },
      };
    });
    const accessor = blindCast<
      Record<string, { some(): unknown }>,
      'the patched relation is absent from the static fixture type'
    >(
      createModelAccessor(
        { ...getTestContext(), contract },
        'public',
        'Task',
        createCollectionTables(contract, 'public', 'Task'),
      ),
    );

    const exists = blindCast<ExistsExpr, 'some() builds an EXISTS'>(accessor['features']?.some());

    expect(exists.subquery.from).toEqual(TableSource.named('features', 'features_2', 'public'));
    expect(exists.subquery.where).toEqual(
      BinaryExpr.eq(ColumnRef.of('features_2', 'assignee_id'), ColumnRef.of('tasks', 'id')),
    );
  });
});
