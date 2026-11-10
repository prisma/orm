import { defineContract } from '@internal/mongo/contract-builder';

export const contract = defineContract({}, ({ field, gen, model, type }) => ({
  models: {
    Event: model('Event', {
      collection: 'events',
      fields: {
        id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
        at: field.scalar(type.DateTime()),
        exactAt: field.scalar(type.DateTime({ as: 'temporal' })),
        atText: field.scalar(type.DateTime({ as: 'string' })),
        day: field.scalar(type.Date()),
        dayValue: field.scalar(type.Date({ as: 'temporal' })),
        opensAt: field.scalar(type.Time()),
        opensValue: field.scalar(type.Time({ as: 'temporal' })),
        lasts: field.scalar(type.Duration()),
        createdOn: field.scalar(type.Date()).onCreate(gen.now()),
        updatedAt: field.scalar(type.DateTime()).onUpdate(gen.now()),
      },
    }),
  },
}));
