import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { Collection } from '../../src/collection';
import { createCollectionTables } from '../../src/collection-tables';
import { parseMutationInput } from '../../src/relation-mutations';
import { createGraph, updateFirstGraph } from '../../src/statement-graph/collection-graphs';
import { emptyState, type RelationMutator } from '../../src/types';
import {
  baseContract,
  createCollectionFor,
  relatedCollectionOf,
  withoutCapabilityKeys,
} from '../collection-fixtures';
import { defineContract, field, model, rel } from '../contract-builder';
import type { Contract as PolyContract } from '../fixtures/polymorphism/generated/contract';
import polyContractJson from '../fixtures/polymorphism/generated/contract.json' with {
  type: 'json',
};
import {
  buildMixedPolyContract,
  buildTestContextFromContract,
  createMockRuntime,
  getTestContext,
  withPatchedDomainModels,
} from '../helpers';
import { printGraph } from './print-graph';

interface VariantMutator {
  variant(value: string): {
    create(
      data: object | readonly object[],
      options?: { onConflict: 'skip' | 'connect'; conflictOn?: readonly string[] },
    ): unknown;
  };
}

type Mutator = RelationMutator<Contract<SqlStorage>, string>;

const post = { id: 10, title: 'Hello', views: 0 };
const other = { id: 11, title: 'Other', views: 0 };

function updateOf(...writes: string[]): string {
  return ['n1 Find users where id = 1', ...writes, 'result: n1'].join('\n');
}

function printUpdate(input: Record<string, unknown>, context = getTestContext()): string {
  const target = {
    context,
    state: createCollectionFor('User', context.contract).collection.where({ id: 1 }).state,
    modelName: 'User',
    namespaceId: 'public',
  };
  const { relationMutations } = parseMutationInput(
    context.contract,
    'public',
    'User',
    input as never,
    relatedCollectionOf(context),
  );
  return printGraph(updateFirstGraph(target, {}, relationMutations));
}

