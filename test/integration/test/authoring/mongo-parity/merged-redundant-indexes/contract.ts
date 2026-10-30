import { defineContract, field, index, model } from '@internal/mongo/contract-builder';

const fields = {
  id: field.objectId().mongo({ field: '_id' }),
  email: field.string(),
  name: field.string(),
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
