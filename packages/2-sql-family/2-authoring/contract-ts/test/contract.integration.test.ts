import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { sqlStorageFixture, validSqlContractJson } from './sql-contract-json-fixture';
import { unboundTables } from './unbound-tables';

describe('SqlContractSerializer', () => {
  const validContractInput = validSqlContractJson({
    storage: sqlStorageFixture({
      User: {
        columns: {
          id: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false },
          email: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false },
        },
        primaryKey: { columns: ['id'] },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    }),
  });

  it('performs both structural and logical validation', () => {
    const result = validateSqlContractFully<Contract<SqlStorage>>(validContractInput);
    expect(unboundTables(result.storage)).toHaveProperty('User');
  });

  it('throws on semantic validation failure for duplicate named storage objects', () => {
    const invalid = {
      ...validContractInput,
      storage: sqlStorageFixture({
        User: {
          ...unboundTables(validContractInput.storage as unknown as SqlStorage)['User'],
          primaryKey: { columns: ['id'], name: 'user_pkey' },
          indexes: [{ columns: ['id'], name: 'user_pkey', unique: false }],
        },
      }),
    };

    expect(() => validateSqlContractFully<Contract<SqlStorage>>(invalid)).toThrow(
      /Contract semantic validation failed:.*user_pkey/,
    );
  });
});
