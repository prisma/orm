import { defineContract } from '@internal/mongo/contract-builder';

export function buildContract() {
  return defineContract({}, ({ field, gen, model }) => ({
    models: {
      User: model('User', {
        collection: 'people',
        fields: {
          id: field.objectId().mongo({ field: '_id' }),
          seenAt: field.date().onCreate(gen.now()),
        },
      }),
      Admin: model('Admin', {
        collection: 'people',
        fields: {
          id: field.objectId().mongo({ field: '_id' }),
          seenAt: field.date().onUpdate(gen.now()),
        },
      }),
    },
  }));
}
