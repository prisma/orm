import { defineContract, field, index, model, type } from '@internal/mongo/contract-builder';

const User = model('User', {
  collection: 'users',
  fields: {
    _id: field.scalar(type.ObjectId()),
    email: field.scalar(type.String()),
    name: field.scalar(type.String()),
  },
  indexes: [index({ email: 1 }, { unique: true }), index({ name: 1 })],
});

const Event = model('Event', {
  collection: 'events',
  fields: {
    _id: field.scalar(type.ObjectId()),
    name: field.scalar(type.String()),
  },
  indexes: [index({ name: 1 }, { unique: true })],
});

export const contract = defineContract({
  models: { User, Event },
});