describe('create options on a relation', () => {
  it('inserts each row of onConflict connect on its own and links a colliding row by updating its parent key', () => {
    expect({
      one: printUpdate({
        posts: (posts: Mutator) => posts.create(post, { onConflict: 'connect' }),
      }),
      several: printUpdate({
        posts: (posts: Mutator) =>
          posts.create([post, other], { onConflict: 'connect', conflictOn: ['title'] }),
      }),
      withCallback: printUpdate({
        posts: (posts: Mutator) =>
          posts.create(
            { ...post, comments: (comments: Mutator) => comments.create({ id: 3, body: 'Hi' }) },
            { onConflict: 'connect' },
          ),
      }),
    }).toEqual({
      one: updateOf('n2 Insert posts on conflict (id) do update <- PayloadData n1 (id->user_id)'),
      several: updateOf(
        'n2 Insert posts on conflict (title) do update <- PayloadData n1 (id->user_id)',
        'n3 Insert posts on conflict (title) do update <- PayloadData n1 (id->user_id)',
      ),
      withCallback: updateOf(
        'n2 Insert posts on conflict (id) do update <- PayloadData n1 (id->user_id)',
        'n3 Insert comments <- PayloadData n2 (id->post_id)',
      ),
    });
  });

  it('reads a row of onConflict connect with relation callbacks back by its conflict columns without returning', () => {
    const withoutReturning = {
      ...getTestContext(),
      contract: withoutCapabilityKeys(baseContract, ['returning']),
    };
    const comments = (mutator: Mutator) => mutator.create({ id: 3, body: 'Hi' });

    expect({
      byKey: printUpdate(
        {
          posts: (posts: Mutator) => posts.create({ ...post, comments }, { onConflict: 'connect' }),
        },
        withoutReturning,
      ),
      byTitle: printUpdate(
        {
          posts: (posts: Mutator) =>
            posts.create({ ...post, comments }, { onConflict: 'connect', conflictOn: ['title'] }),
        },
        withoutReturning,
      ),
      byParentLink: printUpdate(
        {
          posts: (posts: Mutator) =>
            posts.create({ ...post, comments }, { onConflict: 'connect', conflictOn: ['userId'] }),
        },
        withoutReturning,
      ),
    }).toEqual({
      byParentLink: updateOf(
        'n2 Insert posts on conflict (user_id) do update <- PayloadData n1 (id->user_id)',
        'n3 FindByKeys posts by (user_id) for create <- Rows n2',
        'n4 Insert comments <- PayloadData n3 (id->post_id)',
      ),
      byKey: updateOf(
        'n2 Insert posts on conflict (id) do update <- PayloadData n1 (id->user_id)',
        'n3 FindByKeys posts by (id) for create <- Rows n2',
        'n4 Insert comments <- PayloadData n3 (id->post_id)',
      ),
      byTitle: updateOf(
        'n2 Insert posts on conflict (title) do update <- PayloadData n1 (id->user_id)',
        'n3 FindByKeys posts by (title) for create <- Rows n2',
        'n4 Insert comments <- PayloadData n3 (id->post_id)',
      ),
    });
  });

  it('runs a row of onConflict connect on the parent link without returning, reading it back by that column', async () => {
    const { collection, runtime } = createCollectionFor(
      'User',
      withoutCapabilityKeys(baseContract, ['returning']),
    );
    runtime.setNextResults([[{ id: 1 }], [{ ...post, user_id: 1, embedding: null }]]);

    await collection.where({ id: 1 }).update({
      posts: (posts: Mutator) =>
        posts.create(
          { ...post, comments: (comments: Mutator) => comments.create({ id: 3, body: 'Hi' }) },
          { onConflict: 'connect', conflictOn: ['userId'] },
        ),
    } as never);

    expect(runtime.executions.map(({ operation }) => operation)).toEqual([
      'query',
      'execute',
      'query',
      'execute',
    ]);
  });

  it('links the row of onConflict connect on a parent-held or many-to-many relation through its read-back', () => {
    const ada = { id: 5, name: 'Ada', email: 'ada@example.com' };
    const go = { id: 'go', name: 'Go' };
    const rust = { id: 'rust', name: 'Rust' };

    expect({
      parentHeld: printUpdate({
        invitedBy: (invitedBy: Mutator) => invitedBy.create(ada, { onConflict: 'connect' }),
      }),
      manyToMany: printUpdate({
        tags: (tags: Mutator) => tags.create(go, { onConflict: 'connect', conflictOn: ['name'] }),
      }),
      manyToManyRows: printUpdate({
        tags: (tags: Mutator) => tags.create([go, rust], { onConflict: 'connect' }),
      }),
      withoutReturning: printUpdate(
        {
          tags: (tags: Mutator) => tags.create(go, { onConflict: 'connect', conflictOn: ['name'] }),
        },
        { ...getTestContext(), contract: withoutCapabilityKeys(baseContract, ['returning']) },
      ),
    }).toEqual({
      parentHeld: [
        'n1 Find users where id = 1',
        'n2 Insert users on conflict (id) do update <- Requires n1',
        'n3 Update users set nothing where id = 1 <- FilterData n1 (id->id), PayloadData n2 (id->invited_by_id)',
        'result: n3',
      ].join('\n'),
      manyToMany: updateOf(
        'n2 Insert tags on conflict (name) do update <- Requires n1',
        'n3 Insert user_tags on conflict (user_id, tag_id) do nothing <- PayloadData n1 (id->user_id), PayloadData n2 (id->tag_id)',
      ),
      manyToManyRows: updateOf(
        'n2 Insert tags on conflict (id) do update <- Requires n1',
        'n3 Insert user_tags on conflict (user_id, tag_id) do nothing <- PayloadData n1 (id->user_id), PayloadData n2 (id->tag_id)',
        'n4 Insert tags on conflict (id) do update <- Requires n1',
        'n5 Insert user_tags on conflict (user_id, tag_id) do nothing <- PayloadData n1 (id->user_id), PayloadData n4 (id->tag_id)',
      ),
      withoutReturning: updateOf(
        'n2 Insert tags on conflict (name) do update <- Requires n1',
        'n3 FindByKeys tags by (name) for create <- Rows n2',
        'n4 Insert user_tags on conflict (user_id, tag_id) do nothing <- PayloadData n1 (id->user_id), PayloadData n3 (id->tag_id)',
      ),
    });
  });

  it('runs a row of onConflict connect on a many-to-many relation without returning, keeping the stored key of a colliding row', async () => {
    const { collection, runtime } = createCollectionFor(
      'User',
      withoutCapabilityKeys(baseContract, ['returning']),
    );
    runtime.setNextResults([[{ id: 1 }], [{ id: 'go', name: 'Go' }]]);

    await collection.where({ id: 1 }).update({
      tags: (tags: Mutator) =>
        tags.create({ id: 'go', name: 'go' }, { onConflict: 'connect', conflictOn: ['name'] }),
    } as never);

    expect(runtime.executions.map(({ operation }) => operation)).toEqual([
      'query',
      'execute',
      'query',
      'execute',
    ]);
  });

  it('counts the parent link toward the conflict key of a row of onConflict skip', () => {
    expect(
      printUpdate({
        posts: (posts: Mutator) =>
          posts.create([post, other], { onConflict: 'skip', conflictOn: ['userId'] }),
      }),
    ).toBe(
      updateOf(
        'n2 Insert posts 2 rows on conflict (user_id) do nothing <- PayloadData n1 (id->user_id)',
      ),
    );
  });

  it('inserts each row of onConflict skip with relation callbacks in its own Insert that its children read', () => {
    expect(
      printUpdate({
        posts: (posts: Mutator) =>
          posts.create(
            [
              {
                ...post,
                comments: (comments: Mutator) => comments.create({ id: 3, body: 'Hi' }),
              },
              other,
            ],
            { onConflict: 'skip', conflictOn: ['title'] },
          ),
      }),
    ).toBe(
      updateOf(
        'n2 Insert posts on conflict (title) do nothing <- PayloadData n1 (id->user_id)',
        'n3 Insert comments <- PayloadData n2 (id->post_id)',
        'n4 Insert posts on conflict (title) do nothing <- PayloadData n1 (id->user_id)',
      ),
    );
  });

  const rejections = [
    [
      'onConflict skip on the to-one relation User.profile',
      {
        profile: (profile: Mutator) => profile.create({ id: 5, bio: 'Hi' }, { onConflict: 'skip' }),
      },
      'ORM.OPERATION_UNSUPPORTED',
      'create() nested mutation for relation "profile" supports onConflict "skip" only on one-to-many relations',
      { kind: 'create', relation: 'profile', reason: 'to-one-relation' },
    ],
    [
      'onConflict skip on the to-one relation User.invitedBy',
      {
        invitedBy: (invitedBy: Mutator) =>
          invitedBy.create(
            { id: 5, name: 'Ada', email: 'ada@example.com' },
            { onConflict: 'skip' },
          ),
      },
      'ORM.OPERATION_UNSUPPORTED',
      'create() nested mutation for relation "invitedBy" supports onConflict "skip" only on one-to-many relations',
      { kind: 'create', relation: 'invitedBy', reason: 'to-one-relation' },
    ],
    [
      'onConflict skip on the many-to-many relation User.tags',
      { tags: (tags: Mutator) => tags.create([{ id: 't', name: 'Go' }], { onConflict: 'skip' }) },
      'ORM.OPERATION_UNSUPPORTED',
      'create() nested mutation for relation "tags" supports onConflict "skip" only on one-to-many relations',
      { kind: 'create', relation: 'tags', reason: 'many-to-many-relation' },
    ],
    [
      'onConflict skip with a row that gives no value for any conflict key',
      {
        posts: (posts: Mutator) =>
          posts.create([{ ...post, embedding: [1, 2, 3] }, other], {
            onConflict: 'skip',
            conflictOn: ['embedding'],
          }),
      },
      'ORM.ARGUMENT_INVALID',
      'create() nested mutation for relation "posts" row 1 for model "Post" gives no value for any conflict key: (embedding)',
      {
        kind: 'create',
        relation: 'posts',
        problem: 'row-cannot-conflict',
        index: 1,
        conflictKeys: [['embedding']],
      },
    ],
  ] as const;

  it.each(rejections)(
    'rejects %s in update() before any statement, also when the parent filter matches no row',
    async (_, input, code, message, meta) => {
      const { collection, runtime } = createCollectionFor('User');
      runtime.setNextResults([[]]);

      await expect(collection.where({ id: 1 }).update(input as never)).rejects.toThrow(
        expect.objectContaining({ code, message, meta }),
      );
      expect(runtime.executions).toEqual([]);
    },
  );

  const withComment = {
    ...post,
    comments: (comments: Mutator) => comments.create({ id: 3, body: 'Hi' }),
  };

  it.each([
    ['skip on a row with relation callbacks', 'returning', { onConflict: 'skip' }, [withComment]],
    [
      'connect on a column other than the key the row gives',
      'insertOnConflictTarget',
      { onConflict: 'connect', conflictOn: ['title'] },
      [post],
    ],
  ] as const)(
    'refuses onConflict %s before any statement on a contract without %s',
    async (_, capability, options, rows) => {
      const { collection, runtime } = createCollectionFor(
        'User',
        withoutCapabilityKeys(baseContract, [capability]),
      );

      await expect(
        collection.where({ id: 1 }).update({
          posts: (posts: Mutator) => posts.create(rows, options),
        } as never),
      ).rejects.toThrow(
        expect.objectContaining({
          code: 'ORM.CAPABILITY_MISSING',
          meta: expect.objectContaining({ capability }),
        }),
      );
      expect(runtime.executions).toEqual([]);
    },
  );

  describe('on a relation whose target is a variant stored in its own table', () => {
    const contract = withPatchedDomainModels(buildMixedPolyContract(), (models) => {
      const assignee = models['Assignee'] as { relations: Record<string, unknown> };
      return {
        ...models,
        Assignee: {
          ...assignee,
          relations: {
            features: {
              to: { model: 'Feature', namespace: 'public' },
              cardinality: '1:N',
              on: { localFields: ['id'], targetFields: ['assigneeId'] },
            },
            bugs: {
              to: { model: 'Bug', namespace: 'public' },
              cardinality: '1:N',
              on: { localFields: ['id'], targetFields: ['assigneeId'] },
            },
          },
        },
      };
    });
    const context = buildTestContextFromContract(contract);

    function parse(input: Record<string, unknown>) {
      const parsed = parseMutationInput(
        contract,
        'public',
        'Assignee',
        { id: 1, name: 'Ada', ...input } as never,
        relatedCollectionOf(context),
      );
      createGraph(
        {
          context,
          state: emptyState(createCollectionTables(contract, 'public', 'Assignee')),
          modelName: 'Assignee',
          namespaceId: 'public',
        },
        parsed,
      );
      return parsed;
    }

    it('rejects onConflict', () => {
      expect(() =>
        parse({
          features: (features: Mutator) =>
            features.create({ id: 1, title: 'A', priority: 1 }, { onConflict: 'skip' }),
        }),
      ).toThrow(
        expect.objectContaining({
          code: 'ORM.OPERATION_UNSUPPORTED',
          message:
            'The onConflict option is not supported on variant "Feature" of model "Task" because the variant is stored in its own table. Leave the option out; a duplicate row then makes the call fail.',
          meta: {
            kind: 'create',
            relation: 'features',
            reason: 'mti-variant',
            variant: 'Feature',
          },
        }),
      );
    });

    it('accepts onConflict skip on a variant stored in the table of its base model', () => {
      expect(
        parse({
          bugs: (bugs: Mutator) => bugs.create({ id: 1, title: 'A' }, { onConflict: 'skip' }),
        }).relationMutations.map(({ name }) => name),
      ).toEqual(['bugs']);
    });
  });
});

