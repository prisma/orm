/**
 * Storage no model maps: a column no field maps, a table no model maps, and a foreign key no relation travels. The contract validates; every field must map a column that exists, and a generated default must target a column a field maps.
 */
import { ContractValidationError } from '@internal/contract/contract-validation-error';
import type { ContractModel } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { blindCast } from '@internal/utils/casts';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { col, fk, model, pk, table } from '../src/factories';
import type { SqlModelFieldStorage, SqlStorage } from '../src/types';
import { validateSqlContractFully } from '../src/validators';

function storage<T extends Record<string, unknown>>(tables: T) {
  return {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        kind: 'test-sql-namespace',
        entries: { table: tables },
      },
    },
  };
}

function userModel(fields: Record<string, SqlModelFieldStorage>): ContractModel {
  return blindCast<ContractModel, 'model() widens relations; this model has none'>(
    model('user', fields, {}),
  );
}

const tables = {
  user: table(
    {
      id: col('pg/int4', 'pg/int4@1'),
      email: col('pg/text', 'pg/text@1'),
      legacy_key: col('pg/text', 'pg/text@1', true),
    },
    { pk: pk('id') },
  ),
  _prisma_migrations: table(
    {
      id: col('pg/varchar', 'pg/varchar@1'),
      migration_name: col('pg/varchar', 'pg/varchar@1'),
      user_id: col('pg/int4', 'pg/int4@1', true),
    },
    {
      pk: pk('id'),
      fks: [fk('_prisma_migrations', ['user_id'], 'user', ['id'])],
    },
  ),
};

describe('storage no model maps', () => {
  it('validates a column no field maps, a table no model maps, and a foreign key no relation travels', () => {
    const contract = createContract<SqlStorage>({
      storage: storage(tables),
      models: { User: userModel({ id: { column: 'id' }, email: { column: 'email' } }) },
    });

    expect(() => validateSqlContractFully(contract)).not.toThrow();
  });

  it('still refuses a field that maps a column the table does not have', () => {
    const contract = createContract<SqlStorage>({
      storage: storage(tables),
      models: { User: userModel({ id: { column: 'id' }, legacyKey: { column: 'legacyKey' } }) },
    });

    expect(() => validateSqlContractFully(contract)).toThrow(
      /field "legacyKey" references non-existent column "legacyKey" in table "user"/,
    );
  });

  it('refuses a domain field with no storage entry, so every field names its column', () => {
    const user = userModel({ id: { column: 'id' } });
    const contract = createContract<SqlStorage>({
      storage: storage(tables),
      models: {
        User: {
          ...user,
          fields: {
            ...user.fields,
            email: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' }, many: false },
          },
        },
      },
    });

    expect(() => validateSqlContractFully(contract)).toThrow(
      new ContractValidationError(
        'Model "__unbound__:User" field "email" has no entry in storage.fields, so no column holds it',
        'storage',
      ),
    );
  });

  it('refuses a generated default on a column no field maps, since execution defaults belong to fields', () => {
    const contract = createContract<SqlStorage>({
      storage: storage(tables),
      models: { User: userModel({ id: { column: 'id' }, email: { column: 'email' } }) },
      execution: {
        mutations: {
          defaults: [
            {
              ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'user', field: 'legacy_key' },
              onCreate: { kind: 'generator', id: 'uuidv4' },
            },
          ],
        },
      },
    });

    expect(() => validateSqlContractFully(contract)).toThrow(
      new ContractValidationError(
        'Execution default for column "legacy_key" of table "__unbound__.user" targets a column no field maps; execution defaults are declared on fields. Give the column a database default instead.',
        'storage',
      ),
    );
  });

  it('accepts a generated default on a column a field maps', () => {
    const contract = createContract<SqlStorage>({
      storage: storage(tables),
      models: { User: userModel({ id: { column: 'id' }, email: { column: 'email' } }) },
      execution: {
        mutations: {
          defaults: [
            {
              ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'user', field: 'email' },
              onCreate: { kind: 'generator', id: 'uuidv4' },
            },
          ],
        },
      },
    });

    expect(() => validateSqlContractFully(contract)).not.toThrow();
  });
});
