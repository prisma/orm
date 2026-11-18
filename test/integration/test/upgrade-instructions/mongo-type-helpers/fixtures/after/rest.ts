import { defineContract } from '@internal/mongo/contract-builder';

export const contract = defineContract({}, ({ field, type, ...rest }) => ({
  models: {
    Doc: rest.model('Doc', { collection: 'docs', fields: { _id: field.scalar(type.ObjectId()) } }),
  },
}));
