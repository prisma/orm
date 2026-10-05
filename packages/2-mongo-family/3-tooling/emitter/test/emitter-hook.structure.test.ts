import type { Contract, ContractModelBase } from '@internal/contract/types';
import { crossRef } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { mongoEmission } from '../src/index';
import {
  createMongoContract,
  namespacedMongoStorageFromCollections,
} from './fixtures/create-mongo-contract';

describe('mongoEmission.validateStructure', () => {
  it('passes for valid minimal contract', () => {
    const contract = createMongoContract({
      models: {
        User: {
          fields: {
            _id: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
            },
          },
          relations: {},
          storage: { collection: 'users' },
        },
      },
      storage: namespacedMongoStorageFromCollections({ users: {} }),
    });
    expect(() => mongoEmission.validateStructure(contract)).not.toThrow();
  });

  it('throws for wrong targetFamily', () => {
    const contract = createMongoContract({ targetFamily: 'sql' });
    expect(() => mongoEmission.validateStructure(contract)).toThrow(
      'Expected targetFamily "mongo"',
    );
  });

  it('structural validation failure raises CONTRACT.VALIDATION_FAILED', () => {
    const contract = createMongoContract({ targetFamily: 'sql' });
    try {
      mongoEmission.validateStructure(contract);
      expect.fail('expected throw');
    } catch (e) {
      expect(isStructuredError(e)).toBe(true);
      if (!isStructuredError(e)) return;
      expect(e.code).toBe('CONTRACT.VALIDATION_FAILED');
    }
  });

  it('duplicate collection name across namespaces raises CONTRACT.NAME_DUPLICATE', () => {
    const contract = createMongoContract({
      storage: blindCast<Contract['storage'], 'test storage with a duplicate collection name'>({
        storageHash: 'test',
        namespaces: {
          a: { id: 'a', kind: 'mongo-namespace', entries: { collection: { users: {} } } },
          b: { id: 'b', kind: 'mongo-namespace', entries: { collection: { users: {} } } },
        },
      }),
    });
    try {
      mongoEmission.validateStructure(contract);
      expect.fail('expected throw');
    } catch (e) {
      expect(isStructuredError(e)).toBe(true);
      if (!isStructuredError(e)) return;
      expect(e.code).toBe('CONTRACT.NAME_DUPLICATE');
    }
  });

  it('throws for missing storage.namespaces', () => {
    const contract = {
      ...createMongoContract(),
      storage: { storageHash: 'test' },
    } as Contract;
    expect(() => mongoEmission.validateStructure(contract)).toThrow('must have storage.namespaces');
  });

  it('throws when model references non-existent collection', () => {
    const contract = createMongoContract({
      models: {
        User: {
          fields: {
            _id: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
            },
          },
          relations: {},
          storage: { collection: 'users' },
        },
      },
      storage: namespacedMongoStorageFromCollections({}),
    });
    expect(() => mongoEmission.validateStructure(contract)).toThrow(
      'references collection "users" which is not in storage.namespaces[..].entries.collection',
    );
  });

  it('throws when model is missing fields', () => {
    const contract = createMongoContract({
      models: {
        User: blindCast<
          ContractModelBase,
          'intentionally missing "fields" to exercise validateStructure\'s runtime guard against malformed contracts'
        >({
          relations: {},
          storage: { collection: 'users' },
        }),
      },
      storage: namespacedMongoStorageFromCollections({ users: {} }),
    });
    expect(() => mongoEmission.validateStructure(contract)).toThrow(
      'missing required field "fields"',
    );
  });

  it('throws when model is missing relations', () => {
    const contract = createMongoContract({
      models: {
        User: blindCast<
          ContractModelBase,
          'intentionally missing "relations" to exercise validateStructure\'s runtime guard against malformed contracts'
        >({
          fields: {
            _id: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
            },
          },
          storage: { collection: 'users' },
        }),
      },
      storage: namespacedMongoStorageFromCollections({ users: {} }),
    });
    expect(() => mongoEmission.validateStructure(contract)).toThrow(
      'missing required field "relations"',
    );
  });

  it('throws when owned model has a collection', () => {
    const contract = createMongoContract({
      models: {
        User: {
          fields: {
            _id: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
            },
          },
          relations: {},
          storage: { collection: 'users' },
        },
        Address: {
          fields: {
            street: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/string@1' },
            },
          },
          relations: {},
          storage: { collection: 'users' },
          owner: 'User',
        },
      },
      storage: namespacedMongoStorageFromCollections({ users: {} }),
    });
    expect(() => mongoEmission.validateStructure(contract)).toThrow(
      /Owned model "__unbound__:Address" must not have storage\.collection/,
    );
  });

  it('throws when owner model does not exist', () => {
    const contract = createMongoContract({
      models: {
        Address: {
          fields: {
            street: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/string@1' },
            },
          },
          relations: {},
          storage: {},
          owner: 'NonExistent',
        },
      },
      storage: namespacedMongoStorageFromCollections({}),
    });
    expect(() => mongoEmission.validateStructure(contract)).toThrow(
      'declares owner "NonExistent" which does not exist',
    );
  });

  it('passes with valid owner/embedded model', () => {
    const contract = createMongoContract({
      models: {
        User: {
          fields: {
            _id: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
            },
          },
          relations: {
            addresses: { to: crossRef('Address'), cardinality: '1:N' },
          },
          storage: {
            collection: 'users',
            relations: { addresses: { field: 'addresses' } },
          },
        },
        Address: {
          fields: {
            street: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/string@1' },
            },
          },
          relations: {},
          storage: {},
          owner: 'User',
        },
      },
      storage: namespacedMongoStorageFromCollections({ users: {} }),
    });
    expect(() => mongoEmission.validateStructure(contract)).not.toThrow();
  });

  it('passes with polymorphic models sharing collection', () => {
    const contract = createMongoContract({
      models: {
        Task: {
          fields: {
            _id: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
            },
            type: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/string@1' },
            },
          },
          relations: {},
          storage: { collection: 'tasks' },
          discriminator: { field: 'type' },
          variants: { Bug: { value: 'bug' } },
        },
        Bug: {
          fields: {
            severity: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/string@1' },
            },
          },
          relations: {},
          storage: { collection: 'tasks' },
          base: crossRef('Task'),
        },
      },
      storage: namespacedMongoStorageFromCollections({ tasks: {} }),
    });
    expect(() => mongoEmission.validateStructure(contract)).not.toThrow();
  });

  it('throws when variant does not share base collection', () => {
    const contract = createMongoContract({
      models: {
        Task: {
          fields: {
            _id: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
            },
            type: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/string@1' },
            },
          },
          relations: {},
          storage: { collection: 'tasks' },
          discriminator: { field: 'type' },
          variants: { Bug: { value: 'bug' } },
        },
        Bug: {
          fields: {
            severity: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/string@1' },
            },
          },
          relations: {},
          storage: { collection: 'bugs' },
          base: crossRef('Task'),
        },
      },
      storage: namespacedMongoStorageFromCollections({ tasks: {}, bugs: {} }),
    });
    expect(() => mongoEmission.validateStructure(contract)).toThrow(
      "must share its base's collection",
    );
  });

  it('throws when model is missing storage', () => {
    const contract = createMongoContract({
      models: {
        User: blindCast<
          ContractModelBase,
          'intentionally missing "storage" to exercise validateStructure\'s runtime guard against malformed contracts'
        >({
          fields: {
            _id: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
            },
          },
          relations: {},
        }),
      },
      storage: namespacedMongoStorageFromCollections({ users: {} }),
    });
    expect(() => mongoEmission.validateStructure(contract)).toThrow(
      'missing required field "storage"',
    );
  });

  it('throws when base model does not exist', () => {
    const contract = createMongoContract({
      models: {
        Bug: {
          fields: {
            severity: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/string@1' },
            },
          },
          relations: {},
          storage: { collection: 'tasks' },
          base: crossRef('NonExistent'),
        },
      },
      storage: namespacedMongoStorageFromCollections({ tasks: {} }),
    });
    expect(() => mongoEmission.validateStructure(contract)).toThrow(
      /declares base "__unbound__:NonExistent" which does not exist/,
    );
  });

  it('throws when embed relation to owned model is missing storage.relations entry', () => {
    const contract = createMongoContract({
      models: {
        User: {
          fields: {
            _id: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
            },
          },
          relations: {
            addresses: { to: crossRef('Address'), cardinality: '1:N' },
          },
          storage: { collection: 'users' },
        },
        Address: {
          fields: {
            street: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/string@1' },
            },
          },
          relations: {},
          storage: {},
          owner: 'User',
        },
      },
      storage: namespacedMongoStorageFromCollections({ users: {} }),
    });
    expect(() => mongoEmission.validateStructure(contract)).toThrow(
      'embed relation "addresses" to owned model "Address" but no matching storage.relations entry',
    );
  });

  it('throws when storage.relations key has no matching domain-level relation', () => {
    const contract = createMongoContract({
      models: {
        User: {
          fields: {
            _id: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
            },
          },
          relations: {},
          storage: {
            collection: 'users',
            relations: { addresses: { field: 'addresses' } },
          },
        },
      },
      storage: namespacedMongoStorageFromCollections({ users: {} }),
    });
    expect(() => mongoEmission.validateStructure(contract)).toThrow(
      'storage.relations.addresses but no matching domain-level relation',
    );
  });
});
