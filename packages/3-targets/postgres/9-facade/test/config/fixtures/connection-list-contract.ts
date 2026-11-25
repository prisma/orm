import { defineContract, field, model } from '../../../src/exports/contract-builder';
import { connectionList } from './connection-list';

export const contract = defineContract({
  databaseVersion: 16,
  capabilities: connectionList,
  models: {
    User: model('User', {
      fields: { id: field.column({ codecId: 'pg/int4@1' } as const).id() },
    }).sql({ table: 'users' }),
  },
});
