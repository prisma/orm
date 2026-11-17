import { defineContract, field, model, type } from '@internal/mongo/contract-builder';

export const contract = defineContract({
  models: {
    Doc: model('Doc', {
      collection: 'docs',
      fields: { id: field.scalar(type.ObjectId()).mongo({ field: '_id' }) },
    }),
    Account: model('Account', {
      collection: 'accounts',
      fields: {
        id: field.scalar(type.String()).mongo({ field: '_id' }),
        email: field.scalar(type.String()),
      },
    }),
    Counter: model('Counter', {
      collection: 'counters',
      fields: {
        id: field.scalar(type.Int32()).mongo({ field: '_id' }),
        count: field.scalar(type.Int32()),
      },
    }),
  },
});
