import { defineContract, field, model, rel, type } from '@internal/mongo/contract-builder';

const User = model('User', {
  collection: 'users',
  fields: {
    _id: field.scalar(type.ObjectId()),
    email: field.scalar(type.String()),
  },
  relations: { lines: rel.hasMany('Line') },
});

const Line = model('Line', {
  owner: User,
  fields: { sku: field.scalar(type.String()), code: field.scalar(type.String()) },
});

export const contract = defineContract({ models: { User, Line } });
