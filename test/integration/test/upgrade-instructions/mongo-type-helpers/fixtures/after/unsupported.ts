import { defineContract } from '@internal/mongo/contract-builder';

export const contract = defineContract({}, ({ field, model, type }) => ({
  models: {
    Place: model('Place', {
      collection: 'places',
      fields: {
        _id: field.scalar(type.ObjectId()),
        location: field.scalar('geo/point@1'),
        sized: field.vector({ typeParams: { length: dimensions(), other: 1 } }),
      },
    }),
  },
}));

function dimensions(): number {
  return 3;
}
