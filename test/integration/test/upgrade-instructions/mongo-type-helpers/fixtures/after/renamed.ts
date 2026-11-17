import { defineContract } from '@internal/mongo/contract-builder';

export const contract = defineContract({}, ({ field: fl, model, type }) => ({
  models: {
    Post: model('Post', {
      collection: 'posts',
      fields: {
        _id: fl.scalar(type.ObjectId()),
        title: fl.scalar(type.String()),
        embedding: fl.scalar(type.Vector(3)),
        body: fl.scalar(type.String())
          .optional(),
      },
    }),
  },
}));
