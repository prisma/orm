import { field, model } from '@internal/mongo-contract-ts/contract-builder';

export const Doc = model('Doc', {
  collection: 'docs',
  fields: { _id: field.objectId() },
});
