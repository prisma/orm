import { defineContract, field, model, type } from '@internal/mongo/contract-builder';

export const contract = defineContract({}, ({ gen, type: t }) => ({
  models: {
    Post: model('Post', {
      collection: 'posts',
      fields: {
        _id: field.scalar(type.ObjectId()),
        publishedAt: field.scalar(type.Date()).optional(),
        createdAt: field.scalar(t.Date()).onCreate(gen.now()),
        updatedAt: field.scalar(type.DateTime()).onCreate(gen.now()).onUpdate(gen.now()),
      },
    }),
  },
}));
