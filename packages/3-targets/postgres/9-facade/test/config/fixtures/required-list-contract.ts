import { defineContract, field, model } from '../../../src/exports/contract-builder';
import { requiredList } from './required-list';

export const contract = defineContract({
  requiredCapabilities: requiredList,
  models: {
    User: model('User', {
      fields: { id: field.column({ codecId: 'pg/int4@1' } as const).id() },
    }).sql({ table: 'users' }),
  },
});
