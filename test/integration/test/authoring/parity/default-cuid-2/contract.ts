import { defineContract, field, gen, model, type } from '@internal/postgres/contract-builder';

export const contract = defineContract({
  models: {
    User: model('User', {
      fields: {
        id: field.column(type.Char(24)).onCreate(gen.cuid(2)).id(),
      },
    }).sql({ table: 'user' }),
  },
});
