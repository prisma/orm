import { defineContract } from '@internal/mongo/contract-builder';

export const contract = defineContract({}, ({ field, model }) => ({
  models: {
    Post: model('Post', {
      collection: 'posts',
      fields: {
        _id: field.objectId(),
        title: field.string(),
        createdAt: field.temporal.createdAt(),
        updated_at: field.temporal.updatedAt(),
        touchedAt: field.temporal.timestamp(undefined, 'now'),
      },
    }),
  },
}));
