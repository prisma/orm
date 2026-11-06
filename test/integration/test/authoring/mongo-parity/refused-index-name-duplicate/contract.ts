import { defineContract, field, index, model } from '@internal/mongo/contract-builder';

export function buildContract() {
  return defineContract({
    models: {
      User: model('User', {
        collection: 'users',
        fields: { id: field.objectId().mongo({ field: '_id' }), email: field.string() },
        indexes: [index({ email: 1 }, { unique: true }), index({ email: 1 }, { sparse: true })],
      }),
    },
  });
}
