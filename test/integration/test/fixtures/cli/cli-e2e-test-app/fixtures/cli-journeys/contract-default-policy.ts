import { int4Column } from '@internal/adapter-postgres/column-types';
import { defineContract, field, model } from '@internal/postgres/contract-builder';

export const contract = defineContract({
  defaultControlPolicy: 'external',
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
      },
    }).sql({ table: 'user' }),
  },
});
