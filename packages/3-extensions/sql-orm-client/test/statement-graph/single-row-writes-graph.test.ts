import { describe, expect, it } from 'vitest';
import { parseMutationInput } from '../../src/relation-mutations';
import { createGraph, updateFirstGraph } from '../../src/statement-graph/collection-graphs';
import { createCollectionFor, relatedCollectionOf } from '../collection-fixtures';
import { getTestContext } from '../helpers';
import { printGraph } from './print-graph';

interface SingleRowMutator {
  where(filter: object): SingleRowMutator;
  update(data: object): unknown;
  delete(): unknown;
}

function parsed(modelName: 'User' | 'Post', input: Record<string, unknown>) {
  const context = getTestContext();
  return parseMutationInput(
    context.contract,
    'public',
    modelName,
    input as never,
    relatedCollectionOf(context),
  );
}

function printUpdate(
  input: Record<string, unknown>,
  modelName: 'User' | 'Post' = 'User',
  set: Record<string, unknown> = {},
): string {
  return printGraph(
    updateFirstGraph(
      {
        context: getTestContext(),
        state: createCollectionFor(modelName).collection.where({ id: 1 }).state,
        modelName,
        namespaceId: 'public',
      },
      set,
      parsed(modelName, input).relationMutations,
    ),
  );
}

describe('update() and delete() on a relation the child holds the key for', () => {
  it('updates the first child the filter matches, found among the children of the parent', () => {
    expect(
      printUpdate({
        posts: (posts: SingleRowMutator) => posts.where({ title: 'Draft' }).update({ views: 5 }),
      }),
    ).toBe(
      [
        'n1 Find users where id = 1',
        "n2 Find posts where title = 'Draft' limit 1 <- FilterData n1 (id->user_id)",
        "n3 Update posts set views = 5 where title = 'Draft' <- FilterData n2 (id->id)",
        'result: n1',
      ].join('\n'),
    );
  });

  it('deletes the first child the filter matches, after the Update of the parent', () => {
    expect(
      printUpdate(
        { posts: (posts: SingleRowMutator) => posts.where({ title: 'Draft' }).delete() },
        'User',
        { name: 'Ada' },
      ),
    ).toBe(
      [
        'n1 Find users where id = 1',
        "n2 Update users set name = 'Ada' where id = 1",
        "n3 Find posts where title = 'Draft' limit 1 <- FilterData n2 (id->user_id)",
        "n4 Delete posts where title = 'Draft' <- FilterData n3 (id->id)",
        'result: n2',
      ].join('\n'),
    );
  });

  it('updates and deletes the linked row of a to-one relation, narrowed by where()', () => {
    expect(
      printUpdate({
        profile: (profile: SingleRowMutator) => profile.update({ bio: 'New' }),
      }),
    ).toBe(
      [
        'n1 Find users where id = 1',
        'n2 Find profiles limit 1 <- FilterData n1 (id->user_id)',
        "n3 Update profiles set bio = 'New' <- FilterData n2 (id->id)",
        'result: n1',
      ].join('\n'),
    );
    expect(
      printUpdate({
        profile: (profile: SingleRowMutator) => profile.where({ bio: 'Old' }).delete(),
      }),
    ).toBe(
      [
        'n1 Find users where id = 1',
        "n2 Find profiles where bio = 'Old' limit 1 <- FilterData n1 (id->user_id)",
        "n3 Delete profiles where bio = 'Old' <- FilterData n2 (id->id)",
        'result: n1',
      ].join('\n'),
    );
  });

  it('adds the operations on one relation in array order', () => {
    expect(
      printUpdate({
        posts: (posts: SingleRowMutator) => [
          posts.where({ id: 10 }).delete(),
          posts.where({ id: 11 }).update({ views: 1 }),
        ],
      }),
    ).toBe(
      [
        'n1 Find users where id = 1',
        'n2 Find posts where id = 10 limit 1 <- FilterData n1 (id->user_id)',
        'n3 Delete posts where id = 10 <- FilterData n2 (id->id)',
        'n4 Find posts where id = 11 limit 1 <- FilterData n1 (id->user_id)',
        'n5 Update posts set views = 1 where id = 11 <- FilterData n4 (id->id)',
        'result: n1',
      ].join('\n'),
    );
  });
});

