import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import type { ActivitySource } from '@internal/sql-runtime';
import { describe, expect, it, vi } from 'vitest';
import { Collection } from '../src/collection';
import { describeCollectionRead } from '../src/statement-graph/read-graph';
import type { CollectionState } from '../src/types';
import { baseContract, createCollectionFor, withoutCapabilityKeys } from './collection-fixtures';
import { field, model, rel } from './contract-builder';
import { defineContractWithTables } from './contract-with-tables';
import { buildTestContextFromContract, createMockRuntime, type MockRuntime } from './helpers';

const perRelationContract = withoutCapabilityKeys(baseContract, [
  'outerReferencesInDerivedTables',
  'jsonAggWithoutTruncation',
]);

function selectedTables(runtime: MockRuntime): string[] {
  return runtime.executions.map(({ plan }) => {
    if (!('ast' in plan) || plan.ast.kind !== 'select') return '';
    const from = plan.ast.from;
    return from?.kind === 'table-source' ? from.name : '';
  });
}

function projectedAliases(runtime: MockRuntime): string[][] {
  return runtime.executions.map(({ plan }) =>
    'ast' in plan && plan.ast.kind === 'select'
      ? plan.ast.projection.map((item) => item.alias)
      : [],
  );
}

describe('a read with includes, one query per relation', () => {
  it('reads the parents, then the rows of each include, and attaches them to their parents', async () => {
    const { collection, runtime } = createCollectionFor('User', perRelationContract);
    runtime.setNextResults([
      [
        { id: 1, name: 'Ada' },
        { id: 2, name: 'Bea' },
      ],
      [
        { __prisma_parent_key_0: 1, id: 10, title: 'A' },
        { __prisma_parent_key_0: 1, id: 11, title: 'B' },
      ],
      [{ __prisma_parent_key_0: 2, id: 100, bio: 'Hi' }],
    ]);

    const rows = await collection
      .select('id', 'name')
      .include('posts', (posts) => posts.select('id', 'title'))
      .include('profile', (profile) => profile.select('id', 'bio'))
      .all();

    expect({ rows, tables: selectedTables(runtime) }).toEqual({
      rows: [
        {
          id: 1,
          name: 'Ada',
          posts: [
            { id: 10, title: 'A' },
            { id: 11, title: 'B' },
          ],
          profile: null,
        },
        { id: 2, name: 'Bea', posts: [], profile: { id: 100, bio: 'Hi' } },
      ],
      tables: ['users', 'posts', 'profiles'],
    });
  });

  it('removes the identity columns it read for the includes and the caller did not select', async () => {
    const { collection, runtime } = createCollectionFor('User', perRelationContract);
    runtime.setNextResults([
      [{ id: 1, name: 'Ada' }],
      [{ __prisma_parent_key_0: 1, id: 10, title: 'A' }],
      [{ __prisma_parent_key_0: 10, body: 'Nice' }],
    ]);

    const rows = await collection
      .select('name')
      .include('posts', (posts) =>
        posts.select('title').include('comments', (comments) => comments.select('body')),
      )
      .all();

    expect({ rows, projections: projectedAliases(runtime) }).toEqual({
      rows: [{ name: 'Ada', posts: [{ title: 'A', comments: [{ body: 'Nice' }] }] }],
      projections: [
        ['name', 'id'],
        ['__prisma_parent_key_0', 'title', 'id'],
        ['__prisma_parent_key_0', 'body'],
      ],
    });
  });

  it('carries the identity a nested include reads through the windows of a paged include', async () => {
    const { collection, runtime } = createCollectionFor('User', perRelationContract);
    runtime.setNextResults([
      [{ id: 1, name: 'Ada' }],
      [{ __prisma_parent_key_0: 1, id: 10, title: 'A', __prisma_row_number: 1 }],
      [{ __prisma_parent_key_0: 10, body: 'Nice' }],
    ]);

    const rows = await collection
      .select('name')
      .include('posts', (posts) =>
        posts
          .select('title')
          .limit(1)
          .include('comments', (comments) => comments.select('body')),
      )
      .all();

    expect({ rows, projections: projectedAliases(runtime) }).toEqual({
      rows: [{ name: 'Ada', posts: [{ title: 'A', comments: [{ body: 'Nice' }] }] }],
      projections: [
        ['name', 'id'],
        ['__prisma_parent_key_0', 'title', '__prisma_row_number', 'id'],
        ['__prisma_parent_key_0', 'body'],
      ],
    });
  });

  it('shapes each occurrence of a child row matched to several parents into its own object', async () => {
    const { collection, runtime } = createCollectionFor('Post', perRelationContract);
    runtime.setNextResults([
      [
        { id: 10, title: 'A' },
        { id: 11, title: 'B' },
      ],
      [
        { __prisma_parent_key_0: 10, id: 1, name: 'Ada' },
        { __prisma_parent_key_0: 11, id: 1, name: 'Ada' },
      ],
    ]);

    const rows = await collection
      .select('id', 'title')
      .include('author', (author) => author.select('id', 'name'))
      .all();

    expect(rows).toEqual([
      { id: 10, title: 'A', author: { id: 1, name: 'Ada' } },
      { id: 11, title: 'B', author: { id: 1, name: 'Ada' } },
    ]);
    expect(rows[0]?.author).not.toBe(rows[1]?.author);
  });

  it('sends no child statement when there is no parent row', async () => {
    const { collection, runtime } = createCollectionFor('User', perRelationContract);
    runtime.setNextResults([[]]);

    expect(await collection.include('posts').all()).toEqual([]);
    expect(selectedTables(runtime)).toEqual(['users']);
  });

  it('opens no transaction', async () => {
    const { collection, runtime } = createCollectionFor('User', perRelationContract);
    const transaction = vi.fn();
    Object.assign(runtime, { transaction });
    runtime.setNextResults([[{ id: 1 }], []]);

    await collection.select('id').include('posts').all();

    expect(transaction).not.toHaveBeenCalled();
  });

  it('keeps the one-query include when the contract reports what it needs', async () => {
    const { collection, runtime } = createCollectionFor('User');
    runtime.setNextResults([[]]);

    await collection.include('posts').include('profile').all();

    expect(selectedTables(runtime)).toEqual(['users']);
  });

  it('keeps a child column named parent_key apart from the parent key it returns', async () => {
    const Author = model('Author', {
      fields: { id: field.column(int4Column).id() },
    }).sql({ table: 'authors' });
    const Note = model('Note', {
      fields: {
        id: field.column(int4Column).id(),
        authorId: field.column(int4Column).column('author_id'),
        parentKey: field.column(textColumn).column('parent_key'),
      },
    }).sql({ table: 'notes' });
    const AuthorWithNotes = Author.relations({
      notes: rel.hasMany(() => Note, { by: 'authorId' }),
    }).sql({ table: 'authors' });
    const context = buildTestContextFromContract(
      defineContractWithTables({ Author: AuthorWithNotes, Note }, []),
    );
    const sql = context.contract.capabilities['sql'] ?? {};
    const perRelation = {
      ...context,
      contract: {
        ...context.contract,
        capabilities: {
          ...context.contract.capabilities,
          sql: { ...sql, outerReferencesInDerivedTables: false },
        },
      },
    };
    const runtime = createMockRuntime();
    runtime.setNextResults([
      [{ id: 1 }],
      [{ __prisma_parent_key_0: 1, id: 5, author_id: 1, parent_key: 'mine' }],
    ]);

    const authors = new Collection({ runtime, context: perRelation }, 'Author', {
      namespaceId: 'public',
    }) as unknown as { include(relation: string): { all(): Promise<unknown> } };

    const rows = await authors.include('notes').all();

    expect(rows).toEqual([{ id: 1, notes: [{ id: 5, authorId: 1, parentKey: 'mine' }] }]);
  });

  it('keys the cache by the statements it sends, each without parent keys', async () => {
    const { collection } = createCollectionFor('User', perRelationContract);
    const source = {
      planContentHash: async (plan: { readonly ast: { readonly from?: unknown } }) =>
        JSON.stringify(plan.ast.from),
    } as unknown as ActivitySource;
    const hashInputOf = (state: CollectionState) =>
      describeCollectionRead({
        context: collection.ctx.context,
        state,
        modelName: 'User',
        namespaceId: 'public',
      }).hashInput(source);

    const withPosts = await hashInputOf(collection.include('posts').state);
    const withProfile = await hashInputOf(collection.include('profile').state);

    expect(withPosts).toEqual({
      statements: [expect.stringContaining('"users"'), expect.stringContaining('"posts"')],
    });
    expect(withProfile).not.toEqual(withPosts);
  });
});
