import { defineContract, field, model, rel, type } from '@internal/mongo/contract-builder';

const Order = model('Order', {
  collection: 'orders',
  fields: { _id: field.scalar(type.ObjectId()) },
  relations: { lines: rel.hasMany('Line'), returns: rel.hasMany('Line') },
});

const Line = model('Line', {
  owner: Order,
  fields: { sku: field.scalar(type.String()) },
});

export const contract = defineContract({ models: { Order, Line } });
