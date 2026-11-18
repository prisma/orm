import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { validSqlContractJson } from './sql-contract-json-fixture';
import { storageWithNamespacedTables } from './storage-with-namespaced-tables';
import { unboundTables } from './unbound-tables';

/**
 * Concrete contract type for these tests. Using the generic Contract<SqlStorage>
 * breaks type inference because JSON imports lose literal types. This concrete type
 * provides sufficient structure for SqlContractSerializer to narrow correctly.
 */
type TestContract = Contract<SqlStorage>;

describe('SqlContractSerializer parameterized type fields', () => {
  const baseContractInput = validSqlContractJson({
    storage: storageWithNamespacedTables({
      storageHash: 'test',
      tables: {
        User: {
          columns: {
            id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    }),
  });

  describe('column typeParams', () => {
    it('accepts column with typeParams object', () => {
      const input = {
        ...baseContractInput,
        storage: storageWithNamespacedTables({
          storageHash: 'test',
          tables: {
            Embedding: {
              columns: {
                id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                vector: {
                  dataType: 'pgvector/vector',
                  codecId: 'pg/vector@1',
                  nullable: false,
                  typeParams: { length: 1536 },
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        }),
      };

      const result = validateSqlContractFully<TestContract>(input);
      const vectorCol = unboundTables(result.storage)['Embedding']?.columns['vector'];
      expect(vectorCol?.typeParams).toEqual({ length: 1536 });
    });

    it('accepts column with empty typeParams object', () => {
      const input = {
        ...baseContractInput,
        storage: storageWithNamespacedTables({
          storageHash: 'test',
          tables: {
            User: {
              columns: {
                id: {
                  dataType: 'pg/int4',
                  codecId: 'pg/int4@1',
                  nullable: false,
                  typeParams: {},
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        }),
      };

      const result = validateSqlContractFully<TestContract>(input);
      expect(unboundTables(result.storage)['User']?.columns['id']?.typeParams).toEqual({});
    });

    it('accepts column without typeParams (optional field)', () => {
      const result = validateSqlContractFully<TestContract>(baseContractInput);
      expect(unboundTables(result.storage)['User']?.columns['id']?.typeParams).toBeUndefined();
    });

    it('rejects non-object typeParams', () => {
      const input = {
        ...baseContractInput,
        storage: storageWithNamespacedTables({
          storageHash: 'test',
          tables: {
            User: {
              columns: {
                id: {
                  dataType: 'pg/int4',
                  codecId: 'pg/int4@1',
                  nullable: false,
                  typeParams: 'invalid',
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        }),
      };

      expect(() => validateSqlContractFully<TestContract>(input)).toThrow(/typeParams/);
    });

    it('accepts array typeParams (array-vs-object validated by emitter)', () => {
      const input = {
        ...baseContractInput,
        storage: storageWithNamespacedTables({
          storageHash: 'test',
          tables: {
            User: {
              columns: {
                id: {
                  dataType: 'pg/int4',
                  codecId: 'pg/int4@1',
                  nullable: false,
                  typeParams: [1, 2, 3],
                },
              },
              primaryKey: { columns: ['id'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        }),
      };

      expect(() => validateSqlContractFully<TestContract>(input)).not.toThrow();
    });
  });

  describe('storage.types (named type instances)', () => {
    it('accepts storage with types object', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: {
            Vector1536: {
              kind: 'codec-instance',
              codecId: 'pg/vector@1',
              dataType: 'pgvector/vector',
              typeParams: { length: 1536 },
            },
          },
        },
      };

      const result = validateSqlContractFully<TestContract>(input);
      expect(result.storage.types).toEqual({
        Vector1536: {
          kind: 'codec-instance',
          codecId: 'pg/vector@1',
          dataType: 'pgvector/vector',
          typeParams: { length: 1536 },
        },
      });
    });

    it('accepts storage with multiple type instances', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: {
            Vector1536: {
              kind: 'codec-instance',
              codecId: 'pg/vector@1',
              dataType: 'pgvector/vector',
              typeParams: { length: 1536 },
            },
            Vector768: {
              kind: 'codec-instance',
              codecId: 'pg/vector@1',
              dataType: 'pgvector/vector',
              typeParams: { length: 768 },
            },
          },
        },
      };

      const result = validateSqlContractFully<TestContract>(input);
      expect(Object.keys(result.storage.types!)).toHaveLength(2);
    });

    it('accepts storage without types (optional field)', () => {
      const result = validateSqlContractFully<TestContract>(baseContractInput);
      expect(result.storage.types).toBeUndefined();
    });

    it('rejects type instance missing codecId', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: {
            Vector1536: {
              kind: 'codec-instance',
              dataType: 'pgvector/vector',
              typeParams: { length: 1536 },
            },
          },
        },
      };

      expect(() => validateSqlContractFully<TestContract>(input)).toThrow(/codecId/);
    });

    it('rejects type instance missing dataType', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: {
            Vector1536: {
              kind: 'codec-instance',
              codecId: 'pg/vector@1',
              typeParams: { length: 1536 },
            },
          },
        },
      };

      expect(() => validateSqlContractFully<TestContract>(input)).toThrow(/dataType/);
    });

    it('accepts type instance with omitted typeParams (canonical form for empty)', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: {
            Vector1536: {
              kind: 'codec-instance',
              codecId: 'pg/vector@1',
              dataType: 'pgvector/vector',
            },
          },
        },
      };

      expect(() => validateSqlContractFully<TestContract>(input)).not.toThrow();
    });

    it('rejects non-object storage.types', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: 'invalid',
        },
      };

      expect(() => validateSqlContractFully<TestContract>(input)).toThrow(/types/);
    });

    it('accepts array typeParams in type instance (array-vs-object validated by emitter)', () => {
      const input = {
        ...baseContractInput,
        storage: {
          ...baseContractInput.storage,
          types: {
            Vector1536: {
              kind: 'codec-instance',
              codecId: 'pg/vector@1',
              dataType: 'pgvector/vector',
              typeParams: [1536],
            },
          },
        },
      };

      expect(() => validateSqlContractFully<TestContract>(input)).not.toThrow();
    });
  });
});
