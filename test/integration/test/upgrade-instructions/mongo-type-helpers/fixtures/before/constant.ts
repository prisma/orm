import { defineContract } from '@internal/mongo/contract-builder';

const CODEC = 'mongo/string@1';

export const contract = defineContract({}, ({ field, model }) => ({
  models: {
    Doc: model('Doc', {
      collection: 'docs',
      fields: { _id: field.objectId(), name: field.scalar(CODEC) },
    }),
  },
}));
