import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { crossRef } from './cross-ref-helpers';
import { validSqlContractJson } from './sql-contract-json-fixture';
import { storageWithNamespacedTables } from './storage-with-namespaced-tables';

describe('SqlContractSerializer edge cases', () => {
  it('handles storage with null tables', () => {
    const contractInput = validSqlContractJson({
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: null,
      }),
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    }) as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contractInput)).toThrow();
  });

  it('handles storage without tables property', () => {
    const contractInput = validSqlContractJson({
      storage: { storageHash: 'test' },
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    }) as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contractInput)).toThrow();
  });

  it('rejects models with null relations', () => {
    const contractInput = validSqlContractJson({
      domain: {
        namespaces: {
          __unbound__: {
            models: {
              User: {
                storage: {
                  namespaceId: '__unbound__',
                  table: 'user',
                  fields: { id: { column: 'id' } },
                },
                fields: {
                  id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
                },
                relations: null,
              },
            },
          },
        },
      },
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      }),
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    }) as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contractInput)).toThrow(
      /relations/,
    );
  });

  it('handles table without columns in normalization', () => {
    const contractInput = validSqlContractJson({
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: {
          User: {
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      }),
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    }) as any;
    // This will fail validation, but normalization should handle it
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contractInput)).toThrow();
  });

  it('rejects relation targeting non-existent model', () => {
    const contractInput = validSqlContractJson({
      models: {
        User: {
          storage: { namespaceId: '__unbound__', table: 'user', fields: { id: { column: 'id' } } },
          fields: {
            id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          },
          relations: {
            posts: {
              to: crossRef('Post'),
              cardinality: '1:N',
            },
          },
        },
      },
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      }),
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    }) as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contractInput)).toThrow(
      /targets "__unbound__:Post" which does not exist/,
    );
  });

  it('rejects relation without to property (domain validation)', () => {
    const contractInput = validSqlContractJson({
      models: {
        User: {
          storage: { namespaceId: '__unbound__', table: 'user', fields: { id: { column: 'id' } } },
          fields: {
            id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          },
          relations: {
            posts: {
              on: { localFields: ['id'], targetFields: ['userId'] },
              cardinality: '1:N',
            },
          },
        },
      },
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      }),
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    }) as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contractInput)).toThrow(
      /relations\.posts\.to must be an object/,
    );
  });

  it('accepts relation with localFields/targetFields on shape', () => {
    const contractInput = validSqlContractJson({
      models: {
        User: {
          storage: { namespaceId: '__unbound__', table: 'user', fields: { id: { column: 'id' } } },
          fields: {
            id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          },
          relations: {
            posts: {
              to: crossRef('Post'),
              on: { localFields: ['id'], targetFields: ['userId'] },
              cardinality: '1:N',
            },
          },
        },
        Post: {
          storage: {
            namespaceId: '__unbound__',
            table: 'post',
            fields: { id: { column: 'id' }, userId: { column: 'userId' } },
          },
          fields: {
            id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
            userId: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          },
        },
      },
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: {
          user: {
            columns: {
              id: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false },
              userId: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      }),
    });
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contractInput)).not.toThrow();
  });
});
