import { defineContract, field, model } from '@internal/mongo/contract-builder';

const User = model('User', {
  collection: 'users',
  fields: {
    _id: field.objectId(),
    email: field.string(),
  },
});

const AuthUser = model('AuthUser', {
  collection: 'auth_users',
  controlPolicy: 'external',
  fields: {
    _id: field.objectId(),
    email: field.string(),
  },
  indexes: [],
});

export const contract = defineContract({
  models: { User, AuthUser },
});
