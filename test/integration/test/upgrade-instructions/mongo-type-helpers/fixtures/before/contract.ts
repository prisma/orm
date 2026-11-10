import { defineContract, field, model, valueObject } from '@internal/mongo/contract-builder';

const Address = valueObject('Address', {
  fields: { street: field.string(), zip: field.scalar('mongo/string@1').optional() },
});

export const contract = defineContract({}, ({ field, model: m, gen }) => ({
  models: {
    Everything: m('Everything', {
      collection: 'everything',
      fields: {
        _id: field.objectId(),
        title: field.string(),
        ratio: field.double(),
        count: field.int32(),
        active: field.bool(),
        createdAt: field.date().onCreate(gen.now()),
        updatedAt: field
          .date()
          .onCreate(gen.now())
          .onUpdate(gen.now()),
        big: field.int64(),
        safe: field.int64Number(),
        price: field.decimal128(),
        bytes: field.binary(),
        meta: field.json(),
        raw: field.bson(),
        embedding: field.vector({ typeParams: { length: 3 } }),
        plain: field.vector(),
        tags: field.scalar('mongo/string@1').many(),
        sized: field.scalar('mongo/vector@1', { typeParams: { length: 2 } }),
        address: field.valueObject(Address),
      },
    }),
    Tagged: model('Tagged', {
      collection: 'tagged',
      fields: { _id: field.objectId(), label: field.string() },
    }),
  },
  valueObjects: { Address },
}));

export const fromHelpers = defineContract({}, (helpers) => ({
  models: {
    Note: helpers.model('Note', {
      collection: 'notes',
      fields: { _id: helpers.field.objectId(), body: helpers.field.string() },
    }),
  },
}));
