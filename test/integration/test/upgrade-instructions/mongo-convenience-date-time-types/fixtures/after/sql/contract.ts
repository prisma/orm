import { defineContract, postgres18, postgresDriver } from '@prisma/orm-postgres/contract-builder';

export const contract = defineContract({ requiredCapabilities: [...postgres18, ...postgresDriver] }, ({ field, model, type }) => ({
  models: {
    Person: model('Person', {
      fields: { id: field.column(type.Int()).id(), birthday: field.column(type.Date()) },
    }),
  },
}));
