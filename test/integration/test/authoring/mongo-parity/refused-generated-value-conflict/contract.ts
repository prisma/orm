import { defineContract } from '@internal/mongo/contract-builder';

export function buildContract() {
  return defineContract({}, ({ field, gen, model, type }) => ({
    models: {
      User: model('User', {
        collection: 'people',
        fields: {
          id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
          seenAt: field.scalar(type.Date()).onCreate(gen.now()),
        },
      }),
      Admin: model('Admin', {
        collection: 'people',
        fields: {
          id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
          seenAt: field.scalar(type.Date()).onUpdate(gen.now()),
        },
      }),
    },
  }));
}
