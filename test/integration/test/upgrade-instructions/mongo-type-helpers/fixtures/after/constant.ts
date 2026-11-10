import { defineContract } from '@internal/mongo/contract-builder';

const CODEC = 'mongo/string@1';

export const contract = defineContract({}, ({ field, model, type }) => ({
  models: {
    Doc: model('Doc', {
      collection: 'docs',
      fields: { _id: field.scalar(type.ObjectId()), name: field.scalar(CODEC) },
    }),
  },
}));
