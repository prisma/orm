import { charColumn } from '@internal/adapter-postgres/column-types';
import { defineContract, field, gen, model } from '@internal/postgres/contract-builder';

export const contract = defineContract({
  models: {
    User: model('User', {
      fields: {
        id: field.column(charColumn(36)).id().onCreate(gen.uuid(7)),
      },
    }).sql({ table: 'user' }),
  },
});
