import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { updateFirstGraph } from '../../src/mutation-graph/collection-graphs';
import { parseMutationInput } from '../../src/relation-mutations';
import type { RelationMutator } from '../../src/types';
import { createCollectionFor, relatedCollectionOf } from '../collection-fixtures';
import {
  buildMixedPolyContract,
  buildTestContextFromContract,
  getTestContext,
  withPatchedDomainModels,
} from '../helpers';
import { printGraph } from './print-graph';

type Mutator = RelationMutator<Contract<SqlStorage>, string>;

const post = { id: 10, title: 'Hello', views: 0 };

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
  it('builds the same graph for onConflict skip on a one-to-many relation as without options', () => {
    expect(
      printUpdate({
        posts: (posts: Mutator) =>
          posts.create([post], { onConflict: 'skip', conflictOn: ['title'] }),
      }),
    ).toBe(printUpdate({ posts: (posts: Mutator) => posts.create([post]) }));
  });

  const rejections = [
    [
      'onConflict skip on the to-one relation User.profile',
      'User',
      {
        profile: (profile: Mutator) => profile.create({ id: 5, bio: 'Hi' }, { onConflict: 'skip' }),
      },
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      'create() nested mutation for relation "profile" supports onConflict "skip" only on one-to-many relations',
      { kind: 'create', relation: 'profile', reason: 'to-one-relation' },
    ],
    [
      'onConflict skip on the to-one relation Post.author',
      'Post',
      {
        author: (author: Mutator) =>
          author.create({ id: 5, name: 'Ada', email: 'ada@example.com' }, { onConflict: 'skip' }),
      },
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      'create() nested mutation for relation "author" supports onConflict "skip" only on one-to-many relations',
      { kind: 'create', relation: 'author', reason: 'to-one-relation' },
    ],
    [
      'onConflict skip on the many-to-many relation User.tags',
      'User',
      { tags: (tags: Mutator) => tags.create([{ id: 't', name: 'Go' }], { onConflict: 'skip' }) },
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      'create() nested mutation for relation "tags" supports onConflict "skip" only on one-to-many relations',
      { kind: 'create', relation: 'tags', reason: 'many-to-many-relation' },
    ],
    [
      'an onConflict value other than skip or connect',
      'User',
      { posts: (posts: Mutator) => posts.create([post], { onConflict: 'replace' } as never) },
      'ORM.RELATION_MUTATION_INVALID',
      'create() nested mutation for relation "posts" takes onConflict "skip" or "connect"; received "replace"',
      { kind: 'create', relation: 'posts', problem: 'invalid-on-conflict' },
    ],
    [
      'a conflictOn entry that is not a field of the related model',
      'User',
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
      'onConflict connect',
      'User',
      { posts: (posts: Mutator) => posts.create(post, { onConflict: 'connect' }) },
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      'create() nested mutation for relation "posts" does not support onConflict "connect"',
      { kind: 'create', relation: 'posts', reason: 'on-conflict-connect' },
    ],
    [
      'onConflict connect on a create nested in a create row',
      'User',
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
    async (_, modelName, input, code, message, meta) => {
      const { collection, runtime } = createCollectionFor(modelName);
      runtime.setNextResults([[]]);

      await expect(collection.where({ id: 1 }).update(input as never)).rejects.toThrow(
        expect.objectContaining({ code, message, meta }),
      );
      expect(runtime.executions).toEqual([]);
    },
  );

  it.each(rejections)(
    'rejects %s in create() before any statement',
    async (_, modelName, input, code, message, meta) => {
      const { collection, runtime } = createCollectionFor(modelName);
      const parent =
        modelName === 'User'
          ? { id: 1, name: 'Ada', email: 'ada@example.com' }
          : { id: 1, title: 'Hello', views: 0 };

      await expect(collection.create({ ...parent, ...input } as never)).rejects.toThrow(
        expect.objectContaining({ code, message, meta }),
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

    it.each(['skip', 'connect'] as const)('rejects onConflict %s', (onConflict) => {
      expect(() =>
        parse({
          features: (features: Mutator) =>
            features.create({ id: 1, title: 'A', priority: 1 }, { onConflict }),
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

    it('accepts onConflict skip on a variant stored in the table of its base model', () => {
      expect(
        parse({
          bugs: (bugs: Mutator) => bugs.create({ id: 1, title: 'A' }, { onConflict: 'skip' }),
        }).relationMutations.map(({ name }) => name),
      ).toEqual(['bugs']);
    });
  });
});
