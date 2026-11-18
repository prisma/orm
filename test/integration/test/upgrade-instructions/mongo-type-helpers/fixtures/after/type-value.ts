import { defineContract } from '@internal/mongo/contract-builder';

export const contract = defineContract({}, ({ field, model, type }) => {
  const name = type.String();
  return {
    models: {
      Doc: model('Doc', { collection: 'docs', fields: { _id: field.scalar(type.ObjectId()), name: field.scalar(name) } }),
    },
  };
});
