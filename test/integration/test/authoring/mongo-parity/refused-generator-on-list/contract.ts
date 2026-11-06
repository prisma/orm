import { defineContract } from '@internal/mongo/contract-builder';

export function buildContract() {
  return defineContract({}, ({ field, gen, model }) => ({
    models: {
      Doc: model('Doc', {
        collection: 'docs',
        fields: {
          id: field.objectId().mongo({ field: '_id' }),
          stamps: field.date().many().onCreate(gen.now()),
        },
      }),
    },
  }));
}
