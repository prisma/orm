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
    create(data: object | readonly object[], options?: { onConflict: 'skip' }): unknown;
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
    }).toEqual({
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
    [
      'onConflict connect on the many-to-many relation User.tags',
      { tags: (tags: Mutator) => tags.create({ id: 't', name: 'Go' }, { onConflict: 'connect' }) },
      'ORM.OPERATION_UNSUPPORTED',
      'create() nested mutation for relation "tags" does not support onConflict "connect"',
      { kind: 'create', relation: 'tags', reason: 'on-conflict-connect' },
    ],
    [
      'onConflict connect on the to-one relation Post.author in a create row',
      {
        posts: (posts: Mutator) =>
          posts.create({
            ...post,
            author: (author: Mutator) =>
              author.create(
                { id: 5, name: 'Ada', email: 'ada@example.com' },
                { onConflict: 'connect' },
              ),
          }),
      },
      'ORM.OPERATION_UNSUPPORTED',
      'create() nested mutation for relation "author" does not support onConflict "connect"',
      { kind: 'create', relation: 'author', reason: 'on-conflict-connect' },
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
