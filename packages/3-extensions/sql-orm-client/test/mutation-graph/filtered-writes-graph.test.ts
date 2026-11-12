import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { BinaryExpr, ColumnRef, LiteralExpr } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createGraph, updateFirstGraph } from '../../src/mutation-graph/collection-graphs';
import { parseMutationInput } from '../../src/relation-mutations';
import type { RelationMutator } from '../../src/types';
import { createCollectionFor, relatedCollectionOf } from '../collection-fixtures';
import { getTestContext } from '../helpers';
import { printGraph } from './print-graph';

type Mutator = RelationMutator<Contract<SqlStorage>, string>;
type Context = ReturnType<typeof getTestContext>;

function graphOf(
  input: Record<string, unknown>,
  modelName: 'User' | 'Post' = 'User',
  context: Context = getTestContext(),
  state = false,
) {
  const relationMutations = parseMutationInput(
    context.contract,
    'public',
    modelName,
    input as never,
    relatedCollectionOf(context),
  ).relationMutations;
  const target = {
    context,
    state: createCollectionFor(modelName).collection.where({ id: 1 }).state,
    modelName,
    namespaceId: 'public',
  };
  return printGraph(updateFirstGraph(target, {}, relationMutations), { state });
}

function updateOf(...writes: string[]): string {
  return ['n1 Find users where id = 1 limit 1', ...writes, 'result: n1'].join('\n');
}

const viewsAreSeven = BinaryExpr.eq(ColumnRef.of('posts', 'views'), LiteralExpr.of(7));

describe('updateAll and deleteAll on a one-to-many relation in update()', () => {
  it.each([
    [
      'where().updateAll()',
      (posts: Mutator) => posts.where({ title: 'Draft' }).updateAll({ views: 1 }),
      "n2 Update posts set views = 1 where title = 'Draft' <- FilterData n1 (id->user_id)",
    ],
    [
      'chained where().deleteAll() with every filter form',
      (posts: Mutator) =>
        posts
          .where({ title: 'Draft' })
          .where((post) => post['views']!.gt(10))
          .where(viewsAreSeven)
          .deleteAll(),
      "n2 Delete posts where title = 'Draft' and views > 10 and views = 7 <- FilterData n1 (id->user_id)",
    ],
    [
      'updateAll()',
      (posts: Mutator) => posts.updateAll({ title: 'Published' }),
      "n2 Update posts set title = 'Published' <- FilterData n1 (id->user_id)",
    ],
    [
      'deleteAll()',
      (posts: Mutator) => posts.deleteAll(),
      'n2 Delete posts <- FilterData n1 (id->user_id)',
    ],
  ])('writes the children of the parent for %s', (_, posts, write) => {
    expect(graphOf({ posts })).toBe(updateOf(write));
  });

  it('adds no node for updateAll() with no data, and applies the update defaults otherwise', () => {
    const context: Context = {
      ...getTestContext(),
      applyMutationDefaults: (options) =>
        options.op === 'update' && options.entry === 'posts' ? [{ field: 'views', value: 99 }] : [],
    };

    expect({
      empty: graphOf({ posts: (posts: Mutator) => posts.updateAll({}) }, 'User', context),
      defaults: graphOf(
        { posts: (posts: Mutator) => posts.updateAll({ title: 'Published' }) },
        'User',
        context,
      ),
    }).toEqual({
      empty: updateOf(),
      defaults: updateOf(
        "n2 Update posts set title = 'Published', views = 99 <- FilterData n1 (id->user_id)",
      ),
    });
  });

  it.each([
    [
      'on the to-one relation Post.author',
      () => graphOf({ author: (author: Mutator) => author.deleteAll() }, 'Post'),
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      'deleteAll() nested mutation for relation "author" is only supported on to-many relations',
      { kind: 'deleteAll', relation: 'author', reason: 'to-one-relation' },
    ],
    [
      'on the to-one relation User.profile',
      () => graphOf({ profile: (profile: Mutator) => profile.updateAll({ bio: 'New' }) }),
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      'updateAll() nested mutation for relation "profile" is only supported on to-many relations',
      { kind: 'updateAll', relation: 'profile', reason: 'to-one-relation' },
    ],
    [
      'with updateAll() data that sets the field linking the children to the parent',
      () => graphOf({ posts: (posts: Mutator) => posts.updateAll({ title: 'a', userId: 2 }) }),
      'ORM.RELATION_MUTATION_INVALID',
      'updateAll() nested mutation for relation "posts" cannot set "userId", which links the related rows to their parent',
      { kind: 'updateAll', relation: 'posts', problem: 'parent-link-column', fields: ['userId'] },
    ],
    [
      'with an update default on the field linking the children to the parent',
      () =>
        graphOf({ posts: (posts: Mutator) => posts.updateAll({ title: 'a' }) }, 'User', {
          ...getTestContext(),
          applyMutationDefaults: (options) =>
            options.op === 'update' && options.entry === 'posts'
              ? [{ field: 'user_id', value: 2 }]
              : [],
        }),
      'ORM.RELATION_MUTATION_INVALID',
      'updateAll() nested mutation for relation "posts" cannot set "userId", which links the related rows to their parent',
      { kind: 'updateAll', relation: 'posts', problem: 'parent-link-column', fields: ['userId'] },
    ],
    [
      'in create()',
      () => {
        const context = getTestContext();
        const target = {
          context,
          state: createCollectionFor('User').collection.state,
          modelName: 'User',
          namespaceId: 'public',
        };
        const input = {
          id: 1,
          name: 'Ada',
          email: 'ada@example.com',
          posts: (posts: Mutator) => posts.updateAll({ views: 1 }),
        };
        return createGraph(
          target,
          parseMutationInput(
            context.contract,
            'public',
            'User',
            input as never,
            relatedCollectionOf(context),
          ),
        );
      },
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      'updateAll() is only supported in update() nested mutations',
      { kind: 'updateAll', relation: 'posts' },
    ],
  ] as const)('rejects a filtered write %s', (_, build, code, message, meta) => {
    expect(build).toThrow(expect.objectContaining({ code, message, meta }));
  });
});

