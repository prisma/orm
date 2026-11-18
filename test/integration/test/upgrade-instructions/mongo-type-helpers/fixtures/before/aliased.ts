import { defineContract, field as f, model } from '@internal/mongo/contract-builder';

const User = model('User', {
  collection: 'users',
  fields: { _id: f.objectId(), name: f.string(), tags: f.scalar('mongo/string@1').many() },
});

export const contract = defineContract({ models: { User } });
