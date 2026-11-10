import { defineContract, field, index, model, type } from '@internal/mongo/contract-builder';

export function buildContract() {
  return defineContract({
    models: {
      Doc: model('Doc', {
        collection: 'docs',
        fields: {
          id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
          a: field.scalar(type.String()),
        },
        indexes: [index({ '$**': 1 }, { unique: true })],
      }),
    },
  });
}
