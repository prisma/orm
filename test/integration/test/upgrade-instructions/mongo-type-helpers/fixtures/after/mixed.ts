import { defineContract as defineMongoContract } from '@internal/mongo/contract-builder';
import { defineContract as defineSqlContract } from '@internal/postgres/contract-builder';

export const documents = defineMongoContract({}, ({ field, model, type }) => ({
  models: {
    Doc: model('Doc', { collection: 'docs', fields: { _id: field.scalar(type.ObjectId()), body: field.scalar(type.Json()) } }),
  },
}));

export const rows = defineSqlContract({}, ({ field, model }) => ({
  models: { Row: model('Row', { fields: { body: field.json() } }) },
}));
