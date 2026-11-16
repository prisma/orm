import { textColumn } from '@internal/adapter-postgres/column-types';
import { describe, expect, it } from 'vitest';
import { Collection } from '../../src/collection';
import { defineContract, field, model } from '../contract-builder';
import { buildTestContextFromContract, createMockRuntime } from '../helpers';

const contract = defineContract({
  models: {
    Log: model('Log', {
      fields: {
        message: field.column(textColumn),
        code: field.column(textColumn).optional().unique(),
      },
    }),
  },
});

function logs() {
  const runtime = createMockRuntime();
  const context = buildTestContextFromContract(contract);
  const collection = new Collection({ runtime, context }, 'Log', { namespaceId: 'public' });
  return { runtime, collection: collection.where({ message: 'hello' }) };
}

function refusal(method: string) {
  return expect.objectContaining({
    code: 'ORM.ROW_IDENTITY_MISSING',
    message: `${method} on model "Log" requires the table to have a primary key or unique constraint`,
  });
}

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
});
