import { defineContract } from '@internal/mongo/contract-builder';

export const contract = defineContract({}, ({ field, gen, model, type }) => ({
  models: {
    Post: model('Post', {
      collection: 'posts',
      fields: {
        id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
        title: field.scalar(type.String()).mongo({ field: 't' }),
        createdAt: field.scalar(type.Date()).onCreate(gen.now()),
        updatedAt: field
          .scalar(type.Date())
          .onCreate(gen.now())
          .onUpdate(gen.now())
          .mongo({ field: 'updated_at' }),
        seenAt: field.scalar(type.Date()).onCreate(gen.now()),
        touchedAt: field.scalar(type.Date()).onUpdate(gen.now()),
        stamp: field.scalar(type.Date()),
      },
    }),
  },
}));