describe('onConflict skip with a conflict key that a to-one relation write inside the row fills', () => {
  const Category = model('Category', {
    fields: { id: field.column(int4Column).id(), name: field.column(textColumn) },
  }).sql({ table: 'categories' });
  const AuthorBase = model('Author', { fields: { id: field.column(int4Column).id() } });
  const ArticleBase = model('Article', {
    fields: {
      id: field.column(int4Column).id(),
      authorId: field.column(int4Column).column('author_id'),
      categoryId: field.column(int4Column).column('category_id').optional(),
      title: field.column(textColumn),
    },
    relations: {
      category: rel.belongsTo(Category, { from: 'categoryId', to: 'id' }),
    },
  }).sql({ table: 'articles' });
  const contract: Contract<SqlStorage> = {
    ...defineContract({
      models: {
        Author: AuthorBase.relations({
          articles: rel.hasMany(() => ArticleBase, { by: 'authorId' }),
        }).sql({ table: 'authors' }),
        Article: ArticleBase,
        Category,
      },
    }),
    capabilities: {
      sql: {
        defaultInInsert: true,
        returning: true,
        insertOnConflictSkip: true,
        insertOnConflictTarget: true,
        insertOnConflictWithoutTarget: true,
      },
    },
  };
  const context = { ...buildTestContextFromContract(contract), contract };

  function printCreate(articles: (mutator: Mutator) => unknown): string {
    return printGraph(
      createGraph(
        {
          context,
          state: emptyState(createCollectionTables(contract, 'public', 'Author')),
          modelName: 'Author',
          namespaceId: 'public',
        },
        parseMutationInput(
          contract,
          'public',
          'Author',
          { id: 1, articles } as never,
          relatedCollectionOf(context),
        ),
      ),
    );
  }

  it('accepts a row whose conflictOn foreign key comes from a nested connect or create', () => {
    expect(
      printCreate((articles) =>
        articles.create(
          [
            {
              id: 10,
              title: 'Connected',
              category: (category: Mutator) => category.connect({ id: 5 }),
            },
            {
              id: 11,
              title: 'Created',
              category: (category: Mutator) => category.create({ id: 6, name: 'New' }),
            },
          ],
          { onConflict: 'skip', conflictOn: ['categoryId'] },
        ),
      ),
    ).toBe(
      [
        'n1 Insert authors',
        'n2 Find categories where id = 5 limit 1',
        'n3 Assert <- Rows n2',
        'n4 Insert articles on conflict (category_id) do nothing <- PayloadData n1 (id->author_id), PayloadData n2 (id->category_id)',
        'n5 Insert categories',
        'n6 Insert articles on conflict (category_id) do nothing <- PayloadData n1 (id->author_id), PayloadData n5 (id->category_id)',
        'result: n1',
      ].join('\n'),
    );
  });
});

