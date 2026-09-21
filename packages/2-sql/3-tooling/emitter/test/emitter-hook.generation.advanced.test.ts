import type { ContractRelation } from '@internal/contract/types';
import { crossRef } from '@internal/contract/types';
import { generateContractDts } from '@internal/emitter';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { extractCodecTypeImports } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';

type TestDescriptor = TargetBoundComponentDescriptor<'sql', string>;

const testHashes = { storageHash: 'test-core-hash', profileHash: 'test-profile-hash' };

describe('sql-target-family-hook', () => {
  it('generates contract types with model relations', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
          },
          fields: {
            id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
          },
          relations: {
            posts: {
              to: crossRef('Post'),
              cardinality: '1:N',
              on: {
                localFields: ['id'],
                targetFields: ['userId'],
              },
            },
          },
        },
        Post: {
          storage: {
            table: 'post',
            fields: {
              id: { column: 'id' },
              userId: { column: 'userId' },
            },
          },
          fields: {
            id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
            userId: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain('relations: {');
    expect(types).toContain(
      'readonly posts: { readonly to: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "Post" }; readonly cardinality: "1:N"; readonly on: { readonly localFields: readonly ["id"]; readonly targetFields: readonly ["userId"] } }',
    );
  });

  it('generates contract types when models is an empty object', () => {
    const ir = createContract({
      models: {},
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).not.toContain('SqlMappings');
    expect(types).toContain('export type TypeMaps');
    expect(types).not.toContain('"__@internal/sql-contract/codecTypes@__"');
    expect(types).not.toContain('"__@internal/sql-contract/operationTypes@__"');
  });

  it('generates contract types with explicitly empty models and codecTypes', () => {
    const descriptors: TestDescriptor[] = [
      {
        kind: 'adapter',
        id: 'test-adapter',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@test/adapter/codec-types',
              named: 'CodecTypes',
              alias: 'TestTypes',
            },
          },
        },
      },
    ];

    const ir = createContract({
      models: {},
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const codecTypeImports = extractCodecTypeImports(descriptors);
    const types = generateContractDts(ir, sqlEmission, codecTypeImports, testHashes);
    expect(types).not.toContain('SqlMappings');
    expect(types).toContain('CodecTypes');
    expect(types).toContain('export type TypeMaps');
  });

  it('generates contract types with default models and codecTypes from descriptors', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const descriptors: TestDescriptor[] = [
      {
        kind: 'adapter',
        id: 'test-adapter',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@test/adapter/codec-types',
              named: 'CodecTypes',
              alias: 'TestTypes',
            },
          },
        },
      },
    ];

    const codecTypeImports = extractCodecTypeImports(descriptors);
    const types = generateContractDts(ir, sqlEmission, codecTypeImports, testHashes);
    expect(types).not.toContain('SqlMappings');
    expect(types).toContain('CodecTypes');
    expect(types).toContain('export type TypeMaps');
  });

  it('emits model relations on each model in Contract', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
          },
          fields: {
            id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
          },
          relations: {
            posts: {
              to: crossRef('Post'),
              cardinality: '1:N',
              on: {
                localFields: ['id'],
                targetFields: ['userId'],
              },
            },
            comments: {
              to: crossRef('Comment'),
              cardinality: '1:N',
              on: {
                localFields: ['id'],
                targetFields: ['authorId'],
              },
            },
          },
        },
        Post: {
          storage: {
            table: 'post',
            fields: {
              id: { column: 'id' },
              userId: { column: 'userId' },
            },
          },
          fields: {
            id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
            userId: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
          },
          relations: {},
        },
        Comment: {
          storage: {
            table: 'comment',
            fields: {
              id: { column: 'id' },
              authorId: { column: 'authorId' },
            },
          },
          fields: {
            id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
            authorId: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          comment: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              authorId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).not.toContain('export type Relations');
    expect(types).toContain(
      'readonly posts: { readonly to: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "Post" }; readonly cardinality: "1:N"; readonly on: { readonly localFields: readonly ["id"]; readonly targetFields: readonly ["userId"] } }',
    );
    expect(types).toContain(
      'readonly comments: { readonly to: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "Comment" }; readonly cardinality: "1:N"; readonly on: { readonly localFields: readonly ["id"]; readonly targetFields: readonly ["authorId"] } }',
    );
  });

  it('generates models with empty relations object when no relations', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
          },
          fields: {
            id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain('Record<string, never>');
  });

  it('generates models type from models and storage', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
              email: { column: 'email' },
              name: { column: 'name' },
            },
          },
          fields: {
            id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
            email: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
            name: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain('export type Contract');
    expect(types).toContain('readonly User: {');
    expect(types).toContain('storage: { readonly table: "user"');
    expect(types).toContain(
      'readonly id: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "pg/int4@1" } }',
    );
    expect(types).toContain(
      'readonly email: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "pg/text@1" } }',
    );
    expect(types).toContain(
      'readonly name: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "pg/text@1" } }',
    );
    expect(types).not.toContain('modelToTable');
    expect(types).not.toContain('fieldToColumn');
  });

  it('generates models type with multiple models', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
          },
          fields: {
            id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
          },
          relations: {},
        },
        Post: {
          storage: {
            table: 'post',
            fields: {
              id: { column: 'id' },
              userId: { column: 'userId' },
            },
          },
          fields: {
            id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
            userId: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain('readonly User: {');
    expect(types).toContain('readonly Post: {');
    expect(types).toContain('readonly table: "user"');
    expect(types).toContain('readonly table: "post"');
    expect(types).not.toContain('modelToTable');
  });

  it('uses Record<string, never> for models when IR has no models', () => {
    const ir = createContract({
      models: undefined,
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).not.toContain('SqlMappings');
    expect(types).toContain('storageHash: StorageHash');
  });

  it('generates models type with relation missing on property', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {},
          },
          fields: {},
          relations: {
            partialRel: { to: crossRef('Post') } as unknown as ContractRelation,
          },
        },
        Post: {
          storage: {
            table: 'post',
            fields: {},
          },
          fields: {},
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {},
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {},
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain(
      'readonly partialRel: { readonly to: { readonly namespace: "__unbound__" & NamespaceId; readonly model: "Post" } }',
    );
  });

  it('generates models with empty fields object when model has no fields', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: {},
          },
          fields: {},
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain('readonly User: {');
    expect(types).toContain('storage: { readonly table: "user"');
    expect(types).toContain('readonly fields: Record<string, never>');
    expect(types).not.toContain('fieldToColumn');
    expect(types).not.toContain('columnToField');
  });

  it('gets types imports with multiple extensions', () => {
    const descriptors: TestDescriptor[] = [
      {
        kind: 'adapter',
        id: 'test-adapter',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@test/adapter/codec-types',
              named: 'CodecTypes',
              alias: 'TestTypes',
            },
          },
        },
      },
      {
        kind: 'extension',
        id: 'test-extension',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@test/extension/codec-types',
              named: 'CodecTypes',
              alias: 'ExtensionTypes',
            },
          },
        },
      },
    ];

    const codecImports = extractCodecTypeImports(descriptors);
    expect(codecImports.length).toBe(2);
    expect(codecImports[0]?.package).toBe('@test/adapter/codec-types');
    expect(codecImports[1]?.package).toBe('@test/extension/codec-types');
  });

  it('gets types imports with descriptors without codecTypes', () => {
    const descriptors: TestDescriptor[] = [
      {
        kind: 'adapter',
        id: 'test-adapter',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
      },
    ];

    const codecImports = extractCodecTypeImports(descriptors);
    expect(codecImports.length).toBe(0);
  });

  it('gets types imports using extractCodecTypeImports', () => {
    const descriptors: TestDescriptor[] = [
      {
        kind: 'adapter',
        id: 'test-adapter',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@test/adapter/codec-types',
              named: 'CodecTypes',
              alias: 'TestTypes',
            },
          },
        },
      },
    ];

    const codecImports = extractCodecTypeImports(descriptors);
    expect(codecImports).toEqual([
      { package: '@test/adapter/codec-types', named: 'CodecTypes', alias: 'TestTypes' },
    ]);
  });

  it('generates model storage type via generateModelStorageType', () => {
    const model = {
      storage: {
        table: 'user',
        fields: {
          id: { column: 'id' },
          email: { column: 'email' },
        },
      },
      fields: {},
      relations: {},
    };

    const result = sqlEmission.generateModelStorageType('User', model);
    expect(result).toContain('readonly table: "user"');
    expect(result).toContain('readonly id: { readonly column: "id" }');
    expect(result).toContain('readonly email: { readonly column: "email" }');
  });

  it('includes owner field in model type when present', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            table: 'user',
            fields: { id: { column: 'id' } },
          },
          fields: {
            id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
          },
          relations: {},
          owner: 'system',
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain('readonly owner: "system"');
  });
});
