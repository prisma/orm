import { defineContract } from '@internal/mongo/contract-builder';

export const contract = defineContract({}, ({ field, model }) => ({
  models: {
    Place: model('Place', {
      collection: 'places',
      fields: {
        _id: field.objectId(),
        location: field.scalar('geo/point@1'),
        sized: field.vector({ typeParams: { length: dimensions() } }),
      },
    }),
  },
}));

function dimensions(): number {
  return 3;
}
