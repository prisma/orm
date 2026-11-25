import { defineContract, field, gen, model, type } from '@internal/postgres/contract-builder';

export const contract = defineContract({
  databaseVersion: 18,
  models: {
    User: model('User', {
      fields: {
        id: field.column(type.Char(26)).onCreate(gen.ulid()).id(),
      },
    }).sql({ table: 'user' }),
  },
});
