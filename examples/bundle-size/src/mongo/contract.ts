import { defineContract } from '@prisma/orm-mongo/contract-builder';

/**
 * Minimal Mongo contract: a single `Note` model backed by the `notes`
 * collection with a single `_id` field. Authored in TypeScript so the
 * no-emit variant of the bundle can use it directly.
 */
export const contract = defineContract({}, ({ field, model, type }) => ({
  models: {
    Note: model('Note', {
      collection: 'notes',
      fields: {
        _id: field.scalar(type.ObjectId()),
      },
    }),
  },
}));
