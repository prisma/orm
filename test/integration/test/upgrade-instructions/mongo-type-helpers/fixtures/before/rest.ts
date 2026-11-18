import { defineContract } from '@internal/mongo/contract-builder';

export const contract = defineContract({}, ({ field, ...rest }) => ({
  models: {
    Doc: rest.model('Doc', { collection: 'docs', fields: { _id: field.objectId() } }),
  },
}));
