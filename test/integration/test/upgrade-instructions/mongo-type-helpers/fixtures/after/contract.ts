import { defineContract, field, model, valueObject, type } from '@internal/mongo/contract-builder';

const Address = valueObject('Address', {
  fields: { street: field.scalar(type.String()), zip: field.scalar(type.String()).optional() },
});

export const contract = defineContract({}, ({ field, model: m, gen, type }) => ({
  models: {
    Everything: m('Everything', {
      collection: 'everything',
      fields: {
        _id: field.scalar(type.ObjectId()),
        title: field.scalar(type.String()),
        ratio: field.scalar(type.Double()),
        count: field.scalar(type.Int32()),
        active: field.scalar(type.Bool()),
        createdAt: field.scalar(type.DateTime()).onCreate(gen.now()),
        updatedAt: field.scalar(type.DateTime())
          .onCreate(gen.now())
          .onUpdate(gen.now()),
        big: field.scalar(type.Int64()),
        safe: field.scalar(type.Int64Number()),
        price: field.scalar(type.Decimal128()),
        bytes: field.scalar(type.Binary()),
        meta: field.scalar(type.Json()),
        raw: field.scalar(type.Bson()),
        embedding: field.scalar(type.Vector(3)),
        plain: field.scalar(type.Vector()),
        tags: field.scalar(type.String()).many(),
        sized: field.scalar(type.Vector(2)),
        address: field.valueObject(Address),
      },
    }),
    Tagged: model('Tagged', {
      collection: 'tagged',
      fields: { _id: field.scalar(type.ObjectId()), label: field.scalar(type.String()) },
    }),
  },
  valueObjects: { Address },
}));

export const fromHelpers = defineContract({}, (helpers) => ({
  models: {
    Note: helpers.model('Note', {
      collection: 'notes',
      fields: { _id: helpers.field.scalar(helpers.type.ObjectId()), body: helpers.field.scalar(helpers.type.String()) },
    }),
  },
}));
