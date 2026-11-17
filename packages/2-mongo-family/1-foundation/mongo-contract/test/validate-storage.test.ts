import {
  asNamespaceId,
  type ContractModel,
  coreHash,
  profileHash,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { isStructuredError } from '@internal/utils/structured-error';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';

function crossRef(model: string, namespace: string = UNBOUND_DOMAIN_NAMESPACE_ID) {
  return { namespace: asNamespaceId(namespace), model };
}

import type { MongoContract, MongoModelStorage } from '../src/contract-types';
import { buildMongoNamespace } from '../src/ir/build-mongo-namespace';
import { MongoCollection } from '../src/ir/mongo-collection';
import { MongoStorage } from '../src/ir/mongo-storage';
import { validateMongoStorage } from '../src/validate-storage';

const DUMMY_HASH = coreHash('test');

function storageWithItemsCollections(
  collections: Record<string, MongoCollection>,
): MongoContract['storage'] {
  return new MongoStorage({
    storageHash: DUMMY_HASH,
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: buildMongoNamespace({
        id: UNBOUND_NAMESPACE_ID,
        entries: { collection: collections },
      }),
    },
  });
}

type MongoContractTestOverrides = Partial<MongoContract> & {
  models?: Record<string, ContractModel<MongoModelStorage>>;
};

function makeMinimalContract(overrides: MongoContractTestOverrides = {}): MongoContract {
  const { models, domain, ...rest } = overrides;
  const defaultModels: Record<string, ContractModel<MongoModelStorage>> = {
    Item: {
      fields: {
        _id: {
          type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
          nullable: false,
          many: false,
        },
      },
      storage: { fields: { _id: { field: '_id' } }, collection: 'items' },
      relations: {},
    },
  };
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: { items: crossRef('Item') },
    storage: storageWithItemsCollections({ items: new MongoCollection() }),
    domain: domain ?? applicationDomainOf({ models: models ?? defaultModels }),
    capabilities: {},
    extensions: {},
    profileHash: profileHash('test'),
    meta: {},
    ...rest,
  };
}

