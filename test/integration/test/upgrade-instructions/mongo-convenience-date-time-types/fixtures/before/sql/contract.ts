import { defineContract } from '@prisma/orm-postgres/contract-builder';

export const contract = defineContract({}, ({ field, model, type }) => ({
  models: {
    Person: model('Person', {
      fields: { id: field.column(type.Int()).id(), birthday: field.column(type.Date()) },
    }),
  },
}));
