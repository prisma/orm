import { coreHash, crossRef } from '@internal/contract/types';
import { createMongoContract } from './create-mongo-contract';

export const blogContract = createMongoContract({
  roots: {
    users: crossRef('User'),
    posts: crossRef('Post'),
  },
  models: {
    User: {
      fields: {
        _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
        name: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        email: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        bio: { nullable: true, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
      },
      relations: {
        posts: {
          to: crossRef('Post'),
          cardinality: '1:N',
          on: { localFields: ['_id'], targetFields: ['authorId'] },
        },
      },
      storage: { collection: 'users' },
    },
    Post: {
      fields: {
        _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
        title: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        content: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        authorId: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
      },
      relations: {
        author: {
          to: crossRef('User'),
          cardinality: 'N:1',
          nullable: false,
          on: { localFields: ['authorId'], targetFields: ['_id'] },
        },
        comments: {
          to: crossRef('Comment'),
          cardinality: '1:N',
        },
      },
      storage: {
        collection: 'posts',
        relations: { comments: { field: 'comments' } },
      },
    },
    Comment: {
      fields: {
        _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
        text: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
        createdAt: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/date@1' } },
      },
      relations: {},
      storage: {},
      owner: 'Post',
    },
  },
  storage: {
    storageHash: coreHash('test'),
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          collection: {
            users: {},
            posts: {},
          },
        },
      },
    },
  },
});
