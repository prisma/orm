import { defineContract } from '@internal/mongo/contract-builder';

export function buildContract() {
  return defineContract({}, ({ field, gen, model, type }) => ({
    models: {
      Doc: model('Doc', {
        collection: 'docs',
        fields: {
          id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
          stamps: field.scalar(type.DateTime()).many().onCreate(gen.now()),
        },
      }),
    },
  }));
}