describe('rejections of update() and delete() on a relation', () => {
  it.each([
    [
      'update() without where() on a to-many relation',
      'User',
      { posts: (posts: SingleRowMutator) => posts.update({ views: 1 }) },
      'ORM.ARGUMENT_INVALID',
      'update() nested mutation for relation "posts" requires where() on a to-many relation',
      { kind: 'update', relation: 'posts', problem: 'missing-where' },
    ],
    [
      'delete() without where() on a to-many relation',
      'User',
      { posts: (posts: SingleRowMutator) => posts.delete() },
      'ORM.ARGUMENT_INVALID',
      'delete() nested mutation for relation "posts" requires where() on a to-many relation',
      { kind: 'delete', relation: 'posts', problem: 'missing-where' },
    ],
    [
      'delete() after where() with an empty filter on a to-many relation',
      'User',
      { posts: (posts: SingleRowMutator) => posts.where({}).delete() },
      'ORM.ARGUMENT_INVALID',
      'delete() nested mutation for relation "posts" requires where() on a to-many relation',
      { kind: 'delete', relation: 'posts', problem: 'missing-where' },
    ],
    [
      'update() data that sets the link to the parent',
      'User',
      { posts: (posts: SingleRowMutator) => posts.where({ id: 10 }).update({ userId: 2 }) },
      'ORM.ARGUMENT_INVALID',
      'update() nested mutation for relation "posts" cannot set "userId", which links the related rows to their parent',
      { kind: 'update', relation: 'posts', problem: 'parent-link-column', fields: ['userId'] },
    ],
    [
      'update() on a relation the parent holds the key for',
      'Post',
      { author: (author: SingleRowMutator) => author.update({ name: 'Ada' }) },
      'ORM.OPERATION_UNSUPPORTED',
      'update() nested mutation for relation "author" is not supported yet on this relation',
      { kind: 'update', relation: 'author', reason: 'single-row-layout' },
    ],
    [
      'delete() on a many-to-many relation',
      'User',
      { tags: (tags: SingleRowMutator) => tags.where({ name: 'SQL' }).delete() },
      'ORM.OPERATION_UNSUPPORTED',
      'delete() nested mutation for relation "tags" is not supported yet on this relation',
      { kind: 'delete', relation: 'tags', reason: 'single-row-layout' },
    ],
  ] as const)('rejects %s while the graph is built', (_, modelName, input, code, message, meta) => {
    expect(() => printUpdate(input, modelName)).toThrow(
      expect.objectContaining({ code, message, meta }),
    );
  });

  it('rejects an update or delete descriptor without a state or data as an invalid descriptor', () => {
    for (const descriptor of [{ kind: 'delete' }, { kind: 'update', state: {} }]) {
      expect(() => printUpdate({ profile: () => descriptor })).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          meta: expect.objectContaining({ relation: 'profile', problem: 'invalid-descriptor' }),
        }),
      );
    }
  });

  it('rejects update() inside create()', () => {
    const target = {
      context: getTestContext(),
      state: createCollectionFor('User').collection.state,
      modelName: 'User',
      namespaceId: 'public',
    };
    const input = {
      id: 1,
      name: 'Ada',
      email: 'ada@example.com',
      profile: (profile: SingleRowMutator) => profile.update({ bio: 'New' }),
    };

    expect(() => createGraph(target, parsed('User', input))).toThrow(
      expect.objectContaining({
        code: 'ORM.OPERATION_UNSUPPORTED',
        message: 'update() is only supported in update() nested mutations',
        meta: { kind: 'update', relation: 'profile' },
      }),
    );
  });
});
