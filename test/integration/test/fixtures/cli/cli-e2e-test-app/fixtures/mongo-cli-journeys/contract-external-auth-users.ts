import { defineContract, field, model, type } from '@internal/mongo/contract-builder';

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
  indexes: [],
});

export const contract = defineContract({
  models: { User, AuthUser },
});
