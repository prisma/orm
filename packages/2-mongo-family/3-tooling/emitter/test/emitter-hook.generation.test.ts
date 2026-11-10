import { crossRef } from '@internal/contract/types';
import { generateContractDts } from '@internal/emitter';
import type { TypesImportSpec } from '@internal/framework-components/emission';
import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import { describe, expect, it } from 'vitest';
import { mongoEmission } from '../src/index';
import {
  createMongoContract,
  namespacedMongoStorageFromCollections,
} from './fixtures/create-mongo-contract';

const testHashes = { storageHash: 'test-storage-hash', profileHash: 'test-profile-hash' };

describe('mongoEmission.generateContractTypes', () => {
  it('generates Contract and TypeMaps exports', () => {
    const contract = createMongoContract();
    const types = generateContractDts(contract, mongoEmission, [], testHashes);
    expect(types).toContain(
      'export type Contract = MongoContractWithTypeMaps<ContractBase, TypeMaps>',
    );
    expect(types).toContain(
      'export type TypeMaps = MongoTypeMaps<CodecTypes, FieldOutputTypes, FieldInputTypes>',
    );
  });

  it('generates hash type aliases', () => {
    const contract = createMongoContract();
    const types = generateContractDts(contract, mongoEmission, [], testHashes);
    expect(types).toContain('StorageHashBase<"test-storage-hash">');
    expect(types).toContain('ProfileHashBase<"test-profile-hash">');
  });

  it('generates concrete execution hash when provided', () => {
    const contract = createMongoContract();
    const types = generateContractDts(contract, mongoEmission, [], {
      ...testHashes,
      executionHash: 'test-exec-hash',
    });
    expect(types).toContain('ExecutionHashBase<"test-exec-hash">');
  });

  it('generates generic execution hash when not provided', () => {
    const contract = createMongoContract();
    const types = generateContractDts(contract, mongoEmission, [], testHashes);
    expect(types).toContain('ExecutionHashBase<string>');
  });

  it('includes framework imports', () => {
    const contract = createMongoContract();
    const types = generateContractDts(contract, mongoEmission, [], testHashes);
    expect(types).toContain("from '@internal/mongo-contract'");
    expect(types).toContain("from '@internal/contract/types'");
    expect(types).toContain('MongoContractWithTypeMaps');
    expect(types).toContain('MongoTypeMaps');
    expect(types).toContain('StorageHashBase');
    expect(types).toContain('ProfileHashBase');
    expect(types).toContain('ExecutionHashBase');
  });

  it('generates codec type imports and intersection', () => {
    const contract = createMongoContract();
    const codecImports: TypesImportSpec[] = [
      {
        package: '@internal/target-mongo/codec-types',
        named: 'CodecTypes',
        alias: 'MongoCodecTypes',
      },
    ];
    const types = generateContractDts(contract, mongoEmission, codecImports, testHashes);
    expect(types).toContain(
      "import type { CodecTypes as MongoCodecTypes } from '@internal/target-mongo/codec-types'",
    );
    expect(types).toContain('export type CodecTypes = MongoCodecTypes');
  });

  it('generates empty CodecTypes when no codec imports', () => {
    const contract = createMongoContract();
    const types = generateContractDts(contract, mongoEmission, [], testHashes);
    expect(types).toContain('export type CodecTypes = Record<string, never>');
  });

  it('generates contract header fields', () => {
    const contract = createMongoContract();
    const types = generateContractDts(contract, mongoEmission, [], testHashes);
    expect(types).toContain('readonly target: "mongo"');
    expect(types).not.toContain('schemaVersion');
    expect(types).toContain('readonly profileHash: ProfileHash');
  });

  it('generates roots type', () => {
    const contract = createMongoContract({
      roots: { users: crossRef('User'), posts: crossRef('Post') },
    });
    const types = generateContractDts(contract, mongoEmission, [], testHashes);
    expect(types).toContain(
      'readonly users: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "User" }',
    );
    expect(types).toContain(
      'readonly posts: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "Post" }',
    );
  });

  describe('model generation', () => {
    it('generates model domain fields with scalar type and nullable', () => {
      const contract = createMongoContract({
        models: {
          User: {
            fields: {
              _id: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
              },
              name: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
              },
              bio: {
                nullable: true,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
              },
            },
            relations: {},
            storage: {
              fields: { _id: { field: '_id' }, name: { field: 'name' }, bio: { field: 'bio' } },
              collection: 'users',
            },
          },
        },
        storage: namespacedMongoStorageFromCollections({ users: {} }),
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain(
        'readonly _id: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "mongo/objectId@1" } }',
      );
      expect(types).toContain(
        'readonly name: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "mongo/string@1" } }',
      );
      expect(types).toContain(
        'readonly bio: { readonly nullable: true; readonly type: { readonly kind: "scalar"; readonly codecId: "mongo/string@1" } }',
      );
    });

    it('emits mixed scalar-list outer and element nullability exactly', () => {
      const contract = createMongoContract({
        models: {
          Lists: {
            fields: {
              nullableElements: {
                nullable: false,
                many: { elementNullable: true },
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
              },
              nullableList: {
                nullable: true,
                many: { elementNullable: false },
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
              },
            },
            relations: {},
            storage: {
              fields: {
                nullableElements: { field: 'nullableElements' },
                nullableList: { field: 'nullableList' },
              },
              collection: 'lists',
            },
          },
        },
        storage: namespacedMongoStorageFromCollections({ lists: {} }),
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain(
        'readonly nullableElements: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "mongo/string@1" }; readonly many: { readonly elementNullable: true } }',
      );
      expect(types).toContain(
        'readonly nullableList: { readonly nullable: true; readonly type: { readonly kind: "scalar"; readonly codecId: "mongo/string@1" }; readonly many: { readonly elementNullable: false } }',
      );
    });

    it('generates model relations without strategy', () => {
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
              posts: {
                to: crossRef('Post'),
                cardinality: '1:N',
                on: { localFields: ['_id'], targetFields: ['authorId'] },
              },
            },
            storage: { fields: { _id: { field: '_id' } }, collection: 'users' },
          },
          Post: {
            fields: {
              _id: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
              },
              authorId: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
              },
            },
            relations: {
              author: {
                to: crossRef('User'),
                cardinality: 'N:1',
                nullable: false,
                on: { localFields: ['authorId'], targetFields: ['_id'] },
              },
            },
            storage: {
              fields: { _id: { field: '_id' }, authorId: { field: 'authorId' } },
              collection: 'posts',
            },
          },
        },
        storage: namespacedMongoStorageFromCollections({ users: {}, posts: {} }),
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain(
        'readonly to: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "Post" }',
      );
      expect(types).toContain('readonly cardinality: "1:N"');
      expect(types).toContain('readonly localFields: readonly ["_id"]');
      expect(types).toContain('readonly targetFields: readonly ["authorId"]');
      expect(types).not.toContain('strategy');
    });

    it('generates root model storage with collection', () => {
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
            storage: { fields: { _id: { field: '_id' } }, collection: 'users' },
          },
        },
        storage: namespacedMongoStorageFromCollections({ users: {} }),
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain('readonly collection: "users"');
    });

    it('generates the stored name of each field', () => {
      const contract = createMongoContract({
        models: {
          User: {
            fields: {
              id: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
              },
              displayName: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
              },
            },
            relations: {},
            storage: {
              collection: 'users',
              fields: { id: { field: '_id' }, displayName: { field: 'display_name' } },
            },
          },
        },
        storage: namespacedMongoStorageFromCollections({ users: {} }),
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain(
        'readonly storage: { readonly collection: "users"; readonly fields: { readonly id: { readonly field: "_id" }; readonly displayName: { readonly field: "display_name" } } }',
      );
    });

    it('generates embedded model storage as empty record', () => {
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
              fields: { _id: { field: '_id' } },
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
            storage: { fields: { street: { field: 'street' } } },
            owner: 'User',
          },
        },
        storage: namespacedMongoStorageFromCollections({ users: {} }),
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain('readonly Address: { readonly fields:');
      expect(types).toContain('readonly owner: "User"');
    });

    it('generates model with owner field', () => {
      const contract = createMongoContract({
        models: {
          Post: {
            fields: {
              _id: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
              },
            },
            relations: {
              comments: { to: crossRef('Comment'), cardinality: '1:N' },
            },
            storage: { fields: { _id: { field: '_id' } }, collection: 'posts' },
          },
          Comment: {
            fields: {
              text: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
              },
            },
            relations: {},
            storage: { fields: { text: { field: 'text' } } },
            owner: 'Post',
          },
        },
        storage: namespacedMongoStorageFromCollections({ posts: {} }),
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain('readonly owner: "Post"');
    });

    it('generates polymorphic model with discriminator and variants', () => {
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
            storage: {
              fields: { _id: { field: '_id' }, type: { field: 'type' } },
              collection: 'tasks',
            },
            discriminator: { field: 'type' },
            variants: { bug: crossRef('Bug'), feature: crossRef('Feature') },
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
            storage: { fields: { severity: { field: 'severity' } }, collection: 'tasks' },
            base: crossRef('Task'),
          },
          Feature: {
            fields: {
              priority: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
              },
            },
            relations: {},
            storage: { fields: { priority: { field: 'priority' } }, collection: 'tasks' },
            base: crossRef('Task'),
          },
        },
        storage: namespacedMongoStorageFromCollections({ tasks: {} }),
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain('discriminator: { readonly field: "type" }');
      expect(types).toContain(
        'readonly bug: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "Bug" }',
      );
      expect(types).toContain(
        'readonly feature: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "Feature" }',
      );
      expect(types).toContain(
        'base: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "Task" }',
      );
    });

    it('generates storage.relations on parent model', () => {
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
              fields: { _id: { field: '_id' } },
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
            storage: { fields: { street: { field: 'street' } } },
            owner: 'User',
          },
        },
        storage: namespacedMongoStorageFromCollections({ users: {} }),
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain(
        'readonly relations: { readonly addresses: { readonly field: "addresses" } }',
      );
    });
  });

  describe('storage generation', () => {
    it('generates storage with namespaces and collections', () => {
      const contract = createMongoContract({
        storage: namespacedMongoStorageFromCollections({ users: {}, posts: {} }),
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain('readonly namespaces:');
      expect(types).toContain('readonly entries:');
      expect(types).toContain('readonly collection:');
      expect(types).toContain('readonly users: MongoCollection');
      expect(types).toContain('readonly posts: MongoCollection');
    });

    it('generates collection metadata for indexes and options', () => {
      const contract = createMongoContract({
        storage: namespacedMongoStorageFromCollections({
          users: {
            indexes: [{ fields: { email: 1 }, options: { unique: true } }],
            options: {
              collation: { locale: 'en', strength: 2 },
            },
          },
        }),
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain('readonly users: { readonly indexes:');
      expect(types).toContain('readonly fields: { readonly email: 1 }');
      expect(types).toContain('readonly options: { readonly unique: true }');
      expect(types).toContain(
        'readonly collation: { readonly locale: "en"; readonly strength: 2 }',
      );
    });

    it('generates empty collections map under the default namespace', () => {
      const contract = createMongoContract({ storage: namespacedMongoStorageFromCollections({}) });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain('readonly entries:');
      expect(types).toContain('readonly collection: Record<string, never>');
    });
  });

  describe('value object type generation', () => {
    it('emits split value object type aliases (Output and Input)', () => {
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
            storage: { fields: { _id: { field: '_id' } }, collection: 'users' },
          },
        },
        valueObjects: {
          Address: {
            fields: {
              street: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
              },
              city: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
              },
            },
          },
        },
        storage: namespacedMongoStorageFromCollections({ users: {} }),
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain('export type AddressOutput =');
      expect(types).toContain('export type AddressInput =');
      expect(types).not.toMatch(/export type Address =/);
    });

    it('emits value objects in the storage namespace entries, and nowhere else', () => {
      const contract = createMongoContract({
        valueObjects: {
          Address: {
            fields: {
              street: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
              },
            },
          },
        },
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain(
        'readonly entries: { readonly collection: Record<string, never>; readonly valueObject: { readonly Address: { readonly fields: { readonly street: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "mongo/string@1" } } } } } }',
      );
      expect(types).not.toContain('readonly valueObjects:');
    });

    it('emits model field with valueObject kind', () => {
      const contract = createMongoContract({
        models: {
          User: {
            fields: {
              _id: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
              },
              homeAddress: {
                nullable: true,
                many: false,
                type: {
                  kind: 'valueObject',
                  plane: 'storage',
                  namespaceId: '__unbound__',
                  entityKind: 'valueObject',
                  entityName: 'Address',
                },
              },
            },
            relations: {},
            storage: {
              fields: { _id: { field: '_id' }, homeAddress: { field: 'homeAddress' } },
              collection: 'users',
            },
          },
        },
        valueObjects: {
          Address: {
            fields: {
              street: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
              },
            },
          },
        },
        storage: namespacedMongoStorageFromCollections({ users: {} }),
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain(
        'readonly homeAddress: { readonly nullable: true; readonly type: { readonly kind: "valueObject"; readonly plane: "storage"; readonly namespaceId: "__unbound__"; readonly entityKind: "valueObject"; readonly entityName: "Address" } }',
      );
    });

    it('handles list value object model fields', () => {
      const contract = createMongoContract({
        models: {
          User: {
            fields: {
              _id: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
              },
              previousAddresses: {
                nullable: false,
                type: {
                  kind: 'valueObject',
                  plane: 'storage',
                  namespaceId: '__unbound__',
                  entityKind: 'valueObject',
                  entityName: 'Address',
                },
                many: { elementNullable: false },
              },
            },
            relations: {},
            storage: {
              fields: { _id: { field: '_id' }, previousAddresses: { field: 'previousAddresses' } },
              collection: 'users',
            },
          },
        },
        valueObjects: {
          Address: {
            fields: {
              street: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
              },
            },
          },
        },
        storage: namespacedMongoStorageFromCollections({ users: {} }),
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain(
        'readonly previousAddresses: { readonly nullable: false; readonly type: { readonly kind: "valueObject"; readonly plane: "storage"; readonly namespaceId: "__unbound__"; readonly entityKind: "valueObject"; readonly entityName: "Address" }; readonly many: { readonly elementNullable: false } }',
      );
    });

    it('handles self-referencing value object type alias', () => {
      const contract = createMongoContract({
        valueObjects: {
          NavItem: {
            fields: {
              label: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
              },
              children: {
                nullable: false,
                type: {
                  kind: 'valueObject',
                  plane: 'storage',
                  namespaceId: '__unbound__',
                  entityKind: 'valueObject',
                  entityName: 'NavItem',
                },
                many: { elementNullable: false },
              },
            },
          },
        },
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain('export type NavItemOutput =');
      expect(types).toContain('export type NavItemInput =');
      expect(types).toContain(
        'export type NavItemOutput = ValueObjectOutputTypes["__unbound__"]["NavItem"];',
      );
      expect(types).toContain(
        'readonly children: { readonly nullable: false; readonly type: { readonly kind: "valueObject"; readonly plane: "storage"; readonly namespaceId: "__unbound__"; readonly entityKind: "valueObject"; readonly entityName: "NavItem" }; readonly many: { readonly elementNullable: false } }',
      );
    });

    it('omits value objects when none exist', () => {
      const contract = createMongoContract();
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).not.toMatch(/valueObject/i);
    });

    it('types an enum member of a value object by the storage value set it names', () => {
      const storage = namespacedMongoStorageFromCollections({});
      const contract = createMongoContract({
        storage: {
          ...storage,
          namespaces: {
            __unbound__: {
              id: '__unbound__',
              entries: {
                collection: {},
                valueSet: { Kind: { kind: 'valueSet', values: ['home', 'work'] } },
              },
            },
          },
        },
        valueObjects: {
          Address: {
            fields: {
              kind: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                valueSet: {
                  plane: 'storage',
                  entityKind: 'valueSet',
                  namespaceId: '__unbound__',
                  entityName: 'Kind',
                },
              },
            },
          },
        },
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes, undefined, {
        get: () => undefined,
        renderOutputTypeFor: () => undefined,
        renderValueLiteralFor: (_id, value) =>
          typeof value === 'string' ? JSON.stringify(value) : undefined,
      });
      expect(types).toContain(
        'type FieldTypeOverrides = { readonly __unbound__: { readonly valueObjects: { readonly Address: { readonly kind: { readonly output: "home" | "work"; readonly input: "home" | "work" } } } } };',
      );
    });

    it('emits nullable value object type alias field', () => {
      const contract = createMongoContract({
        valueObjects: {
          Address: {
            fields: {
              zip: {
                nullable: true,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
              },
            },
          },
        },
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain(
        'readonly zip: { readonly nullable: true; readonly type: { readonly kind: "scalar"; readonly codecId: "mongo/string@1" } }',
      );
      expect(types).toContain(
        'export type AddressOutput = ValueObjectOutputTypes["__unbound__"]["Address"];',
      );
    });

    it('emits FieldInputTypes alongside FieldOutputTypes', () => {
      const contract = createMongoContract({
        models: {
          User: {
            fields: {
              _id: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
              },
              name: {
                nullable: false,
                many: false,
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
              },
            },
            relations: {},
            storage: {
              fields: { _id: { field: '_id' }, name: { field: 'name' } },
              collection: 'users',
            },
          },
        },
        storage: namespacedMongoStorageFromCollections({ users: {} }),
      });
      const types = generateContractDts(contract, mongoEmission, [], testHashes);
      expect(types).toContain(
        "export type FieldOutputTypes = FieldTypesFromDomain<ContractBase['domain']['namespaces'], CodecTypes, ParameterizedOutputTypeFunctions, FieldTypeOverrides, \"output\", ContractBase['storage']['namespaces']>;",
      );
      expect(types).toContain(
        "export type FieldInputTypes = FieldTypesFromDomain<ContractBase['domain']['namespaces'], CodecTypes, ParameterizedOutputTypeFunctions, FieldTypeOverrides, \"input\", ContractBase['storage']['namespaces']>;",
      );
    });
  });
});

describe('mongoEmission.getFamilyImports', () => {
  it('imports RelationKeys from the family contract entrypoint', () => {
    expect(mongoEmission.getFamilyImports(keepInternalSpecifiers).join('\n')).toContain(
      'RelationKeys,',
    );
  });
});
