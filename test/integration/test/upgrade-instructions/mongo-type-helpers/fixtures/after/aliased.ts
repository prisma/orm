import { defineContract, field as f, model, type } from '@internal/mongo/contract-builder';

const User = model('User', {
  collection: 'users',
  fields: { _id: f.scalar(type.ObjectId()), name: f.scalar(type.String()), tags: f.scalar(type.String()).many() },
});

export const contract = defineContract({ models: { User } });
