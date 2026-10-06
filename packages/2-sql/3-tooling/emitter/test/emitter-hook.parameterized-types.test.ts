import { generateContractDts } from '@internal/emitter';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';

const testHashes = { storageHash: 'test-core-hash', profileHash: 'test-profile-hash' };

describe('sql-target-family-hook parameterized type emission', () => {
  describe('storage.types emission', () => {
    it('emits storage.types with literal types', () => {
      const ir = createContract({
        storage: {
          tables: {
            document: {
              columns: {
                id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
          types: {
            Vector1536: {
              codecId: 'pg/vector@1',
              dataType: 'pgvector/vector',
              typeParams: { length: 1536 },
            },
            Vector768: {
              codecId: 'pg/vector@1',
              dataType: 'pgvector/vector',
              typeParams: { length: 768 },
            },
          },
        },
      });

      const types = generateContractDts(ir, sqlEmission, [], testHashes);

      expect(types).toContain('readonly types:');
      expect(types).toContain(
        'readonly Vector1536: { readonly kind: "codec-instance"; readonly codecId: "pg/vector@1"; readonly dataType: "pgvector/vector"; readonly typeParams: { readonly length: 1536 } }',
      );
      expect(types).toContain(
        'readonly Vector768: { readonly kind: "codec-instance"; readonly codecId: "pg/vector@1"; readonly dataType: "pgvector/vector"; readonly typeParams: { readonly length: 768 } }',
      );
    });

    it('handles empty storage.types', () => {
      const ir = createContract({
        storage: {
          tables: {
            user: {
              columns: {
                id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
          types: {},
        },
      });

      const types = generateContractDts(ir, sqlEmission, [], testHashes);

      expect(types).toContain('readonly namespaces:');
      expect(types).not.toContain('readonly Vector1536');
    });

    it('handles undefined storage.types (no types key)', () => {
      const ir = createContract({
        storage: {
          tables: {
            user: {
              columns: {
                id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
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

      expect(types).toContain('readonly namespaces:');
      expect(types).not.toContain('readonly Vector1536');
    });

    it('emits typeParams with nested objects', () => {
      const ir = createContract({
        storage: {
          tables: {
            data: {
              columns: {
                id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
          types: {
            ComplexType: {
              codecId: 'custom/type@1',
              dataType: 'custom/type',
              typeParams: { a: 1, b: 'hello', c: true },
            },
          },
        },
      });

      const types = generateContractDts(ir, sqlEmission, [], testHashes);

      expect(types).toContain('readonly ComplexType:');
      expect(types).toContain(
        'readonly typeParams: { readonly a: 1; readonly b: "hello"; readonly c: true }',
      );
    });

    it('emits typeParams with arrays', () => {
      const ir = createContract({
        storage: {
          tables: {
            data: {
              columns: {
                id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
          types: {
            ArrayType: {
              codecId: 'custom/type@1',
              dataType: 'custom/type',
              typeParams: { items: [1, 2, 3] },
            },
          },
        },
      });

      const types = generateContractDts(ir, sqlEmission, [], testHashes);

      expect(types).toContain('readonly ArrayType:');
      expect(types).toContain('readonly typeParams: { readonly items: readonly [1, 2, 3] }');
    });

    it('emits typeParams with nested objects inside objects', () => {
      const ir = createContract({
        storage: {
          tables: {
            data: {
              columns: {
                id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
          types: {
            NestedType: {
              codecId: 'custom/type@1',
              dataType: 'custom/type',
              typeParams: { config: { depth: 5, enabled: true } },
            },
          },
        },
      });

      const types = generateContractDts(ir, sqlEmission, [], testHashes);

      expect(types).toContain('readonly NestedType:');
      expect(types).toContain(
        'readonly typeParams: { readonly config: { readonly depth: 5; readonly enabled: true } }',
      );
    });

    it('emits typeParams with null values', () => {
      const ir = createContract({
        storage: {
          tables: {
            data: {
              columns: {
                id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
          types: {
            NullableType: {
              codecId: 'custom/type@1',
              dataType: 'custom/type',
              typeParams: { value: null },
            },
          },
        },
      });

      const types = generateContractDts(ir, sqlEmission, [], testHashes);

      expect(types).toContain('readonly NullableType:');
      expect(types).toContain('readonly typeParams: { readonly value: null }');
    });

    it('emits typeParams with undefined values', () => {
      const ir = createContract({
        storage: {
          tables: {
            data: {
              columns: {
                id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
          types: {
            UndefinedType: {
              codecId: 'custom/type@1',
              dataType: 'custom/type',
              typeParams: { value: undefined },
            },
          },
        },
      });

      const types = generateContractDts(ir, sqlEmission, [], testHashes);

      expect(types).toContain('readonly UndefinedType:');
      expect(types).toContain('readonly typeParams: { readonly value: undefined }');
    });
  });
});
