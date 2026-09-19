import type { Contract } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { modelsOf } from './contract-test-helpers';
import { crossRef } from './cross-ref-helpers';
import { validSqlContractJson } from './sql-contract-json-fixture';
import { storageWithNamespacedTables } from './storage-with-namespaced-tables';
import { unboundTables } from './unbound-tables';

describe('SqlContractSerializer structural validation', () => {
  it('accepts a valid contract with explicit nullable', () => {
    const contract = validateSqlContractFully<Contract<SqlStorage>>(validSqlContractJson());
    expect(unboundTables(contract.storage)['User']?.columns['id']?.nullable).toBe(false);
  });

  it('rejects missing uniques array', () => {
    const input = validSqlContractJson({
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            indexes: [],
            foreignKeys: [],
          },
        },
      }),
    });
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(input)).toThrow();
  });

  it('rejects missing indexes array', () => {
    const input = validSqlContractJson({
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            foreignKeys: [],
          },
        },
      }),
    });
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(input)).toThrow();
  });

  it('rejects missing foreignKeys array', () => {
    const input = validSqlContractJson({
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
          },
        },
      }),
    });
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(input)).toThrow();
  });

  it('accepts table with columns present', () => {
    const contract = validateSqlContractFully<Contract<SqlStorage>>(validSqlContractJson());
    expect(unboundTables(contract.storage)['User']).toBeDefined();
  });

  it('rejects table without columns property', () => {
    const input = validSqlContractJson({
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
    });
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(input)).toThrow();
  });

  it('rejects table with null columns', () => {
    const input = {
      ...validSqlContractJson(),
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: {
          User: {
            columns: null,
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      }),
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(input)).toThrow();
  });

  it('accepts table with empty columns object', () => {
    const input = validSqlContractJson({
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: {
          User: {
            columns: {},
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      }),
    });
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(input)).not.toThrow();
  });

  it('rejects table missing columns in multi-table contract', () => {
    const input = {
      ...validSqlContractJson(),
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: {
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          Post: {
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      }),
      // biome-ignore lint/suspicious/noExplicitAny: testing invalid input
    } as any;
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(input)).toThrow();
  });

  it('accepts model without relations (optional field)', () => {
    const input = validSqlContractJson({
      models: {
        User: {
          storage: { namespaceId: '__unbound__', table: 'User', fields: { id: { column: 'id' } } },
          fields: {
            id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          },
        },
      },
    });
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(input)).not.toThrow();
  });

  it('accepts contract with extensions', () => {
    const contract = validateSqlContractFully<Contract<SqlStorage>>(validSqlContractJson());
    expect(contract.extensions).toEqual({});
  });

  it('accepts contract with capabilities', () => {
    const contract = validateSqlContractFully<Contract<SqlStorage>>(validSqlContractJson());
    expect(contract.capabilities).toEqual({});
  });

  it('accepts contract with meta', () => {
    const contract = validateSqlContractFully<Contract<SqlStorage>>(validSqlContractJson());
    expect(contract.meta).toEqual({});
  });

  it('accepts multiple models without relations', () => {
    const input = validSqlContractJson({
      models: {
        User: {
          storage: { namespaceId: '__unbound__', table: 'user', fields: { id: { column: 'id' } } },
          fields: { id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false } },
        },
        Post: {
          storage: { namespaceId: '__unbound__', table: 'post', fields: { id: { column: 'id' } } },
          fields: { id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false } },
        },
      },
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: {
          user: {
            columns: { id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false } },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: { id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false } },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      }),
    });
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(input)).not.toThrow();
  });

  it('validates models with relations', () => {
    const input = validSqlContractJson({
      models: {
        User: {
          storage: { namespaceId: '__unbound__', table: 'User', fields: { id: { column: 'id' } } },
          fields: { id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false } },
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
            table: 'Post',
            fields: { id: { column: 'id' }, userId: { column: 'userId' } },
          },
          fields: {
            id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
            userId: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          },
          relations: {
            user: {
              to: crossRef('User'),
              on: { localFields: ['userId'], targetFields: ['id'] },
              cardinality: 'N:1',
              nullable: false,
            },
          },
        },
      },
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: {
          User: {
            columns: { id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false } },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          Post: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                source: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'Post',
                  columns: ['userId'],
                },
                target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'User', columns: ['id'] },
                constraint: true,
                index: true,
              },
            ],
          },
        },
      }),
    });
    const contract = validateSqlContractFully<Contract<SqlStorage>>(input);
    expect((modelsOf(contract)['User'] as { relations?: unknown })['relations']).toEqual({
      posts: {
        to: crossRef('Post'),
        on: { localFields: ['id'], targetFields: ['userId'] },
        cardinality: '1:N',
      },
    });
  });

  it('preserves existing relations and accepts missing relations', () => {
    const input = validSqlContractJson({
      models: {
        User: {
          storage: { namespaceId: '__unbound__', table: 'User', fields: { id: { column: 'id' } } },
          fields: { id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false } },
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
            table: 'Post',
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
          User: {
            columns: { id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false } },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          Post: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                source: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'Post',
                  columns: ['userId'],
                },
                target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'User', columns: ['id'] },
                constraint: true,
                index: true,
              },
            ],
          },
        },
      }),
    });
    const contract = validateSqlContractFully<Contract<SqlStorage>>(input);
    expect((modelsOf(contract)['User'] as { relations?: unknown })['relations']).toEqual({
      posts: {
        to: crossRef('Post'),
        on: { localFields: ['id'], targetFields: ['userId'] },
        cardinality: '1:N',
      },
    });
  });

  it('validates FK entries with source/target coordinates only', () => {
    const input = validSqlContractJson({
      storage: storageWithNamespacedTables({
        storageHash: 'test',
        tables: {
          user: {
            columns: { id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false } },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
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
      }),
    });
    const contract = validateSqlContractFully<Contract<SqlStorage>>(input);
    const fk = unboundTables(contract.storage)['post']?.foreignKeys[0];
    expect(fk?.source.columns).toEqual(['userId']);
    expect(fk?.target.columns).toEqual(['id']);
  });
});
