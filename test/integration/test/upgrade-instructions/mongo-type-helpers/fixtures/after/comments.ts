import { defineContract } from '@internal/mongo/contract-builder';

// Use field.date() for timestamps.
const hint = 'write field.date() here';
const template = `or field.objectId() in ${hint}`;

export const contract = defineContract({}, ({ field, model, type }) => ({
  models: {
    /* field.objectId() is the document id */
    Event: model('Event', {
      collection: 'events',
      fields: { _id: field.scalar(type.ObjectId()), at: field.scalar(type.Date()) },
    }),
  },
}));

export const notes = [hint, template];
