import { defineContract, field, model } from '../../../src/exports/contract-builder';

export const contract = defineContract({
  version: 16,
  capabilities: [{ sql: { interactiveTransactions: true } }],
  models: {
    User: model('User', {
      fields: { id: field.column({ codecId: 'pg/int4@1' } as const).id() },
    }).sql({ table: 'users' }),
  },
});
