import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { updateFirstGraph } from '../../src/mutation-graph/collection-graphs';
import { parseMutationInput } from '../../src/relation-mutations';
import type { RelationMutator } from '../../src/types';
import { createCollectionFor } from '../collection-fixtures';
import { getTestContext } from '../helpers';
import { printGraph } from './print-graph';

type Mutator = RelationMutator<Contract<SqlStorage>, string>;

function printUpdate(
  input: Record<string, unknown>,
  set: Record<string, unknown> = {},
  withPosts = false,
): string {
  const users = createCollectionFor('User').collection.where({ id: 1 });
  const state = withPosts ? users.include('posts').state : users.state;
  const context = getTestContext();
  const parsed = parseMutationInput(context.contract, 'public', 'User', input as never);
  return printGraph(
    updateFirstGraph(
      { context, state, modelName: 'User', namespaceId: 'public' },
      set,
      parsed.relationMutations,
    ),
  );
}

describe('updateFirstGraph with relation operations', () => {
  describe('a relation the parent holds the key for', () => {
    it('finds the row to connect and copies its key into the values of the Update', () => {
      expect(
        printUpdate(
          { invitedBy: (inviter: Mutator) => inviter.connect({ id: 2 }) },
          { name: 'Ada' },
        ),
      ).toBe(
        [
          'n1 Find users where id = 1 limit 1',
          'n2 Find users where id = 2 limit 1 <- Requires n1',
          'n3 Assert <- Rows n2, Requires n1',
          "n4 Update users set name = 'Ada' <- FilterData n1 (id->id), PayloadData n2 (id->invited_by_id)",
          'result: n4',
        ].join('\n'),
      );
    });

    it('creates the related row and writes its key with an Update even when nothing else is set', () => {
      expect(
        printUpdate({
          invitedBy: (inviter: Mutator) =>
            inviter.create({ id: 2, name: 'Grace', email: 'g@h.io' }),
        }),
      ).toBe(
        [
          'n1 Find users where id = 1 limit 1',
          'n2 Insert users <- Requires n1',
          'n3 Update users set nothing <- FilterData n1 (id->id), PayloadData n2 (id->invited_by_id)',
          'result: n3',
        ].join('\n'),
      );
    });

    it('sets the key of the parent to null on disconnect', () => {
      expect(printUpdate({ invitedBy: (inviter: Mutator) => inviter.disconnect() })).toBe(
        [
          'n1 Find users where id = 1 limit 1',
          'n2 Update users set invited_by_id = null <- FilterData n1 (id->id)',
          'result: n2',
        ].join('\n'),
      );
    });
  });

  describe('a relation the child holds the key for', () => {
    it('inserts the children with the key read from the Find when nothing is set', () => {
      expect(
        printUpdate({
          posts: (posts: Mutator) => posts.create([{ id: 10, title: 'a', views: 1 }]),
        }),
      ).toBe(
        [
          'n1 Find users where id = 1 limit 1',
          'n2 Insert posts <- PayloadData n1 (id->user_id)',
          'result: n1',
        ].join('\n'),
      );
    });

    it('sets the key of the parent on the children a connect matches', () => {
      expect(printUpdate({ posts: (posts: Mutator) => posts.connect({ id: 10 }) })).toBe(
        [
          'n1 Find users where id = 1 limit 1',
          'n2 Update posts set nothing where id = 10 <- PayloadData n1 (id->user_id)',
          'result: n1',
        ].join('\n'),
      );
    });

    it('sets the key to null on every child of the parent, or on those the criterion matches', () => {
      expect(printUpdate({ posts: (posts: Mutator) => posts.disconnect() })).toBe(
        [
          'n1 Find users where id = 1 limit 1',
          'n2 Update posts set user_id = null <- FilterData n1 (id->user_id)',
          'result: n1',
        ].join('\n'),
      );
      expect(printUpdate({ posts: (posts: Mutator) => posts.disconnect([{ id: 10 }]) })).toBe(
        [
          'n1 Find users where id = 1 limit 1',
          'n2 Update posts set user_id = null where id = 10 <- FilterData n1 (id->user_id)',
          'result: n1',
        ].join('\n'),
      );
    });
  });

  describe('a many-to-many relation', () => {
    it('inserts the target row, then the junction row with both keys', () => {
      expect(
        printUpdate({ tags: (tags: Mutator) => tags.create([{ id: 't1', name: 'SQL' }]) }),
      ).toBe(
        [
          'n1 Find users where id = 1 limit 1',
          'n2 Insert tags <- Requires n1',
          'n3 Insert user_tags <- PayloadData n1 (id->user_id), PayloadData n2 (id->tag_id)',
          'result: n1',
        ].join('\n'),
      );
    });

    it('finds and asserts the target, then inserts a junction row that skips an existing link', () => {
      expect(printUpdate({ tags: (tags: Mutator) => tags.connect({ name: 'SQL' }) })).toBe(
        [
          'n1 Find users where id = 1 limit 1',
          "n2 Find tags where name = 'SQL' limit 1 <- Requires n1",
          'n3 Assert <- Rows n2, Requires n1',
          'n4 Insert user_tags on conflict (user_id, tag_id) do nothing <- PayloadData n1 (id->user_id), PayloadData n2 (id->tag_id)',
          'result: n1',
        ].join('\n'),
      );
    });

    it('finds and asserts the target, then deletes the junction row by both keys', () => {
      expect(printUpdate({ tags: (tags: Mutator) => tags.disconnect([{ name: 'SQL' }]) })).toBe(
        [
          'n1 Find users where id = 1 limit 1',
          "n2 Find tags where name = 'SQL' limit 1 <- Requires n1",
          'n3 Assert <- Rows n2, Requires n1',
          'n4 Delete user_tags <- FilterData n1 (id->user_id), FilterData n2 (id->tag_id)',
          'result: n1',
        ].join('\n'),
      );
    });

    it('rejects a disconnect without criteria while the graph is built', () => {
      expect(() => printUpdate({ tags: (tags: Mutator) => tags.disconnect() })).toThrow(
        expect.objectContaining({
          code: 'ORM.RELATION_MUTATION_INVALID',
          message: 'disconnect() nested mutation for relation "tags" requires criterion',
          meta: { kind: 'disconnect', relation: 'tags', problem: 'missing-criterion' },
        }),
      );
    });
  });

  it('writes the parent, then the child operations, then reads the parent with its includes', () => {
    expect(
      printUpdate({ posts: (posts: Mutator) => posts.connect({ id: 10 }) }, { name: 'Ada' }, true),
    ).toBe(
      [
        'n1 Find users where id = 1 limit 1',
        "n2 Update users set name = 'Ada' <- FilterData n1 (id->id)",
        'n3 Update posts set nothing where id = 10 <- PayloadData n2 (id->user_id)',
        'n4 Find users <- FilterData n2 (id->id)',
        'result: n4',
      ].join('\n'),
    );
  });

  it('rejects an empty disconnect criterion on a relation the child holds the key for', () => {
    expect(() => printUpdate({ posts: (posts: Mutator) => posts.disconnect([{}]) })).toThrow(
      expect.objectContaining({
        code: 'ORM.RELATION_MUTATION_INVALID',
        message: 'disconnect() nested mutation for relation "posts" requires non-empty criterion',
        meta: { kind: 'disconnect', relation: 'posts', problem: 'empty-criterion' },
      }),
    );
  });
});