describe('onConflict on a create through variant()', () => {
  const polyContext = buildTestContextFromContract(
    new PostgresContractSerializer().deserializeContract<PolyContract>(polyContractJson),
  );

  function updateProject(tasks: (mutator: VariantMutator) => unknown) {
    const target = {
      context: polyContext,
      state: new Collection({ runtime: createMockRuntime(), context: polyContext }, 'Project', {
        namespaceId: 'public',
      }).where({ id: 1 }).state,
      modelName: 'Project',
      namespaceId: 'public',
    };
    const { relationMutations } = parseMutationInput(
      polyContext.contract,
      'public',
      'Project',
      { tasks } as never,
      relatedCollectionOf(polyContext),
    );
    return printGraph(updateFirstGraph(target, {}, relationMutations));
  }

  function printPolyUpdate(modelName: string, input: Record<string, unknown>) {
    const target = {
      context: polyContext,
      state: new Collection({ runtime: createMockRuntime(), context: polyContext }, modelName, {
        namespaceId: 'public',
      }).where({ id: 1 }).state,
      modelName,
      namespaceId: 'public',
    };
    const { relationMutations } = parseMutationInput(
      polyContext.contract,
      'public',
      modelName,
      input as never,
      relatedCollectionOf(polyContext),
    );
    return printGraph(updateFirstGraph(target, {}, relationMutations));
  }

  it('accepts onConflict skip on a variant stored in the base table', () => {
    expect(
      updateProject((tasks) =>
        tasks
          .variant('bug')
          .create([{ id: 5, title: 'Crash', severity: 'high' }], { onConflict: 'skip' }),
      ),
    ).toBe(
      [
        'n1 Find projects_tbl where id = 1',
        'n2 Insert tasks on conflict do nothing <- PayloadData n1 (id->project_id)',
        'result: n1',
      ].join('\n'),
    );
  });

  it('links a row of onConflict connect only when the colliding row is of the variant, and checks the variant before anything reads the row', () => {
    const crash = { id: 2, title: 'Crash', severity: 'high' };

    expect({
      childHeld: updateProject((tasks) =>
        tasks.variant('bug').create(crash, { onConflict: 'connect' }),
      ),
      parentHeld: printPolyUpdate('TaskComment', {
        task: (task: VariantMutator) =>
          task.variant('bug').create(crash, { onConflict: 'connect' }),
      }),
      manyToMany: printPolyUpdate('Label', {
        tasks: (tasks: VariantMutator) =>
          tasks.variant('bug').create(crash, { onConflict: 'connect' }),
      }),
    }).toEqual({
      childHeld: [
        'n1 Find projects_tbl where id = 1',
        'n2 Insert tasks on conflict (id) do update <- PayloadData n1 (id->project_id)',
        'n3 Assert <- Rows n2',
        'result: n1',
      ].join('\n'),
      parentHeld: [
        'n1 Find task_comments where id = 1',
        'n2 Insert tasks on conflict (id) do update <- Requires n1',
        'n3 Assert <- Rows n2',
        'n4 Update task_comments set nothing where id = 1 <- PayloadData n2 (id->task_id)',
        'result: n4',
      ].join('\n'),
      manyToMany: [
        'n1 Find labels where id = 1',
        'n2 Insert tasks on conflict (id) do update <- Requires n1',
        'n3 Assert <- Rows n2',
        'n4 Insert task_labels on conflict (task_id, label_id) do nothing <- PayloadData n1 (id->label_id), PayloadData n2 (id->task_id)',
        'result: n1',
      ].join('\n'),
    });
  });

  it('moves a colliding row of onConflict connect through variant() to the parent only when the row is of the variant', async () => {
    const runtime = createMockRuntime();
    const projects = new Collection({ runtime, context: polyContext }, 'Project', {
      namespaceId: 'public',
    });
    runtime.setNextResults([[{ id: 1 }], [{ id: 2, title: 'Crash', type: 'bug', project_id: 1 }]]);

    await projects.where({ id: 1 }).update({
      tasks: (tasks: VariantMutator) =>
        tasks.variant('bug').create({ id: 2, title: 'Crash' }, { onConflict: 'connect' }),
    } as never);

    const insert = runtime.executions[1]?.plan.ast;
    expect(insert).toMatchObject({
      kind: 'insert',
      onConflict: {
        action: {
          kind: 'do-update-set',
          set: {
            project_id: {
              kind: 'case',
              branches: [
                {
                  condition: {
                    kind: 'binary',
                    left: { kind: 'column-ref', table: 'tasks', column: 'type' },
                    right: { kind: 'param-ref', value: 'bug' },
                  },
                  value: { kind: 'column-ref', table: 'excluded', column: 'project_id' },
                },
              ],
              elseExpr: { kind: 'column-ref', table: 'tasks', column: 'project_id' },
            },
          },
        },
      },
    });
  });

  it('rejects onConflict connect through variant() when the colliding row is of another variant, before linking it', async () => {
    const runtime = createMockRuntime();
    const comments = new Collection({ runtime, context: polyContext }, 'TaskComment', {
      namespaceId: 'public',
    });
    runtime.setNextResults([[{ id: 1 }], [{ id: 2, title: 'Dark mode', type: 'feature' }]]);

    await expect(
      comments.where({ id: 1 }).update({
        task: (task: VariantMutator) =>
          task.variant('bug').create({ id: 2, title: 'Crash' }, { onConflict: 'connect' }),
      } as never),
    ).rejects.toMatchObject({
      code: 'ORM.RELATION_ROW_MISSING',
      message:
        'create() nested mutation for relation "task" found a row of another variant than "bug" on its conflict key',
      meta: { kind: 'create', relation: 'task', variant: 'bug' },
    });
    expect(runtime.executions.map(({ operation }) => operation)).toEqual(['query', 'query']);
  });

  it('rejects onConflict on a variant stored in its own table', () => {
    expect(() =>
      updateProject((tasks) =>
        tasks
          .variant('feature')
          .create({ title: 'Dark mode', priority: 1 }, { onConflict: 'skip' }),
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'ORM.OPERATION_UNSUPPORTED',
        message:
          'The onConflict option is not supported on variant "Feature" of model "Task" because the variant is stored in its own table. Leave the option out; a duplicate row then makes the call fail.',
        meta: { kind: 'create', relation: 'tasks', reason: 'mti-variant', variant: 'Feature' },
      }),
    );
  });
});
