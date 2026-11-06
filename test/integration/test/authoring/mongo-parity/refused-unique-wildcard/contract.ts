import { defineContract, field, index, model } from '@internal/mongo/contract-builder';

export function buildContract() {
  return defineContract({
    models: {
      Doc: model('Doc', {
        collection: 'docs',
        fields: { id: field.objectId().mongo({ field: '_id' }), a: field.string() },
        indexes: [index({ '$**': 1 }, { unique: true })],
      }),
    },
  });
}
