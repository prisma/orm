import { defineContract as defineMongoContract } from '@internal/mongo/contract-builder';
import { defineContract as defineSqlContract } from '@internal/postgres/contract-builder';

export const documents = defineMongoContract({}, ({ field, model }) => ({
  models: {
    Doc: model('Doc', { collection: 'docs', fields: { _id: field.objectId(), body: field.json() } }),
  },
}));

export const rows = defineSqlContract({}, ({ field, model }) => ({
  models: { Row: model('Row', { fields: { body: field.json() } }) },
}));
