import { defineContract, field, gen, model, type } from '@internal/postgres/contract-builder';

export const contract = defineContract({
  version: 18,
  models: {
    User: model('User', {
      fields: {
        id: field.column(type.Char(36)).onCreate(gen.uuid()).id(),
      },
    }).sql({ table: 'user' }),
  },
});
