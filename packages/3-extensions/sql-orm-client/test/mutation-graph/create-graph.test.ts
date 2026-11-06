import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createGraph } from '../../src/mutation-graph/collection-graphs';
import type { RelationMutator } from '../../src/types';
import { createCollectionFor } from '../collection-fixtures';
import { getTestContext } from '../helpers';
import { printGraph } from './print-graph';

type Mutator = RelationMutator<Contract<SqlStorage>, string>;
type Callback = (mutator: Mutator) => unknown;

function targetOf(modelName: 'User' | 'Post' | 'Project', withPosts = false) {
  const state = withPosts
    ? createCollectionFor('User').collection.include('posts').state
    : createCollectionFor(modelName).collection.state;
  return { context: getTestContext(), state, modelName, namespaceId: 'public' };
}

function printCreate(
  modelName: 'User' | 'Post' | 'Project',
  data: Record<string, unknown>,
): string {
  return printGraph(createGraph(targetOf(modelName), data));
}

const ada = { id: 1, name: 'Ada', email: 'ada@example.com' };
const hello = { id: 10, title: 'Hello', views: 0 };
const createPost: Callback = (posts) => posts.create([hello]);

describe('createGraph', () => {
  describe('a relation the parent holds the key for', () => {
    it('inserts the related row first and copies its key into the parent', () => {
      expect(
        printCreate('Post', { ...hello, author: (author: Mutator) => author.create(ada) }),
      ).toBe(
        ['n1 Insert users', 'n2 Insert posts <- PayloadData n1 (id->user_id)', 'result: n2'].join(
          '\n',
        ),
      );
    });

    it('finds the row to connect, asserts it exists and copies its key into the parent', () => {
      expect(
        printCreate('Post', {
          ...hello,
          author: (author: Mutator) => author.connect({ email: 'ada@example.com' }),
        }),
      ).toBe(
        [
          "n1 Find users where email = 'ada@example.com' limit 1",
          'n2 Assert <- Rows n1',
          'n3 Insert posts <- PayloadData n1 (id->user_id)',
          'result: n3',
        ].join('\n'),
      );
    });

    it('rejects disconnect while the graph is built', () => {
      expect(() =>
        createGraph(targetOf('Post'), {
          ...hello,
          author: (author: Mutator) => author.disconnect(),
        }),
      ).toThrow(
        expect.objectContaining({
          code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
          message: 'disconnect() is only supported in update() nested mutations',
          meta: { kind: 'disconnect', relation: 'author' },
        }),
      );
    });
  });

  describe('a relation the child holds the key for', () => {
    it('inserts the children in one Insert with the key of the parent', () => {
      expect(
        printCreate('User', {
          ...ada,
          posts: (posts: Mutator) => posts.create([hello, { id: 11, title: 'Again', views: 1 }]),
        }),
      ).toBe(
        [
          'n1 Insert users',
          'n2 Insert posts 2 rows <- PayloadData n1 (id->user_id)',
          'result: n1',
        ].join('\n'),
      );
    });

    it('sets the key of the parent on the children each criterion matches', () => {
      expect(
        printCreate('User', {
          ...ada,
          posts: (posts: Mutator) => posts.connect([{ id: 10 }, { id: 11 }]),
        }),
      ).toBe(
        [
          'n1 Insert users',
          'n2 Update posts set nothing where id = 10 <- PayloadData n1 (id->user_id)',
          'n3 Update posts set nothing where id = 11 <- PayloadData n1 (id->user_id)',
          'result: n1',
        ].join('\n'),
      );
    });

    it('rejects disconnect while the graph is built', () => {
      expect(() =>
        createGraph(targetOf('User'), {
          ...ada,
          posts: (posts: Mutator) => posts.disconnect(),
        }),
      ).toThrow(expect.objectContaining({ code: 'ORM.RELATION_MUTATION_UNSUPPORTED' }));
    });
  });

  describe('a many-to-many relation', () => {
    it('inserts the target row, then the junction row with both keys', () => {
      expect(
        printCreate('User', {
          ...ada,
          tags: (tags: Mutator) => tags.create([{ id: 't1', name: 'SQL' }]),
        }),
      ).toBe(
        [
          'n1 Insert users',
          'n2 Insert tags',
          'n3 Insert user_tags <- PayloadData n1 (id->user_id), PayloadData n2 (id->tag_id)',
          'result: n1',
        ].join('\n'),
      );
    });

    it('finds and asserts each target, then inserts a junction row that skips an existing link', () => {
      expect(
        printCreate('User', {
          ...ada,
          tags: (tags: Mutator) => tags.connect([{ name: 'SQL' }, { name: 'Rust' }]),
        }),
      ).toBe(
        [
          'n1 Insert users',
          "n2 Find tags where name = 'SQL' limit 1",
          'n3 Assert <- Rows n2',
          'n4 Insert user_tags on conflict (user_id, tag_id) do nothing <- PayloadData n1 (id->user_id), PayloadData n2 (id->tag_id)',
          "n5 Find tags where name = 'Rust' limit 1",
          'n6 Assert <- Rows n5',
          'n7 Insert user_tags on conflict (user_id, tag_id) do nothing <- PayloadData n1 (id->user_id), PayloadData n5 (id->tag_id)',
          'result: n1',
        ].join('\n'),
      );
    });

    it('copies every column of a composite key into the junction row', () => {
      expect(
        printCreate('Project', {
          id: 1,
          tenantId: 7,
          name: 'Core',
          related: (related: Mutator) => related.connect({ tenantId: 7, id: 2 }),
        }),
      ).toBe(
        [
          'n1 Insert projects',
          'n2 Find projects where tenant_id = 7 and id = 2 limit 1',
          'n3 Assert <- Rows n2',
          'n4 Insert project_links on conflict (src_tenant_id, src_id, dst_tenant_id, dst_id) do nothing <- PayloadData n1 (tenant_id->src_tenant_id, id->src_id), PayloadData n2 (tenant_id->dst_tenant_id, id->dst_id)',
          'result: n1',
        ].join('\n'),
      );
    });

    it('rejects a junction with a required column the relation cannot fill', () => {
      expect(() =>
        createGraph(targetOf('User'), {
          ...ada,
          roles: (roles: Mutator) => roles.connect({ id: 1 }),
        }),
      ).toThrow(
        expect.objectContaining({
          code: 'ORM.RELATION_MUTATION_UNSUPPORTED',
          meta: {
            kind: 'connect',
            relation: 'roles',
            reason: 'junction-required-columns',
            junction: 'user_roles',
          },
        }),
      );
    });
  });

  describe('phase order and recursion', () => {
    it('adds parent-held relations, the parent, child-held relations, then many-to-many', () => {
      expect(
        printCreate('User', {
          ...ada,
          tags: (tags: Mutator) => tags.create([{ id: 't1', name: 'SQL' }]),
          posts: createPost,
          invitedBy: (inviter: Mutator) => inviter.connect({ id: 2 }),
        }),
      ).toBe(
        [
          'n1 Find users where id = 2 limit 1',
          'n2 Assert <- Rows n1',
          'n3 Insert users <- PayloadData n1 (id->invited_by_id)',
          'n4 Insert posts <- PayloadData n3 (id->user_id)',
          'n5 Insert tags',
          'n6 Insert user_tags <- PayloadData n3 (id->user_id), PayloadData n5 (id->tag_id)',
          'result: n3',
        ].join('\n'),
      );
    });

    it('translates the relations of a nested create in the same order, one child row at a time', () => {
      expect(
        printCreate('User', {
          ...ada,
          posts: (posts: Mutator) =>
            posts.create([
              {
                ...hello,
                comments: (comments: Mutator) => comments.create([{ id: 100, body: 'Hi' }]),
              },
              { id: 11, title: 'Again', views: 1 },
            ]),
        }),
      ).toBe(
        [
          'n1 Insert users',
          'n2 Insert posts <- PayloadData n1 (id->user_id)',
          'n3 Insert comments <- PayloadData n2 (id->post_id)',
          'n4 Insert posts <- PayloadData n1 (id->user_id)',
          'result: n1',
        ].join('\n'),
      );
    });

    it('reads the parent with its includes after every child operation', () => {
      const graph = createGraph(targetOf('User', true), { ...ada, posts: createPost });

      expect(printGraph(graph)).toBe(
        [
          'n1 Insert users',
          'n2 Insert posts <- PayloadData n1 (id->user_id)',
          'n3 Find users <- FilterData n1 (id->id)',
          'result: n3',
        ].join('\n'),
      );
    });
  });

  describe('rejections while the graph is built', () => {
    it('rejects a relation field that is not a callback', () => {
      expect(() =>
        createGraph(targetOf('User'), { ...ada, posts: [hello], tags: createPost }),
      ).toThrow(
        expect.objectContaining({
          code: 'ORM.RELATION_MUTATION_INVALID',
          message: 'Relation field "posts" on model "User" expects a mutator callback',
          meta: { relation: 'posts', model: 'User', problem: 'missing-callback' },
        }),
      );
    });

    it('rejects a callback that returns no relation operation', () => {
      expect(() =>
        createGraph(targetOf('User'), { ...ada, posts: () => ({ invalid: true }) }),
      ).toThrow(
        expect.objectContaining({
          code: 'ORM.RELATION_MUTATION_INVALID',
          meta: { relation: 'posts', model: 'User', problem: 'invalid-descriptor' },
        }),
      );
    });

    it('rejects a connect without a criterion on a relation the parent holds the key for', () => {
      expect(() =>
        createGraph(targetOf('Post'), {
          ...hello,
          author: (author: Mutator) => author.connect([]),
        }),
      ).toThrow(
        expect.objectContaining({
          code: 'ORM.RELATION_MUTATION_INVALID',
          message: 'connect() nested mutation for relation "author" requires criterion',
          meta: { kind: 'connect', relation: 'author', problem: 'missing-criterion' },
        }),
      );
    });

    it('rejects an empty criterion on a relation the child holds the key for', () => {
      expect(() =>
        createGraph(targetOf('User'), { ...ada, posts: (posts: Mutator) => posts.connect({}) }),
      ).toThrow(
        expect.objectContaining({
          code: 'ORM.RELATION_MUTATION_INVALID',
          message: 'connect() nested mutation for relation "posts" requires non-empty criterion',
          meta: { kind: 'connect', relation: 'posts', problem: 'empty-criterion' },
        }),
      );
    });
  });
});
