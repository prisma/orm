import type { CrossReference, StorageHashBase } from '@internal/contract/types';
import { crossRef } from '@internal/contract/types';
import type {
  MongoContract,
  MongoContractWithTypeMaps,
  MongoTypeMaps,
} from '@internal/mongo-contract';

type DecodeFixtureModels = {
  readonly User: {
    readonly fields: {
      readonly _id: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
        readonly nullable: false;
      };
      readonly name: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
      };
      readonly email: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
      };
      readonly createdAt: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/date@1' };
        readonly nullable: false;
      };
      readonly embeddings: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/vector@1' };
        readonly nullable: false;
      };
    };
    readonly relations: Record<string, never>;
    readonly storage: { readonly collection: 'users' };
  };
  readonly Post: {
    readonly fields: {
      readonly _id: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
        readonly nullable: false;
      };
      readonly title: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' };
        readonly nullable: false;
      };
      readonly userId: {
        readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/objectId@1' };
        readonly nullable: false;
      };
    };
    readonly relations: {
      readonly user: {
        readonly to: CrossReference & { readonly model: 'User' };
        readonly cardinality: 'N:1';
        readonly nullable: false;
        readonly on: {
          readonly localFields: ['userId'];
          readonly targetFields: ['_id'];
        };
      };
    };
    readonly storage: { readonly collection: 'posts' };
  };
};

type DecodeFixtureStorage = {
  readonly storageHash: StorageHashBase<'decode-integration-test'>;
  readonly namespaces: {
    readonly __unbound__: {
      readonly id: '__unbound__';
      readonly kind: 'mongo-namespace';
      readonly entries: {
        readonly collection: {
          readonly users: { readonly kind: 'mongo-collection' };
          readonly posts: { readonly kind: 'mongo-collection' };
        };
      };
    };
  };
};

/**
 * Shared fixture contract for the decode integration tests.
 *
 * Lives in a typed `.ts` so it can drive `mongoQuery<TContract>(...)` row-type
 * inference end-to-end. Call sites validate the JSON via the Mongo contract
 * serializer SPI to keep the runtime structural shape honest, then thread
 * `TContract` through `mongoQuery` for the type-level path.
 */
export type DecodeFixtureContract = Omit<MongoContract<DecodeFixtureStorage>, 'domain'> & {
  readonly roots: {
    readonly users: CrossReference & { readonly model: 'User' };
    readonly posts: CrossReference & { readonly model: 'Post' };
  };
  readonly domain: {
    readonly namespaces: {
      readonly __unbound__: {
        readonly models: DecodeFixtureModels;
      };
    };
  };
};

export type DecodeFixtureCodecTypes = {
  readonly 'mongo/objectId@1': { readonly output: string };
  readonly 'mongo/string@1': { readonly output: string };
  readonly 'mongo/double@1': { readonly output: number };
  readonly 'mongo/int32@1': { readonly output: number };
  readonly 'mongo/bool@1': { readonly output: boolean };
  readonly 'mongo/date@1': { readonly output: Date };
  readonly 'mongo/vector@1': { readonly output: readonly number[] };
};

export type DecodeFixtureFieldOutputTypes = {
  readonly __unbound__: {
    readonly User: {
      readonly _id: string;
      readonly name: string;
      readonly email: string;
      readonly createdAt: Date;
      readonly embeddings: readonly number[];
    };
    readonly Post: {
      readonly _id: string;
      readonly title: string;
      readonly userId: string;
    };
  };
};

export type DecodeFixtureFieldInputTypes = DecodeFixtureFieldOutputTypes;
export type DecodeFixtureTypeMaps = MongoTypeMaps<
  DecodeFixtureCodecTypes,
  DecodeFixtureFieldOutputTypes,
  DecodeFixtureFieldInputTypes
>;
export type TDecodeFixtureContract = MongoContractWithTypeMaps<
  DecodeFixtureContract,
  DecodeFixtureTypeMaps
>;

export const decodeFixtureContractJson = {
  targetFamily: 'mongo' as const,
  roots: { users: crossRef('User'), posts: crossRef('Post') },
  domain: {
    namespaces: {
      __unbound__: {
        models: {
          User: {
            storage: { collection: 'users' },
            relations: {},
            fields: {
              _id: {
                type: { kind: 'scalar' as const, codecId: 'mongo/objectId@1' },
                nullable: false,
              },
              name: {
                type: { kind: 'scalar' as const, codecId: 'mongo/string@1' },
                nullable: false,
              },
              email: {
                type: { kind: 'scalar' as const, codecId: 'mongo/string@1' },
                nullable: false,
              },
              createdAt: {
                type: { kind: 'scalar' as const, codecId: 'mongo/date@1' },
                nullable: false,
              },
              embeddings: {
                type: { kind: 'scalar' as const, codecId: 'mongo/vector@1' },
                nullable: false,
              },
            },
          },
          Post: {
            storage: { collection: 'posts' },
            relations: {
              user: {
                to: crossRef('User'),
                cardinality: 'N:1',
                nullable: false,
                on: { localFields: ['userId'], targetFields: ['_id'] },
              },
            },
            fields: {
              _id: {
                type: { kind: 'scalar' as const, codecId: 'mongo/objectId@1' },
                nullable: false,
              },
              title: {
                type: { kind: 'scalar' as const, codecId: 'mongo/string@1' },
                nullable: false,
              },
              userId: {
                type: { kind: 'scalar' as const, codecId: 'mongo/objectId@1' },
                nullable: false,
              },
            },
          },
        },
      },
    },
  },
  storage: {
    namespaces: {
      __unbound__: {
        id: '__unbound__' as const,
        kind: 'mongo-namespace' as const,
        entries: {
          collection: {
            users: { kind: 'mongo-collection' as const },
            posts: { kind: 'mongo-collection' as const },
          },
        },
      },
    },
    storageHash: 'decode-integration-test',
  },
};
