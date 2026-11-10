import { textColumn } from '@internal/adapter-postgres/column-types';
import { describe, expect, it } from 'vitest';
import { Collection } from '../../src/collection';
import { defineContract, field, model } from '../contract-builder';
import { buildTestContextFromContract, createMockRuntime } from '../helpers';

const contract = defineContract({
  models: { Log: model('Log', { fields: { message: field.column(textColumn) } }) },
});
const refusal = expect.objectContaining({
  code: 'ORM.ROW_IDENTITY_MISSING',
  message:
    'update()/delete() on model "Log" requires the table to have a primary key or unique constraint',
});

function logs() {
  const runtime = createMockRuntime();
  const context = buildTestContextFromContract(contract);
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

    await expect(collection.update({ message: 'bye' })).rejects.toThrow(refusal);
    expect(runtime.executions).toEqual([]);
  });

  it('delete is refused before any statement', async () => {
    const { collection, runtime } = logs();

    await expect(collection.delete()).rejects.toThrow(refusal);
    expect(runtime.executions).toEqual([]);
  });
});
