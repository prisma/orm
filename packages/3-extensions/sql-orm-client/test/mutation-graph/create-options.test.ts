import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createCollectionTables } from '../../src/collection-tables';
import { createGraph, updateFirstGraph } from '../../src/mutation-graph/collection-graphs';
import { parseMutationInput } from '../../src/relation-mutations';
import { emptyState, type RelationMutator } from '../../src/types';
import {
  baseContract,
  createCollectionFor,
  relatedCollectionOf,
  withoutCapabilityKeys,
} from '../collection-fixtures';
import { defineContract, field, model, rel } from '../contract-builder';
import {
  buildMixedPolyContract,
  buildTestContextFromContract,
  getTestContext,
  withPatchedDomainModels,
} from '../helpers';
import { printGraph } from './print-graph';

type Mutator = RelationMutator<Contract<SqlStorage>, string>;

const post = { id: 10, title: 'Hello', views: 0 };
const other = { id: 11, title: 'Other', views: 0 };

function updateOf(...writes: string[]): string {
  return ['n1 Find users where id = 1 limit 1', ...writes, 'result: n1'].join('\n');
}

function printUpdate(input: Record<string, unknown>): string {
  const context = getTestContext();
  const target = {
    context,
    state: createCollectionFor('User').collection.where({ id: 1 }).state,
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
  it('inserts the rows of onConflict skip without relation callbacks in one Insert that skips conflicts', () => {
    expect({
      targeted: printUpdate({
        posts: (posts: Mutator) =>
          posts.create([post, other], { onConflict: 'skip', conflictOn: ['title'] }),
      }),
      byParentLink: printUpdate({
        posts: (posts: Mutator) =>
          posts.create([post, other], { onConflict: 'skip', conflictOn: ['userId'] }),
      }),
    }).toEqual({
      targeted: updateOf(
        'n2 Insert posts 2 rows on conflict (title) do nothing <- PayloadData n1 (id->user_id)',
      ),
      byParentLink: updateOf(
        'n2 Insert posts 2 rows on conflict (user_id) do nothing <- PayloadData n1 (id->user_id)',
      ),
    });
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
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      'create() nested mutation for relation "profile" supports onConflict "skip" only on one-to-many relations',
      { kind: 'create', relation: 'profile', reason: 'to-one-relation' },
    ],
    [
      'onConflict skip on the many-to-many relation User.tags',
      { tags: (tags: Mutator) => tags.create([{ id: 't', name: 'Go' }], { onConflict: 'skip' }) },
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      'create() nested mutation for relation "tags" supports onConflict "skip" only on one-to-many relations',
      { kind: 'create', relation: 'tags', reason: 'many-to-many-relation' },
    ],
    [
      'an onConflict value other than skip or connect',
      { posts: (posts: Mutator) => posts.create([post], { onConflict: 'replace' } as never) },
      'ORM.RELATION_MUTATION_INVALID',
      'create() nested mutation for relation "posts" takes onConflict "skip" or "connect"; received "replace"',
      { kind: 'create', relation: 'posts', problem: 'invalid-on-conflict' },
    ],
    [
      'a conflictOn entry that is not a field of the related model',
      {
        posts: (posts: Mutator) =>
          posts.create([post], {
            onConflict: 'skip',
            conflictOn: ['title', 'email', 'author'],
          } as never),
      },
      'ORM.RELATION_MUTATION_INVALID',
      'conflictOn of create() nested mutation for relation "posts" names fields model "Post" does not have: "email", "author"',
      {
        kind: 'create',
        relation: 'posts',
        problem: 'unknown-conflict-field',
        fields: ['email', 'author'],
      },
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
      'ORM.RELATION_MUTATION_INVALID',
      'create() nested mutation for relation "posts" row 1 gives no value for any conflict key: (embedding)',
      {
        kind: 'create',
        relation: 'posts',
        problem: 'row-cannot-conflict',
        index: 1,
        conflictKeys: [['embedding']],
      },
    ],
    [
      'onConflict connect',
      { posts: (posts: Mutator) => posts.create(post, { onConflict: 'connect' }) },
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      'create() nested mutation for relation "posts" does not support onConflict "connect"',
      { kind: 'create', relation: 'posts', reason: 'on-conflict-connect' },
    ],
    [
      'onConflict connect on a create nested in a create row',
      {
        posts: (posts: Mutator) =>
          posts.create({
            ...post,
            comments: (comments: Mutator) =>
              comments.create({ id: 3, body: 'Hi' }, { onConflict: 'connect' }),
          }),
      },
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      'create() nested mutation for relation "comments" does not support onConflict "connect"',
      { kind: 'create', relation: 'comments', reason: 'on-conflict-connect' },
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
    ['insertOnConflictSkip', { onConflict: 'skip', conflictOn: ['title'] }, [post]],
    ['insertOnConflictWithoutTarget', { onConflict: 'skip' }, [post]],
    ['insertOnConflictTarget', { onConflict: 'skip', conflictOn: ['title'] }, [post]],
    ['returning', { onConflict: 'skip' }, [withComment]],
  ] as const)(
    'refuses onConflict skip before any statement on a contract without %s',
    async (capability, options, rows) => {
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
      return parseMutationInput(
        contract,
        'public',
        'Assignee',
        input as never,
        relatedCollectionOf(context),
      );
    }

    it('rejects onConflict', () => {
      expect(() =>
        parse({
          features: (features: Mutator) =>
            features.create({ id: 1, title: 'A', priority: 1 }, { onConflict: 'skip' }),
        }),
      ).toThrow(
        expect.objectContaining({
          code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
          message:
            'create() nested mutation for relation "features" does not support onConflict: its target, variant "Feature", is stored in its own table',
          meta: {
            kind: 'create',
            relation: 'features',
            reason: 'mti-variant',
            variant: 'Feature',
          },
        }),
      );
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
