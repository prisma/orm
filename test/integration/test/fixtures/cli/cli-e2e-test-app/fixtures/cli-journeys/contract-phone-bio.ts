import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import { defineContract, field, model } from '@internal/postgres/contract-builder';

export const contract = defineContract({
  version: 18,
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
        phone: field.column(textColumn).optional(),
        bio: field.column(textColumn).optional(),
      },
    }).sql({ table: 'user' }),
  },
});
