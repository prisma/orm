import { defineContract } from '@internal/sqlite/contract-builder';

export const contract = defineContract({}, ({ field, model, type }) => ({
  models: {
    Invoice: model('Invoice', {
      fields: {
        id: field.column(type.Int()).id(),
        total: field.column(type.Decimal()),
        visits: field.column(type.BigIntNumber()),
      },
    }).sql({ table: 'invoice' }),
  },
}));