describe('validateMongoStorage()', () => {
  it('accepts a valid contract', () => {
    expect(() => validateMongoStorage(makeMinimalContract())).not.toThrow();
  });

  describe('embed relation targets', () => {
    it('rejects embed target with a collection', () => {
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: {
              _id: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
            },
            storage: {
              fields: { _id: { field: '_id' } },
              collection: 'items',
              relations: { tags: { field: 'tags' } },
            },
            relations: {
              tags: { to: crossRef('Tag'), cardinality: '1:N' as const },
            },
          },
          Tag: {
            fields: {
              name: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
                many: false,
              },
            },
            storage: { fields: { name: { field: 'name' } }, collection: 'tags' },
            relations: {},
            owner: 'Item',
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(/embed.*Tag.*must not.*collection/i);
    });

    it('validation failure raises CONTRACT.VALIDATION_FAILED', () => {
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: {
              _id: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
            },
            storage: {
              fields: { _id: { field: '_id' } },
              collection: 'items',
              relations: { tags: { field: 'tags' } },
            },
            relations: {
              tags: { to: crossRef('Tag'), cardinality: '1:N' as const },
            },
          },
          Tag: {
            fields: {
              name: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
                many: false,
              },
            },
            storage: { fields: { name: { field: 'name' } }, collection: 'tags' },
            relations: {},
            owner: 'Item',
          },
        },
      });
      try {
        validateMongoStorage(contract);
        expect.fail('expected throw');
      } catch (e) {
        expect(isStructuredError(e)).toBe(true);
        if (!isStructuredError(e)) return;
        expect(e.code).toBe('CONTRACT.VALIDATION_FAILED');
      }
    });

    it('rejects embed target owned by a different model', () => {
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: {
              _id: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
            },
            storage: { fields: { _id: { field: '_id' } }, collection: 'items' },
            relations: {
              tags: { to: crossRef('Tag'), cardinality: '1:N' as const },
            },
          },
          Other: {
            fields: {
              _id: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
            },
            storage: { fields: { _id: { field: '_id' } }, collection: 'items' },
            relations: {},
          },
          Tag: {
            fields: {
              name: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
                many: false,
              },
            },
            storage: { fields: { name: { field: 'name' } } },
            relations: {},
            owner: 'Other',
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(
        /embed.*tags.*Tag.*owned by.*Other.*not.*Item/i,
      );
    });

    it('accepts embed target with empty storage', () => {
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: {
              _id: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
            },
            storage: {
              fields: { _id: { field: '_id' } },
              collection: 'items',
              relations: { tags: { field: 'tags' } },
            },
            relations: {
              tags: { to: crossRef('Tag'), cardinality: '1:N' as const },
            },
          },
          Tag: {
            fields: {
              name: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
                many: false,
              },
            },
            storage: { fields: { name: { field: 'name' } } },
            relations: {},
            owner: 'Item',
          },
        },
      });
      expect(() => validateMongoStorage(contract)).not.toThrow();
    });
  });

  describe('to-one relation nullability against fields', () => {
    const objectId = {
      many: false as const,
      type: { kind: 'scalar' as const, codecId: 'mongo/objectId@1' },
    };
    function toOneContract(input: {
      readonly nullable: boolean | undefined;
      readonly authorIdNullable: boolean;
    }): MongoContract {
      return makeMinimalContract({
        roots: { posts: crossRef('Post') },
        storage: storageWithItemsCollections({
          posts: new MongoCollection(),
          users: new MongoCollection(),
        }),
        models: {
          Post: {
            fields: {
              _id: { ...objectId, nullable: false },
              authorId: { ...objectId, nullable: input.authorIdNullable },
            },
            storage: {
              fields: { _id: { field: '_id' }, authorId: { field: 'authorId' } },
              collection: 'posts',
            },
            relations: {
              author: {
                to: crossRef('User'),
                cardinality: 'N:1',
                on: { localFields: ['authorId'], targetFields: ['_id'] },
                ...(input.nullable === undefined ? {} : { nullable: input.nullable }),
              } as ContractModel<MongoModelStorage>['relations'][string],
            },
          },
          User: {
            fields: { _id: { ...objectId, nullable: false } },
            storage: { fields: { _id: { field: '_id' } }, collection: 'users' },
            relations: {},
          },
        },
      });
    }

    it.each([true, false])('accepts nullable: %s when the local field agrees', (nullable) => {
      expect(() =>
        validateMongoStorage(toOneContract({ nullable, authorIdNullable: nullable })),
      ).not.toThrow();
    });

    it('rejects nullable: true over a required local field, naming the field', () => {
      expect(() =>
        validateMongoStorage(toOneContract({ nullable: true, authorIdNullable: false })),
      ).toThrow(
        /Relation "author" on model "__unbound__:Post" is nullable but every local field is required.*"authorId"/,
      );
    });

    it('rejects nullable: false over a nullable local field, naming the field', () => {
      expect(() =>
        validateMongoStorage(toOneContract({ nullable: false, authorIdNullable: true })),
      ).toThrow(
        /Relation "author" on model "__unbound__:Post" is required but a local field is nullable.*"authorId"/,
      );
    });

    it('leaves a relation without the flag to hydration', () => {
      expect(() =>
        validateMongoStorage(toOneContract({ nullable: undefined, authorIdNullable: true })),
      ).not.toThrow();
    });

    function backSideContract(nullable: boolean): MongoContract {
      return makeMinimalContract({
        roots: { users: crossRef('User') },
        storage: storageWithItemsCollections({
          users: new MongoCollection(),
          profiles: new MongoCollection(),
        }),
        models: {
          User: {
            fields: { _id: { ...objectId, nullable: false } },
            storage: { fields: { _id: { field: '_id' } }, collection: 'users' },
            relations: {
              profile: {
                to: crossRef('Profile'),
                cardinality: '1:1',
                nullable,
                on: { localFields: ['_id'], targetFields: ['userId'] },
              },
            },
          },
          Profile: {
            fields: {
              _id: { ...objectId, nullable: false },
              userId: { ...objectId, nullable: false },
            },
            storage: {
              fields: { _id: { field: '_id' }, userId: { field: 'userId' } },
              collection: 'profiles',
            },
            relations: {},
          },
        },
      });
    }

    it('accepts nullable: true on the 1:1 side whose local field is the document id', () => {
      expect(() => validateMongoStorage(backSideContract(true))).not.toThrow();
    });

    it('rejects nullable: false on the 1:1 side that does not own the foreign key', () => {
      expect(() => validateMongoStorage(backSideContract(false))).toThrow(
        /Relation "profile" on model "__unbound__:User" is required but does not own the foreign key/,
      );
    });
  });

  describe('reference relation field existence', () => {
    it('rejects reference relation with localFields not in source model', () => {
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: {
              _id: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
            },
            storage: { fields: { _id: { field: '_id' } }, collection: 'items' },
            relations: {
              owner: {
                to: crossRef('User'),
                cardinality: 'N:1' as const,
                nullable: false,
                on: { localFields: ['ownerId'], targetFields: ['_id'] },
              },
            },
          },
          User: {
            fields: {
              _id: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
            },
            storage: { fields: { _id: { field: '_id' } }, collection: 'users' },
            relations: {},
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(
        /localField.*ownerId.*not.*field.*Item/i,
      );
    });

    it('rejects reference relation with targetFields not in target model', () => {
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: {
              _id: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
              ownerId: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
            },
            storage: {
              fields: { _id: { field: '_id' }, ownerId: { field: 'ownerId' } },
              collection: 'items',
            },
            relations: {
              owner: {
                to: crossRef('User'),
                cardinality: 'N:1' as const,
                nullable: false,
                on: { localFields: ['ownerId'], targetFields: ['userId'] },
              },
            },
          },
          User: {
            fields: {
              _id: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
            },
            storage: { fields: { _id: { field: '_id' } }, collection: 'users' },
            relations: {},
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(
        /targetField.*userId.*not.*field.*User/i,
      );
    });

    it('accepts reference relation with valid fields', () => {
      const contract = makeMinimalContract({
        storage: storageWithItemsCollections({
          items: new MongoCollection(),
          users: new MongoCollection(),
        }),
        models: {
          Item: {
            fields: {
              _id: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
              ownerId: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
            },
            storage: {
              fields: { _id: { field: '_id' }, ownerId: { field: 'ownerId' } },
              collection: 'items',
            },
            relations: {
              owner: {
                to: crossRef('User'),
                cardinality: 'N:1' as const,
                nullable: false,
                on: { localFields: ['ownerId'], targetFields: ['_id'] },
              },
            },
          },
          User: {
            fields: {
              _id: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
            },
            storage: { fields: { _id: { field: '_id' } }, collection: 'users' },
            relations: {},
          },
        },
      });
      expect(() => validateMongoStorage(contract)).not.toThrow();
    });
  });

  describe('variant collection must match base', () => {
    it('rejects variant with a different collection than its base', () => {
      const contract = makeMinimalContract({
        storage: storageWithItemsCollections({
          items: new MongoCollection(),
          other: new MongoCollection(),
        }),
        models: {
          Item: {
            fields: {
              _id: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
              type: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
                many: false,
              },
            },
            storage: {
              fields: { _id: { field: '_id' }, type: { field: 'type' } },
              collection: 'items',
            },
            relations: {},
            discriminator: { field: 'type' },
            variants: { special: crossRef('SpecialItem') },
          },
          SpecialItem: {
            fields: {
              extra: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
                many: false,
              },
            },
            storage: { fields: { extra: { field: 'extra' } }, collection: 'other' },
            relations: {},
            base: crossRef('Item'),
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(
        /multi-table inheritance.*variant.*SpecialItem.*must share.*base.*collection/i,
      );
    });

    it('accepts variant with same collection as its base', () => {
      const contract = makeMinimalContract({
        storage: storageWithItemsCollections({ items: new MongoCollection() }),
        models: {
          Item: {
            fields: {
              _id: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
              type: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
                many: false,
              },
            },
            storage: {
              fields: { _id: { field: '_id' }, type: { field: 'type' } },
              collection: 'items',
            },
            relations: {},
            discriminator: { field: 'type' },
            variants: { special: crossRef('SpecialItem') },
          },
          SpecialItem: {
            fields: {
              extra: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
                many: false,
              },
            },
            storage: { fields: { extra: { field: 'extra' } }, collection: 'items' },
            relations: {},
            base: crossRef('Item'),
          },
        },
      });
      expect(() => validateMongoStorage(contract)).not.toThrow();
    });
  });

  describe('field storage', () => {
    const objectId = {
      type: { kind: 'scalar' as const, codecId: 'mongo/objectId@1' },
      nullable: false,
      many: false as const,
    };
    const text = {
      type: { kind: 'scalar' as const, codecId: 'mongo/string@1' },
      nullable: false,
      many: false as const,
    };

    it('accepts a field stored under another key', () => {
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: { id: objectId },
            storage: { collection: 'items', fields: { id: { field: '_id' } } },
            relations: {},
          },
        },
      });
      expect(() => validateMongoStorage(contract)).not.toThrow();
    });

    it('rejects a field without a storage entry', () => {
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: { id: objectId, title: text },
            storage: { collection: 'items', fields: { id: { field: '_id' } } },
            relations: {},
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(
        'Model "__unbound__:Item" field "title" has no entry in storage.fields',
      );
    });

    it('rejects a storage entry for a field the model does not declare', () => {
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: { id: objectId },
            storage: {
              collection: 'items',
              fields: { id: { field: '_id' }, title: { field: 'title' } },
            },
            relations: {},
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(
        'Model "__unbound__:Item" storage.fields names "title", which is not a field of the model',
      );
    });

    it('rejects two fields stored under one key', () => {
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: { id: objectId, otherId: objectId },
            storage: {
              collection: 'items',
              fields: { id: { field: '_id' }, otherId: { field: '_id' } },
            },
            relations: {},
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(
        'Model "__unbound__:Item" fields "id" and "otherId" are both stored as "_id"',
      );
    });

    it('rejects a variant field stored under the key of a base field', () => {
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: { id: objectId, kind: text },
            storage: {
              collection: 'items',
              fields: { id: { field: '_id' }, kind: { field: 'kind' } },
            },
            relations: {},
            discriminator: { field: 'kind' },
            variants: { special: crossRef('SpecialItem') },
          },
          SpecialItem: {
            fields: { label: text },
            storage: { collection: 'items', fields: { label: { field: 'kind' } } },
            relations: {},
            base: crossRef('Item'),
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(
        'Model "__unbound__:SpecialItem" fields "kind" and "label" are both stored as "kind"',
      );
    });

    it('reports a base field without a storage entry once, without failing on its variant', () => {
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: { id: objectId, kind: text },
            storage: { collection: 'items', fields: { id: { field: '_id' } } },
            relations: {},
            discriminator: { field: 'kind' },
            variants: { special: crossRef('SpecialItem') },
          },
          SpecialItem: {
            fields: { label: text },
            storage: { collection: 'items', fields: { label: { field: 'label' } } },
            relations: {},
            base: crossRef('Item'),
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.VALIDATION_FAILED',
          message:
            'Contract storage validation failed:\n- Model "__unbound__:Item" field "kind" has no entry in storage.fields',
        }),
      );
    });

    it('rejects an embed relation stored under the stored name of a field', () => {
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: { id: objectId, notes: text },
            storage: {
              collection: 'items',
              fields: { id: { field: '_id' }, notes: { field: 'notes' } },
              relations: { comments: { field: 'notes' } },
            },
            relations: { comments: { to: crossRef('Comment'), cardinality: '1:N' } },
          },
          Comment: {
            fields: { body: text },
            storage: { fields: { body: { field: 'body' } } },
            relations: {},
            owner: 'Item',
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(
        'Model "__unbound__:Item" field "notes" and embed relation "comments" are both stored as "notes"',
      );
    });

    it('rejects a field and an embed relation stored as __proto__', () => {
      const contract = makeMinimalContract({
        models: {
          Item: {
            fields: { id: objectId, label: text },
            storage: {
              collection: 'items',
              fields: { id: { field: '_id' }, label: { field: '__proto__' } },
              relations: { comments: { field: '__proto__' } },
            },
            relations: { comments: { to: crossRef('Comment'), cardinality: '1:N' } },
          },
          Comment: {
            fields: { body: text },
            storage: { fields: { body: { field: 'body' } } },
            relations: {},
            owner: 'Item',
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(
        'Contract storage validation failed:\n- Model "__unbound__:Item" field "label" is stored as "__proto__", which JavaScript reads as the prototype of an object rather than as a key\n- Model "__unbound__:Item" embed relation "comments" is stored as "__proto__", which JavaScript reads as the prototype of an object rather than as a key',
      );
    });

    it('treats a field stored as _id as the document id of the back side of a 1:1', () => {
      const contract = makeMinimalContract({
        roots: { users: crossRef('User') },
        storage: storageWithItemsCollections({
          users: new MongoCollection(),
          profiles: new MongoCollection(),
        }),
        models: {
          User: {
            fields: { id: objectId },
            storage: { collection: 'users', fields: { id: { field: '_id' } } },
            relations: {
              profile: {
                to: crossRef('Profile'),
                cardinality: '1:1',
                nullable: true,
                on: { localFields: ['id'], targetFields: ['userId'] },
              },
            },
          },
          Profile: {
            fields: { id: objectId, userId: objectId },
            storage: {
              collection: 'profiles',
              fields: { id: { field: '_id' }, userId: { field: 'user_id' } },
            },
            relations: {},
          },
        },
      });
      expect(() => validateMongoStorage(contract)).not.toThrow();
    });
  });

  describe('collection-model consistency', () => {
    it('rejects model referencing a collection not declared in namespace collections', () => {
      const contract = makeMinimalContract({
        storage: storageWithItemsCollections({}),
        models: {
          Item: {
            fields: {
              _id: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
                many: false,
              },
            },
            storage: { fields: { _id: { field: '_id' } }, collection: 'items' },
            relations: {},
          },
        },
      });
      expect(() => validateMongoStorage(contract)).toThrow(
        /model.*Item.*collection.*items.*not declared/i,
      );
    });
  });
});
