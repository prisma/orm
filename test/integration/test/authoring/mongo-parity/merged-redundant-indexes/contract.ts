import { defineContract, field, index, model, type } from '@internal/mongo/contract-builder';

const fields = {
  id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
  email: field.scalar(type.String()),
  name: field.scalar(type.String()),
};

export const contract = defineContract({
  models: {
    User: model('User', {
      collection: 'people',
      fields,
      indexes: [index({ email: 1 }), index({ name: 1 })],
    }),
    Admin: model('Admin', {
      collection: 'people',
      fields,
      indexes: [index({ email: 1 }, { unique: true }), index({ email: 1 }), index({ name: 1 })],
    }),
  },
});
