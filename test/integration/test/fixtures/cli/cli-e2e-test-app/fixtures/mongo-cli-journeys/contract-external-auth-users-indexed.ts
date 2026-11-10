import { defineContract, field, index, model, type } from '@internal/mongo/contract-builder';

const User = model('User', {
  collection: 'users',
  fields: {
    _id: field.scalar(type.ObjectId()),
    email: field.scalar(type.String()),
  },
});

const AuthUser = model('AuthUser', {
  collection: 'auth_users',
  controlPolicy: 'external',
  fields: {
    _id: field.scalar(type.ObjectId()),
    email: field.scalar(type.String()),
  },
  indexes: [index({ email: 1 }, { unique: true })],
});

export const contract = defineContract({
  models: { User, AuthUser },
});
