import { defineContract, field, index, model, type } from '@internal/mongo/contract-builder';

export function buildContract() {
  return defineContract({
    models: {
      User: model('User', {
        collection: 'users',
        fields: {
          id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
          email: field.scalar(type.String()),
        },
        indexes: [index({ email: 1 }, { unique: true }), index({ email: 1 }, { sparse: true })],
      }),
    },
  });
}
