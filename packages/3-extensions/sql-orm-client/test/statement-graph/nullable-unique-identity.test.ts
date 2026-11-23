import { postgresAdapterCapabilities } from '@internal/adapter-postgres/adapter';
import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { Collection } from '../../src/collection';
import { defineContract, field, model, rel } from '../contract-builder';
import {
  buildTestContextFromContract,
  createMockRuntime,
  perRelationPostgresAdapter,
} from '../helpers';

const UserBase = model('User', {
  fields: {
    id: field.column(int4Column).id(),
  },
}).sql({ table: 'users' });

const Log = model('Log', {
  fields: {
    message: field.column(textColumn),
    code: field.column(textColumn).optional().unique(),
    userId: field.column(int4Column).column('user_id'),
  },
  relations: { author: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }) },
});

const User = UserBase.relations({
  logs: rel.hasMany(() => Log, { by: 'userId' }),
}).sql({ table: 'users' });

const contract = defineContract({ models: { Log, User } });

const withoutReturning: typeof postgresAdapter = {
  ...postgresAdapter,
  capabilities: {
    ...postgresAdapterCapabilities,
    postgres: { ...postgresAdapterCapabilities.postgres, returning: false },
    sql: { ...postgresAdapterCapabilities.sql, returning: false },
  },
};

function logs(adapter: typeof postgresAdapter = postgresAdapter) {
  const runtime = createMockRuntime();
  const context = buildTestContextFromContract(contract, { adapter });
  const collection = new Collection({ runtime, context }, 'Log', { namespaceId: 'public' });
  return { runtime, collection: collection.where({ message: 'hello' }) };
}

function refusal(method: string) {
  return expect.objectContaining({
    code: 'ORM.ROW_IDENTITY_MISSING',
    message: `${method} on model "Log" requires the table to have a primary key or unique constraint`,
  });
}

const includeRefusal = expect.objectContaining({
  code: 'ORM.ROW_IDENTITY_MISSING',
  message:
    'Cannot load include "author" of model "Log": table "Log" has no primary key, and no unique constraint whose columns are all NOT NULL, to match the included rows to their parent rows by.',
});

const ada = { message: 'hi', code: null, userId: 1 };

describe('a table whose only unique key has a nullable column', () => {
  it('refuses an update that needs a row identity, as for a table with no key', async () => {
    const { collection, runtime } = logs();

    await expect(collection.update({ message: 'bye' })).rejects.toThrow(refusal('update()'));
    expect(runtime.executions).toEqual([]);
  });

  it('refuses a delete that needs a row identity, as for a table with no key', async () => {
    const { collection, runtime } = logs();

    await expect(collection.delete()).rejects.toThrow(refusal('delete()'));
    expect(runtime.executions).toEqual([]);
  });

  it('refuses a write that returns its rows with includes', async () => {
    const { collection, runtime } = logs();

    await expect(collection.include('author').create(ada)).rejects.toThrow(includeRefusal);
    expect(runtime.executions).toEqual([]);
  });

  it('refuses a read with includes when includes load with one query per relation', async () => {
    const { collection, runtime } = logs(perRelationPostgresAdapter);

    await expect(collection.include('author').all()).rejects.toThrow(includeRefusal);
    expect(runtime.executions).toEqual([]);
  });

  describe('on a database without RETURNING', () => {
    it('refuses a create that returns its row', async () => {
      const { collection, runtime } = logs(withoutReturning);

      await expect(collection.create(ada)).rejects.toThrow(refusal('create()'));
      expect(runtime.executions).toEqual([]);
    });

    it('refuses a createAll() that returns its rows', async () => {
      const { collection, runtime } = logs(withoutReturning);

      await expect(collection.createAll([ada, { ...ada, message: 'bye' }])).rejects.toThrow(
        refusal('createAll()'),
      );
      expect(runtime.executions).toEqual([]);
    });

    it('refuses an updateAll() that returns its rows', async () => {
      const { collection, runtime } = logs(withoutReturning);

      await expect(collection.updateAll({ message: 'bye' })).rejects.toThrow(
        refusal('updateAll()'),
      );
      expect(runtime.executions).toEqual([]);
    });
  });

  it('refuses a deleteAll() with includes when includes load with one query per relation', async () => {
    const { collection, runtime } = logs(perRelationPostgresAdapter);

    expect(() => collection.include('author').deleteAll()).toThrow(includeRefusal);
    expect(runtime.executions).toEqual([]);
  });

  it('runs a deleteAll() with includes under the one-query include, deleting by the condition alone', async () => {
    const { collection, runtime } = logs();
    runtime.setNextResults([
      [{ message: 'hello', code: null, user_id: 1, author: '{"id":1}' }],
      [],
    ]);

    await collection.include('author').deleteAll();

    const [find, remove] = runtime.executions.map(({ plan }) => {
      const ast = 'ast' in plan ? plan.ast : undefined;
      return ast?.kind === 'select' || ast?.kind === 'delete'
        ? { kind: ast.kind, where: ast.where }
        : undefined;
    });
    expect({
      find: find?.kind,
      remove: remove?.kind,
      sameCondition: remove?.where === find?.where,
    }).toEqual({
      find: 'select',
      remove: 'delete',
      sameCondition: true,
    });
  });
});
