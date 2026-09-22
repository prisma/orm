import type { ExecutionHashBase } from '@internal/contract/types';
import { generateContractDts } from '@internal/emitter';
import type {
  ControlAdapterDescriptor,
  ControlExtensionDescriptor,
  ControlTargetDescriptor,
} from '@internal/framework-components/control';
import { extractCodecTypeImports } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';

type TestDescriptor =
  | ControlTargetDescriptor<'sql', string>
  | ControlAdapterDescriptor<'sql', string>
  | ControlExtensionDescriptor<'sql', string>;

const testHashes = { storageHash: 'test-core-hash', profileHash: 'test-profile-hash' };

describe('sql-target-family-hook', () => {
  it('generates contract types', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            namespaceId: '__unbound__',
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
          },
          fields: {
            id: { nullable: false, type: { kind: 'scalar', codecId: 'sql/int@1' } },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'sql/int@1', nullable: false },
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
    expect(types).toContain('CodecTypes');
    expect(types).toContain('readonly roots:');
  });

  describe('Contract and TypeMaps shape', () => {
    it('emits TypeMaps as separate export', () => {
      const ir = createContract({
        models: {
          User: {
            storage: {
              namespaceId: '__unbound__',
              table: 'user',
              fields: { id: { column: 'id' } },
            },
            fields: {
              id: { nullable: false, type: { kind: 'scalar', codecId: 'sql/int@1' } },
            },
            relations: {},
          },
        },
        storage: {
          tables: {
            user: {
              columns: {
                id: { nativeType: 'int4', codecId: 'sql/int@1', nullable: false },
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
      expect(types).toContain('export type TypeMaps = TypeMapsType<');
      expect(types).toContain('StorageColumnTypes');
      expect(types).toContain('StorageColumnInputTypes');
    });

    it('TypeMaps delegates to TypeMapsType with CodecTypes', () => {
      const ir = createContract({
        models: {},
        storage: { tables: {} },
      });
      const types = generateContractDts(ir, sqlEmission, [], testHashes);
      expect(types).toContain('TypeMapsType<');
      expect(types).toContain('CodecTypes');
      expect(types).toContain('QueryOperationTypes');
      expect(types).toContain('FieldOutputTypes');
      expect(types).toContain('FieldInputTypes');
    });

    it('Contract does not include phantom codecTypes keys', () => {
      const ir = createContract({
        models: {
          User: {
            storage: {
              namespaceId: '__unbound__',
              table: 'user',
              fields: { id: { column: 'id' } },
            },
            fields: {
              id: { nullable: false, type: { kind: 'scalar', codecId: 'sql/int@1' } },
            },
            relations: {},
          },
        },
        storage: {
          tables: {
            user: {
              columns: {
                id: { nativeType: 'int4', codecId: 'sql/int@1', nullable: false },
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
      expect(types).not.toContain('"__@internal/sql-contract/codecTypes@__"');
      expect(types).not.toContain('"__@internal/sql-contract/operationTypes@__"');
      expect(types).not.toContain('"__@internal/sql-contract/typeMaps@__"');
    });
  });

  it('generates contract types with correct import path', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            namespaceId: '__unbound__',
            table: 'user',
            fields: {
              id: { column: 'id' },
            },
          },
          fields: {
            id: { nullable: false, type: { kind: 'scalar', codecId: 'sql/int@1' } },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'sql/int@1', nullable: false },
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
    expect(types).toContain('Contract as ContractType,');
    expect(types).toContain('ContractWithTypeMaps,');
    expect(types).toContain('TypeMaps as TypeMapsType,');
    expect(types).toContain("from '@internal/sql-contract/types';");
    expect(types).not.toContain('from "./contract-types"');
  });

  it('gets types imports', () => {
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
        create() {
          return {
            familyId: 'sql' as const,
            targetId: 'postgres' as const,
          };
        },
      },
    ];

    const codecImports = extractCodecTypeImports(descriptors);
    expect(codecImports).toEqual([
      {
        package: '@test/adapter/codec-types',
        named: 'CodecTypes',
        alias: 'TestTypes',
      },
    ]);
  });

  it('generates contract types with multiple extensions', () => {
    const ir = createContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
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
        id: 'postgres',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@internal/target-postgres/codec-types',
              named: 'CodecTypes',
              alias: 'PgTypes',
            },
          },
        },
        create() {
          return {
            familyId: 'sql' as const,
            targetId: 'postgres' as const,
          };
        },
      },
      {
        kind: 'extension',
        id: 'pgvector',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        types: {
          codecTypes: {
            import: {
              package: '@internal/pgvector/codec-types',
              named: 'CodecTypes',
              alias: 'VectorTypes',
            },
          },
        },
        create() {
          return {
            familyId: 'sql' as const,
            targetId: 'postgres' as const,
          };
        },
      },
    ];

    const codecTypeImports = extractCodecTypeImports(descriptors);
    expect(codecTypeImports).toEqual([
      {
        package: '@internal/target-postgres/codec-types',
        named: 'CodecTypes',
        alias: 'PgTypes',
      },
      { package: '@internal/pgvector/codec-types', named: 'CodecTypes', alias: 'VectorTypes' },
    ]);
    const types = generateContractDts(ir, sqlEmission, codecTypeImports, testHashes);
    expect(types).toContain('PgTypes');
    expect(types).toContain('VectorTypes');
  });

  it('generates contract types with uniques in storage', () => {
    const ir = createContract({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [{ columns: ['email'] }],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain('uniques: readonly');
    expect(types).toContain('readonly columns: readonly ["email"]');
  });

  it('generates contract types with uniques with names in storage', () => {
    const ir = createContract({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [{ columns: ['email'], name: 'unique_email' }],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain('uniques: readonly');
    expect(types).toContain('readonly name: "unique_email"');
  });

  it('generates contract types with composite uniques in storage', () => {
    const ir = createContract({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              first_name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              last_name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [{ columns: ['first_name', 'last_name'] }],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain('uniques: readonly');
    expect(types).toContain('readonly columns: readonly ["first_name", "last_name"]');
  });

  it('generates contract types with indexes in storage', () => {
    const ir = createContract({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [
              {
                name: 'user_email_idx_46df9cad',
                prefix: 'user_email_idx',
                columns: ['email'],
                unique: false,
              },
            ],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain(
      'indexes: readonly [{ readonly name: "user_email_idx_46df9cad"; readonly prefix: "user_email_idx"; readonly columns: readonly ["email"]; readonly unique: false }]',
    );
  });

  it('generates contract types with an expression index in storage', () => {
    const ir = createContract({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [
              {
                name: 'users_email_eq',
                expression: 'lower(email)',
                where: 'deleted_at IS NULL',
                unique: true,
              },
            ],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain(
      'indexes: readonly [{ readonly name: "users_email_eq"; readonly expression: "lower(email)"; readonly where: "deleted_at IS NULL"; readonly unique: true }]',
    );
  });

  it('generates contract types with indexes with names in storage', () => {
    const ir = createContract({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [{ columns: ['email'], name: 'idx_email', unique: false }],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain(
      'indexes: readonly [{ readonly name: "idx_email"; readonly columns: readonly ["email"]; readonly unique: false }]',
    );
  });

  it('generates contract types with foreignKeys in storage', () => {
    const ir = createContract({
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
          post: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                source: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'post',
                  columns: ['userId'],
                },

                target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
              },
            ],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain('foreignKeys: readonly');
    expect(types).toContain('readonly columns: readonly ["userId"]');
    expect(types).toContain('readonly tableName: "user"');
    expect(types).toContain('readonly columns: readonly ["id"]');
  });

  it('generates contract types with foreignKeys with names in storage', () => {
    const ir = createContract({
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
          post: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                source: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'post',
                  columns: ['userId'],
                },

                target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
                name: 'fk_post_user',
              },
            ],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain('foreignKeys: readonly');
    expect(types).toContain('readonly name: "fk_post_user"');
  });

  it('generates contract types with primaryKey with name in storage', () => {
    const ir = createContract({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'], name: 'pk_user' },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain('readonly name: "pk_user"');
  });

  it('generates contract types with nullable columns', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            namespaceId: '__unbound__',
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
            name: { nullable: true, type: { kind: 'scalar', codecId: 'pg/text@1' } },
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
              name: { nativeType: 'text', codecId: 'pg/text@1', nullable: true },
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
    expect(types).toContain(
      'readonly name: { readonly nullable: true; readonly type: { readonly kind: "scalar"; readonly codecId: "pg/text@1" } }',
    );
    expect(types).toContain(
      'readonly email: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "pg/text@1" } }',
    );
  });

  it('generates contract types with model field missing column reference', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            namespaceId: '__unbound__',
            table: 'user',
            fields: {
              id: { column: 'id' },
              email: { column: 'nonexistent' },
            },
          },
          fields: {
            id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
            email: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
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
    expect(types).toContain(
      'readonly email: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "pg/text@1" } }',
    );
  });

  it('generates contract types with model referencing missing table', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            namespaceId: '__unbound__',
            table: 'nonexistent',
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
    expect(types).toContain(
      'readonly id: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "pg/int4@1" } }',
    );
  });

  it('generates contract types with undefined models', () => {
    const ir = createContract({
      models: undefined,
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
    expect(types).not.toContain('SqlMappings');
  });

  it('generates contract types with column nullable undefined defaults to false', () => {
    const ir = createContract({
      models: {
        User: {
          storage: {
            namespaceId: '__unbound__',
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
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: undefined as unknown as boolean,
              },
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
    expect(types).toContain(
      'readonly id: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "pg/int4@1" } }',
    );
    expect(types).not.toContain(
      'readonly id: { readonly nullable: true; readonly type: { readonly kind: "scalar"; readonly codecId: "pg/int4@1" } }',
    );
  });

  it('emits ContractField descriptor for columns with typeParams', () => {
    const ir = createContract({
      models: {
        Embedding: {
          storage: {
            namespaceId: '__unbound__',
            table: 'embedding',
            fields: {
              vector: { column: 'vector' },
            },
          },
          fields: {
            vector: {
              nullable: false,
              type: { kind: 'scalar', codecId: 'pg/vector@1', typeParams: { length: 1536 } },
            },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          embedding: {
            columns: {
              vector: {
                nativeType: 'vector',
                codecId: 'pg/vector@1',
                nullable: false,
                typeParams: { length: 1536 },
              },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);

    expect(types).toContain(
      'readonly vector: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "pg/vector@1"; readonly typeParams: { readonly length: 1536 } } }',
    );
    expect(types).not.toContain('Vector<1536>');
  });

  it('generates contract types with query operation type imports', () => {
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

    const queryOperationTypeImports = [
      { package: '@test/query-ops', named: 'QueryOperationTypes', alias: 'TestQueryOps' },
      { package: '@test/other', named: 'OtherTypes', alias: 'Other' },
    ];

    const types = generateContractDts(ir, sqlEmission, [], testHashes, {
      queryOperationTypeImports,
    });
    expect(types).toContain('export type QueryOperationTypes = TestQueryOps');
    expect(types).not.toContain('export type QueryOperationTypes = TestQueryOps & Other');
  });

  it('generates contract types with extension-owned index config in storage', () => {
    const ir = createContract({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          items: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              description: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [
              {
                columns: ['description'],
                type: 'bm25',
                name: 'search_idx',
                options: {
                  keyField: 'id',
                  fields: [
                    {
                      column: 'description',
                      tokenizer: 'simple',
                      tokenizerParams: { stemmer: 'english' },
                    },
                  ],
                },
              },
            ],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain('readonly type: "bm25"');
    expect(types).toContain('readonly keyField: "id"');
    expect(types).toContain('readonly name: "search_idx"');
    expect(types).toContain('readonly column: "description"');
    expect(types).toContain('readonly tokenizer: "simple"');
    expect(types).toContain('readonly stemmer: "english"');
  });

  it('generates contract types with expression entries in extension config', () => {
    const ir = createContract({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          items: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              description: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [
              {
                columns: ['description'],
                type: 'bm25',
                options: {
                  keyField: 'id',
                  fields: [
                    {
                      expression: "description || ' ' || category",
                      alias: 'concat',
                      tokenizer: 'simple',
                    },
                  ],
                },
              },
            ],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain(`readonly expression: "description || ' ' || category"`);
    expect(types).toContain('readonly alias: "concat"');
  });

  it('quotes non-identifier keys in extension index config', () => {
    const ir = createContract({
      targetFamily: 'sql',
      target: 'test-db',
      storage: {
        tables: {
          items: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
              description: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [
              {
                columns: ['description'],
                type: 'bm25',
                options: {
                  keyField: 'id',
                  'min-token-size': 2,
                  fields: [{ column: 'description', tokenizerParams: { 'max-ngram': 5 } }],
                },
              },
            ],
            foreignKeys: [],
          },
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).toContain('readonly "min-token-size": 2');
    expect(types).toContain('readonly "max-ngram": 5');
  });

  it('includes execution section in ContractBase when IR has execution defaults', () => {
    const ir = createContract({
      models: {
        Tag: {
          storage: {
            namespaceId: '__unbound__',
            table: 'tags',
            fields: { id: { column: 'id' }, name: { column: 'name' } },
          },
          fields: {
            id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
            name: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          tags: {
            columns: {
              id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
      execution: {
        executionHash: 'test-exec-hash' as ExecutionHashBase<string>,
        mutations: {
          defaults: [
            {
              ref: { namespace: 'public', table: 'tags', column: 'id' },
              onCreate: { kind: 'generator', id: 'uuidv4' },
            },
          ],
        },
      },
    });

    const types = generateContractDts(ir, sqlEmission, [], {
      ...testHashes,
      executionHash: 'test-exec-hash',
    });
    expect(types).toContain('readonly execution:');
    expect(types).toContain('readonly table: "tags"');
    expect(types).toContain('readonly column: "id"');
    expect(types).toContain('readonly kind: "generator"');
    expect(types).toContain('readonly id: "uuidv4"');
  });

  it('omits execution field when IR has no execution', () => {
    const ir = createContract({
      storage: { tables: {} },
    });

    const types = generateContractDts(ir, sqlEmission, [], testHashes);
    expect(types).not.toContain('readonly execution');
  });

  describe('value object type generation', () => {
    it('emits named value object type aliases', () => {
      const ir = createContract({
        models: {
          User: {
            storage: {
              namespaceId: '__unbound__',
              table: 'user',
              fields: { id: { column: 'id' } },
            },
            fields: {
              id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
            },
            relations: {},
          },
        },
        valueObjects: {
          Address: {
            fields: {
              street: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
              city: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
            },
          },
        },
        storage: {
          tables: {
            user: {
              columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      });
      const types = generateContractDts(ir, sqlEmission, [], testHashes);
      expect(types).toContain('export type AddressOutput =');
      expect(types).toContain('export type AddressInput =');
      expect(types).not.toMatch(/export type Address =/);
      expect(types).toContain('readonly street: CodecTypes["pg/text@1"]["output"]');
      expect(types).toContain('readonly city: CodecTypes["pg/text@1"]["output"]');
    });

    it('emits valueObjects descriptor on ContractBase', () => {
      const ir = createContract({
        valueObjects: {
          Address: {
            fields: {
              street: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
            },
          },
        },
        storage: { tables: {} },
      });
      const types = generateContractDts(ir, sqlEmission, [], testHashes);
      expect(types).toContain('readonly valueObjects:');
      expect(types).toContain('readonly Address: { readonly fields:');
    });

    it('emits model fields referencing value objects with valueObject kind', () => {
      const ir = createContract({
        models: {
          User: {
            storage: {
              namespaceId: '__unbound__',
              table: 'user',
              fields: {
                id: { column: 'id' },
                homeAddress: { column: 'home_address' },
              },
            },
            fields: {
              id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
              homeAddress: {
                nullable: true,
                type: { kind: 'valueObject', name: 'Address' },
              },
            },
            relations: {},
          },
        },
        valueObjects: {
          Address: {
            fields: {
              street: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
            },
          },
        },
        storage: {
          tables: {
            user: {
              columns: {
                id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                home_address: { nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: true },
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
      expect(types).toContain(
        'readonly homeAddress: { readonly nullable: true; readonly type: { readonly kind: "valueObject"; readonly name: "Address" } }',
      );
    });

    it('handles many: true on value object model fields', () => {
      const ir = createContract({
        models: {
          User: {
            storage: {
              namespaceId: '__unbound__',
              table: 'user',
              fields: {
                id: { column: 'id' },
                addresses: { column: 'addresses' },
              },
            },
            fields: {
              id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
              addresses: {
                nullable: false,
                type: { kind: 'valueObject', name: 'Address' },
                many: true,
              },
            },
            relations: {},
          },
        },
        valueObjects: {
          Address: {
            fields: {
              street: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
            },
          },
        },
        storage: {
          tables: {
            user: {
              columns: {
                id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                addresses: { nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: false },
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
      expect(types).toContain(
        'readonly addresses: { readonly nullable: false; readonly type: { readonly kind: "valueObject"; readonly name: "Address" }; readonly many: true }',
      );
    });

    it('handles self-referencing value object type alias', () => {
      const ir = createContract({
        valueObjects: {
          NavItem: {
            fields: {
              label: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
              children: {
                nullable: false,
                type: { kind: 'valueObject', name: 'NavItem' },
                many: true,
              },
            },
          },
        },
        storage: { tables: {} },
      });
      const types = generateContractDts(ir, sqlEmission, [], testHashes);
      expect(types).toContain('export type NavItemOutput =');
      expect(types).toContain('export type NavItemInput =');
      expect(types).toContain('readonly children: ReadonlyArray<NavItemOutput>');
    });

    it('omits valueObjects when none exist', () => {
      const ir = createContract({
        storage: { tables: {} },
      });
      const types = generateContractDts(ir, sqlEmission, [], testHashes);
      expect(types).not.toContain('valueObjects');
    });

    it('emits nullable value object type alias field', () => {
      const ir = createContract({
        valueObjects: {
          Address: {
            fields: {
              zip: { nullable: true, type: { kind: 'scalar', codecId: 'pg/text@1' } },
            },
          },
        },
        storage: { tables: {} },
      });
      const types = generateContractDts(ir, sqlEmission, [], testHashes);
      expect(types).toContain('readonly zip: CodecTypes["pg/text@1"]["output"] | null');
    });
  });
});
