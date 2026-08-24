import type { Contract } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { crossRef } from './cross-ref-helpers';
import {
  domainModelsRecord,
  sqlStorageFixture,
  validSqlContractJson,
} from './sql-contract-json-fixture';
import { unboundTables } from './unbound-tables';

function contractTablesRecord(contract: Record<string, unknown>): Record<string, unknown> {
  const storage = contract['storage'] as Record<string, unknown>;
  const namespaces = storage['namespaces'] as Record<string, unknown>;
  const slot = namespaces[UNBOUND_NAMESPACE_ID] as Record<string, unknown>;
  const entries = slot['entries'] as Record<string, unknown>;
  return entries['table'] as Record<string, unknown>;
}

describe('SqlContractSerializer logic validation', () => {
  const validContractInput = validSqlContractJson({
    storage: sqlStorageFixture({
      User: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          name: { codecId: 'pg/text@1', nativeType: 'text', nullable: true },
        },
        primaryKey: { columns: ['id'] },
        uniques: [{ columns: ['email'] }],
        indexes: [{ name: 'user_name_idx', columns: ['name'], unique: false }],
        foreignKeys: [],
      },
      Post: {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          title: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [
          {
            source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'Post', columns: ['userId'] },
            target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'User', columns: ['id'] },
            constraint: true,
            index: true,
          },
        ],
      },
    }),
  });

  it('accepts valid contract logic', () => {
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(validContractInput)).not.toThrow();
  });

  it('rejects invalid execution-default generator ids', () => {
    const invalid = {
      ...validContractInput,
      execution: {
        executionHash: 'test',
        mutations: {
          defaults: [
            {
              ref: {
                namespace: 'public',
                table: 'User',
                column: 'id',
              },
              onCreate: {
                kind: 'generator',
                id: 'invalid generator id',
              },
            },
          ],
        },
      },
    };

    expect(() => validateSqlContractFully<Contract<SqlStorage>>(invalid)).toThrow(
      /a flat generator id/,
    );
  });

  it('rejects primaryKey referencing non-existent column', () => {
    const contract = {
      ...validContractInput,
      storage: sqlStorageFixture({
        User: {
          ...unboundTables(validContractInput.storage as unknown as SqlStorage)['User'],
          primaryKey: { columns: ['nonExistent'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      }),
    };
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contract)).toThrow(
      /primaryKey references non-existent column "nonExistent"/,
    );
  });

  it('rejects unique referencing non-existent column', () => {
    const contract = {
      ...validContractInput,
      storage: sqlStorageFixture({
        User: {
          ...unboundTables(validContractInput.storage as unknown as SqlStorage)['User'],
          uniques: [{ columns: ['nonExistent'] }],
          indexes: [],
          foreignKeys: [],
        },
      }),
    };
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contract)).toThrow(
      /unique constraint references non-existent column "nonExistent"/,
    );
  });

  it('rejects index referencing non-existent column', () => {
    const contract = {
      ...validContractInput,
      storage: sqlStorageFixture({
        User: {
          ...unboundTables(validContractInput.storage as unknown as SqlStorage)['User'],
          indexes: [{ name: 'user_nonExistent_idx', columns: ['nonExistent'], unique: false }],
          uniques: [],
          foreignKeys: [],
        },
      }),
    };
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contract)).toThrow(
      /index references non-existent column "nonExistent"/,
    );
  });

  it('rejects foreignKey referencing non-existent table', () => {
    const contract = {
      ...validContractInput,
      storage: sqlStorageFixture({
        User: {
          ...unboundTables(validContractInput.storage as unknown as SqlStorage)['User'],
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
        Post: {
          ...unboundTables(validContractInput.storage as unknown as SqlStorage)['Post'],
          foreignKeys: [
            {
              source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'Post', columns: ['userId'] },
              target: {
                namespaceId: UNBOUND_NAMESPACE_ID,
                tableName: 'NonExistent',
                columns: ['id'],
              },
              constraint: true,
              index: true,
            },
          ],
          uniques: [],
          indexes: [],
        },
      }),
    };
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contract)).toThrow(
      /foreignKey references non-existent table "__unbound__\.NonExistent"/,
    );
  });

  it('validates composite primary keys', () => {
    const contractInput = {
      ...validContractInput,
      storage: sqlStorageFixture({
        UserRole: {
          columns: {
            userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            roleId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['userId', 'roleId'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      }),
    };
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contractInput)).not.toThrow();
  });

  it('validates composite foreign keys', () => {
    const contractInput = {
      ...validContractInput,
      storage: sqlStorageFixture({
        User: {
          columns: {
            id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            tenantId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id', 'tenantId'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
        Post: {
          columns: {
            id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            tenantId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [
            {
              source: {
                namespaceId: UNBOUND_NAMESPACE_ID,
                tableName: 'Post',
                columns: ['userId', 'tenantId'],
              },
              target: {
                namespaceId: UNBOUND_NAMESPACE_ID,
                tableName: 'User',
                columns: ['id', 'tenantId'],
              },
              constraint: true,
              index: true,
            },
          ],
        },
      }),
    };
    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contractInput)).not.toThrow();
  });

  describe('model validation', () => {
    const createModelContract = () =>
      validSqlContractJson({
        models: {
          User: {
            storage: {
              namespaceId: '__unbound__',
              table: 'User',
              fields: { id: { column: 'id' } },
            },
            fields: {
              id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
            },
            relations: {},
          },
        },
        storage: sqlStorageFixture({
          User: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        }),
      }) as Record<string, unknown>;

    const addPostModel = (contract: Record<string, unknown>) => {
      domainModelsRecord(contract)['Post'] = {
        storage: {
          namespaceId: '__unbound__',
          table: 'Post',
          fields: { id: { column: 'id' }, userId: { column: 'userId' } },
        },
        fields: {
          id: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          userId: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
        },
        relations: {},
      };
      contractTablesRecord(contract)['Post'] = {
        columns: {
          id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          userId: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      };
      return contract;
    };

    it('rejects model referencing missing table', () => {
      const contract = createModelContract();
      const userModel = domainModelsRecord(contract)['User'] as Record<string, unknown>;
      userModel['storage'] = {
        table: 'MissingTable',
        namespaceId: '__unbound__',
        fields: { id: { column: 'id' } },
      };
      expect(() => validateSqlContractFully<Contract<SqlStorage>>(contract)).toThrow(
        /references non-existent table "__unbound__\.MissingTable"/,
      );
    });

    it('accepts model table without primary key', () => {
      const contract = createModelContract();
      const userTable = contractTablesRecord(contract)['User'] as Record<string, unknown>;
      delete userTable['primaryKey'];
      expect(() => validateSqlContractFully<Contract<SqlStorage>>(contract)).not.toThrow();
    });

    it('rejects model field referencing missing column', () => {
      const contract = createModelContract();
      const userModel = domainModelsRecord(contract)['User'] as Record<
        string,
        Record<string, unknown>
      >;
      (userModel['storage'] as Record<string, unknown>)['fields'] = {
        id: { column: 'missing' },
      };
      expect(() => validateSqlContractFully<Contract<SqlStorage>>(contract)).toThrow(
        /references non-existent column "missing"/,
      );
    });

    it('skips foreign key validation for 1:N relations', () => {
      const contract = addPostModel(createModelContract());
      (domainModelsRecord(contract)['User'] as Record<string, unknown>)['relations'] = {
        posts: {
          to: crossRef('Post'),
          on: { localFields: ['id'], targetFields: ['userId'] },
          cardinality: '1:N',
        },
      };
      (contractTablesRecord(contract)['Post'] as Record<string, unknown>)['foreignKeys'] = [
        {
          source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'Post', columns: ['userId'] },
          target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'User', columns: ['id'] },
          constraint: true,
          index: true,
        },
      ];
      expect(() => validateSqlContractFully<Contract<SqlStorage>>(contract)).not.toThrow();
    });

    it('accepts N:1 relation without matching FK', () => {
      const contract = addPostModel(createModelContract());
      (domainModelsRecord(contract)['Post'] as Record<string, unknown>)['relations'] = {
        user: {
          to: crossRef('User'),
          on: { localFields: ['userId'], targetFields: ['id'] },
          cardinality: 'N:1',
        },
      };
      expect(() => validateSqlContractFully<Contract<SqlStorage>>(contract)).not.toThrow();
    });

    it('accepts N:1 relations with matching foreign keys', () => {
      const contract = addPostModel(createModelContract());
      (domainModelsRecord(contract)['Post'] as Record<string, unknown>)['relations'] = {
        user: {
          to: crossRef('User'),
          on: { localFields: ['userId'], targetFields: ['id'] },
          cardinality: 'N:1',
        },
      };
      (contractTablesRecord(contract)['Post'] as Record<string, unknown>)['foreignKeys'] = [
        {
          source: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'Post', columns: ['userId'] },
          target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'User', columns: ['id'] },
          constraint: true,
          index: true,
        },
      ];
      expect(() => validateSqlContractFully<Contract<SqlStorage>>(contract)).not.toThrow();
    });
  });

  describe('column defaults', () => {
    const baseContract = validSqlContractJson({
      storage: sqlStorageFixture({
        Post: {
          columns: {
            id: {
              codecId: 'pg/text@1',
              nativeType: 'text',
              nullable: false,
              default: { kind: 'function', expression: 'gen_random_uuid()' },
            },
            title: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      }),
    });

    it('accepts function defaults without capability gating', () => {
      expect(() => validateSqlContractFully<Contract<SqlStorage>>(baseContract)).not.toThrow();
    });

    it('accepts multiple function defaults without capability gating', () => {
      const contract = validSqlContractJson({
        storage: sqlStorageFixture({
          Post: {
            columns: {
              id: {
                codecId: 'pg/int4@1',
                nativeType: 'int4',
                nullable: false,
                default: { kind: 'function', expression: 'autoincrement()' },
              },
              createdAt: {
                codecId: 'pg/timestamptz-temporal@1',
                nativeType: 'timestamptz',
                nullable: false,
                default: { kind: 'function', expression: 'now()' },
              },
              externalId: {
                codecId: 'pg/text@1',
                nativeType: 'text',
                nullable: false,
                default: { kind: 'function', expression: 'gen_random_uuid()' },
              },
              title: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        }),
      });
      expect(() => validateSqlContractFully<Contract<SqlStorage>>(contract)).not.toThrow();
    });

    it('ignores non-function defaults (literal)', () => {
      const contract = validSqlContractJson({
        storage: sqlStorageFixture({
          Post: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              status: {
                codecId: 'pg/text@1',
                nativeType: 'text',
                nullable: false,
                default: { kind: 'literal', value: 'draft' },
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        }),
      });
      expect(() => validateSqlContractFully<Contract<SqlStorage>>(contract)).not.toThrow();
    });

    it('keeps ISO string defaults as strings for timestamp columns', () => {
      const contract = validSqlContractJson({
        storage: sqlStorageFixture({
          Post: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              createdAt: {
                codecId: 'pg/timestamptz-temporal@1',
                nativeType: 'timestamptz',
                nullable: false,
                default: { kind: 'literal', value: '2024-01-01T00:00:00.000Z' },
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        }),
      });

      const validated = validateSqlContractFully<Contract<SqlStorage>>(contract);
      const defaultValue = unboundTables(validated.storage)['Post']!.columns['createdAt']!.default;
      if (defaultValue?.kind !== 'literal') {
        throw new Error('Expected literal default');
      }
      expect(defaultValue.value).toBe('2024-01-01T00:00:00.000Z');
    });

    it('throws for default with unsupported kind', () => {
      const contract = validSqlContractJson({
        storage: sqlStorageFixture({
          Post: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              status: {
                codecId: 'pg/text@1',
                nativeType: 'text',
                nullable: false,
                default: { kind: 'now', expression: 'now()' },
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        }),
      });
      expect(() => validateSqlContractFully<Contract<SqlStorage>>(contract)).toThrow();
    });

    it('throws for default missing value', () => {
      const contract = validSqlContractJson({
        storage: sqlStorageFixture({
          Post: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              status: {
                codecId: 'pg/text@1',
                nativeType: 'text',
                nullable: false,
                default: { kind: 'literal' },
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        }),
      });
      expect(() => validateSqlContractFully<Contract<SqlStorage>>(contract)).toThrow();
    });

    it('throws for default expression with non-string type', () => {
      const contract = validSqlContractJson({
        storage: sqlStorageFixture({
          Post: {
            columns: {
              id: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
              status: {
                codecId: 'pg/text@1',
                nativeType: 'text',
                nullable: false,
                default: { kind: 'function', expression: 123 },
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        }),
      });
      expect(() => validateSqlContractFully<Contract<SqlStorage>>(contract)).toThrow();
    });
  });
});
