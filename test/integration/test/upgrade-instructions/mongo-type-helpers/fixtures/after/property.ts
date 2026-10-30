import { defineContract } from '@internal/mongo/contract-builder';

export const contract = defineContract({}, (h) => {
  const f = h.field;
  return {
    models: {
      Doc: h.model('Doc', { collection: 'docs', fields: { _id: f.scalar(h.type.ObjectId()), big: f.scalar(h.type.Int64()) } }),
    },
  };
});
