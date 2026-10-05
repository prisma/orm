import { crossRef } from '@internal/contract/types';
import type { MongoModelDefinition } from '@internal/mongo-contract';
import { describe, expect, it } from 'vitest';
import { applicationFieldName, mapStorageRow, storageFieldName } from '../src/field-mapping';

const post: MongoModelDefinition = {
  fields: {},
  relations: {
    author: {
      to: crossRef('User'),
      cardinality: 'N:1',
      nullable: false,
      on: { localFields: ['authorId'], targetFields: ['id'] },
    },
  },
  storage: {
    collection: 'posts',
    fields: { id: { field: '_id' }, updatedAt: { field: 'updated_at' } },
  },
};
const user: MongoModelDefinition = {
  fields: {},
  relations: {},
  storage: {
    collection: 'users',
    fields: { id: { field: '_id' }, displayName: { field: 'display_name' } },
  },
};

describe('Mongo ORM field mapping', () => {
  it('resolves application and storage names with identity fallback and dot paths', () => {
    expect([
      storageFieldName(post, 'updatedAt'),
      storageFieldName(post, 'updatedAt.part'),
      storageFieldName(post, 'title'),
      applicationFieldName(post, '_id'),
      applicationFieldName(post, 'title'),
    ]).toEqual(['updated_at', 'updated_at.part', 'title', 'id', 'title']);
  });

  it('maps decoded rows and included documents without changing scalar values', () => {
    const at = new Date('2025-01-01');
    expect(
      mapStorageRow(
        post,
        {
          _id: 'post-id',
          updated_at: at,
          title: 'Post',
          author: { _id: 'user-id', display_name: 'Alice' },
        },
        (name) => (name === 'User' ? user : undefined),
      ),
    ).toEqual({
      id: 'post-id',
      updatedAt: at,
      title: 'Post',
      author: { id: 'user-id', displayName: 'Alice' },
    });
    expect(mapStorageRow(post, { author: null })).toEqual({ author: null });
  });

  it('uses a row discriminator to map variant fields', () => {
    const base: MongoModelDefinition = {
      ...post,
      discriminator: { field: 'kind' },
      variants: { Bug: { value: 'bug' } },
      storage: {
        ...post.storage,
        fields: { ...post.storage.fields, kind: { field: 'task_kind' } },
      },
    };
    const bug: MongoModelDefinition = {
      fields: {},
      relations: {},
      storage: { fields: { severity: { field: 'level' } } },
    };
    expect(
      mapStorageRow(base, { _id: 'id', task_kind: 'bug', level: 'high' }, (name) =>
        name === 'Bug' ? bug : undefined,
      ),
    ).toEqual({ id: 'id', kind: 'bug', severity: 'high' });
  });
});
