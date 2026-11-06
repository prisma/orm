import { defineContract, field, model } from '@internal/mongo/contract-builder';

export const contract = defineContract({
  models: {
    Doc: model('Doc', {
      collection: 'docs',
      fields: { id: field.objectId().mongo({ field: '_id' }) },
    }),
    Account: model('Account', {
      collection: 'accounts',
      fields: { id: field.string().mongo({ field: '_id' }), email: field.string() },
    }),
    Counter: model('Counter', {
      collection: 'counters',
      fields: { id: field.int32().mongo({ field: '_id' }), count: field.int32() },
    }),
  },
});