describe('updateAll and deleteAll on a many-to-many relation in update()', () => {
  it('writes the targets linked to the parent that the filter matches, through a link edge over the junction', () => {
    expect(
      graphOf({
        tags: (tags: Mutator) => tags.where({ name: 'Rust' }).updateAll({ name: 'Rust 2' }),
      }),
    ).toBe(
      updateOf(
        "n2 Update tags set name = 'Rust 2' where name = 'Rust' <- JunctionFilterData n1 (id->user_id; user_tags tag_id->id)",
      ),
    );
  });

  it('orders the write after a junction insert of a connect earlier in the array', () => {
    const tags = (mutator: Mutator) => [
      mutator.connect({ name: 'Go' }),
      mutator.updateAll({ name: 'Golang' }),
    ];

    expect(graphOf({ tags }, 'User', getTestContext(), true)).toBe(
      [
        'n1 State users',
        'n2 Find users where id = 1 limit 1 <- state n1',
        'n3 State tags',
        "n4 Find tags where name = 'Go' limit 1 <- state n3, Requires n2",
        'n5 Assert <- Rows n4, Requires n2',
        'n6 State user_tags',
        'n7 Insert user_tags on conflict (user_id, tag_id) do nothing <- PayloadData n2 (id->user_id), PayloadData n4 (id->tag_id), state n6',
        'n8 State user_tags <- state n7',
        "n9 Update tags set name = 'Golang' <- JunctionFilterData n2 (id->user_id; user_tags tag_id->id), state n3, state n8",
        'n10 State tags <- state n9',
        'result: n2',
      ].join('\n'),
    );
  });
});
