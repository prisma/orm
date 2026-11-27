import { defineContract as defineMongoContract } from '@internal/mongo/contract-builder';
import { defineContract as defineSqlContract, postgres18, postgresDriver } from '@internal/postgres/contract-builder';

export const documents = defineMongoContract({}, ({ field, model }) => ({
  models: {
    Doc: model('Doc', { collection: 'docs', fields: { _id: field.objectId(), body: field.json() } }),
  },
}));

export const rows = defineSqlContract({ requiredCapabilities: [...postgres18, ...postgresDriver] }, ({ field, model, type }) => ({
  models: { Row: model('Row', { fields: { id: field.column(type.Int()).id(), body: field.column(type.Jsonb()) } }) },
}));
