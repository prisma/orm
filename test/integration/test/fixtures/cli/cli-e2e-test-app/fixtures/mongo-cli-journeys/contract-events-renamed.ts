import { defineContract, field, index, model } from '@internal/mongo/contract-builder';

const User = model('User', {
  collection: 'users',
  fields: {
    _id: field.objectId(),
    email: field.string(),
    name: field.string(),
  },
  indexes: [index({ email: 1 }, { unique: true }), index({ name: 1 })],
});

const Occasion = model('Occasion', {
  collection: 'occasions',
  fields: {
    _id: field.objectId(),
    name: field.string(),
  },
});

export const contract = defineContract({
  models: { User, Occasion },
});
