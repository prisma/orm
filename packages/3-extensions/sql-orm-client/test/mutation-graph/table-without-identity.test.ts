import { textColumn } from '@internal/adapter-postgres/column-types';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { Collection } from '../../src/collection';
import { defineContract, field, model } from '../contract-builder';
import { buildTestContextFromContract, createMockRuntime } from '../helpers';

const contract = defineContract({
  models: { Log: model('Log', { fields: { message: field.column(textColumn) } }) },
});
function refusal(method: string) {
  return expect.objectContaining({
    code: 'ORM.ROW_IDENTITY_MISSING',
    message: `${method} on model "Log" requires the table to have a primary key or unique constraint`,
  });
}

const withReturning: Contract<SqlStorage> = {
  ...contract,
  capabilities: { sql: { returning: true } },
};
const withoutReturning: Contract<SqlStorage> = { ...contract, capabilities: {} };

function logs(of: Contract<SqlStorage> = contract) {
  const runtime = createMockRuntime();
  const context = { ...buildTestContextFromContract(contract), contract: of };
  const collection = new Collection({ runtime, context }, 'Log', { namespaceId: 'public' });
  return { runtime, collection: collection.where({ message: 'hello' }) };
}

describe('a table with no primary key and no unique constraint', () => {
  it('update with nothing to set reads the first matching row', async () => {
    const { collection, runtime } = logs();
    runtime.setNextResults([[{ message: 'hello' }]]);

    expect(await collection.select('message').update({})).toEqual({ message: 'hello' });
    expect(runtime.executions).toHaveLength(1);
  });

  it('update that sets a value is refused before any statement', async () => {
    const { collection, runtime } = logs();

    await expect(collection.update({ message: 'bye' })).rejects.toThrow(refusal('update()'));
    expect(runtime.executions).toEqual([]);
  });

  it('delete is refused before any statement', async () => {
    const { collection, runtime } = logs();

    await expect(collection.delete()).rejects.toThrow(refusal('delete()'));
    expect(runtime.executions).toEqual([]);
  });

  it('deleteAll is one Delete that returns the rows with returning', async () => {
    const { collection, runtime } = logs(withReturning);
    runtime.setNextResults([[{ message: 'hello' }]]);

    expect(await collection.deleteAll()).toEqual([{ message: 'hello' }]);
    expect(runtime.executions.map(({ plan }) => plan.ast.kind)).toEqual(['delete']);
  });

  it('deleteAll reads the rows by the caller condition, then deletes by it, without returning', async () => {
    const { collection, runtime } = logs(withoutReturning);
    runtime.setNextResults([[{ message: 'hello' }], []]);

    expect(await collection.deleteAll()).toEqual([{ message: 'hello' }]);
    expect(runtime.executions.map(({ plan }) => plan.ast.kind)).toEqual(['select', 'delete']);
  });

  it('updateAll returns the rows its Update returns with returning', async () => {
    const { collection, runtime } = logs(withReturning);
    runtime.setNextResults([[{ message: 'bye' }]]);

    expect(await collection.updateAll({ message: 'bye' })).toEqual([{ message: 'bye' }]);
  });

  it('updateAll is refused before any statement without returning', async () => {
    const { collection, runtime } = logs(withoutReturning);

    await expect(collection.updateAll({ message: 'bye' })).rejects.toThrow(refusal('updateAll()'));
    expect(runtime.executions).toEqual([]);
  });

  it('updateAndCount counts the rows without returning', async () => {
    const { collection, runtime } = logs(withoutReturning);
    runtime.setNextStats([{ affectedRows: 2 }]);

    expect(await collection.updateAndCount({ message: 'bye' })).toBe(2);
  });

  it('createAll returns the rows its Insert returns with returning', async () => {
    const { collection, runtime } = logs(withReturning);
    runtime.setNextResults([[{ message: 'hi' }]]);

    expect(await collection.createAll([{ message: 'hi' }])).toEqual([{ message: 'hi' }]);
  });

  it('createAll is refused before any statement without returning, and createAndCount counts', async () => {
    const { collection, runtime } = logs(withoutReturning);

    await expect(collection.createAll([{ message: 'hi' }])).rejects.toThrow(refusal('create()'));
    expect(runtime.executions).toEqual([]);
    runtime.setNextStats([{ affectedRows: 1 }]);
    expect(await collection.createAndCount([{ message: 'hi' }])).toBe(1);
  });
});
