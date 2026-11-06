import { defineContract, field, model } from '@internal/mongo/contract-builder';

export function buildContract() {
  return defineContract({
    models: {
      Doc: model('Doc', {
        collection: 'docs',
        fields: {
          id: field.objectId().mongo({ field: '_id' }),
          a: field.string(),
          b: field.string().mongo({ field: 'a' }),
        },
        indexes: [],
      }),
    },
  });
}
