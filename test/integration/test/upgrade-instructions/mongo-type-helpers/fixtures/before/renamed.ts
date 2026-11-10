import { defineContract } from '@internal/mongo/contract-builder';

export const contract = defineContract({}, ({ field: fl, model }) => ({
  models: {
    Post: model('Post', {
      collection: 'posts',
      fields: {
        _id: fl.objectId(),
        title: fl.scalar(
          'mongo/string@1',
        ),
        embedding: fl.vector({
          typeParams: { length: 3 },
        }),
        body: fl
          .string()
          .optional(),
      },
    }),
  },
}));
